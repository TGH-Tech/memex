# memex

Multi-source CLI + MCP server for Obsidian-shaped markdown vaults. Indexes one or many vaults into Supabase and serves keyword + (eventually) hybrid queries — markdown stays the source of truth.

PRD: [`2026-05-13-memex-cli.md`](./2026-05-13-memex-cli.md)

## Status

Working CLI + MCP server through P8. Phases:

- ✅ P0–P5: scaffold, config, sources, sync, keyword search (tsvector)
- ✅ P6: incremental sync, typed columns, CAS, conflict logging, supersession symmetry
- ✅ P7: single-file binary distribution
- ✅ P8: MCP stdio server (5 tools for Claude Code)
- ⏭ P9: embeddings + hybrid query
- ⏭ P10: clone/export + skills

## Install (single binary)

```bash
git clone <repo> memex && cd memex
bun install
bun run build                          # produces ./dist/memex (~99 MB)
cp dist/memex ~/.local/bin/memex       # or /usr/local/bin/memex
memex --version
```

First-time setup:

```bash
memex init                             # interactive Supabase setup (one-time)
memex sources add my-vault --path ~/path/to/vault
memex sync --source my-vault
```

## Wire into Claude Code

Add this to `.mcp.json` at your project root (or `~/.claude/.mcp.json` for global):

```json
{
  "mcpServers": {
    "memex": {
      "command": "memex",
      "args": ["serve", "--mcp"]
    }
  }
}
```

Restart Claude Code. You'll see 5 new tools available:

| Tool | Purpose |
|---|---|
| `memex_sources` | Discover registered vaults + page counts |
| `memex_search` | Ranked keyword search across vault bodies |
| `memex_get` | Fetch one page in full (frontmatter + body) |
| `memex_list` | Browse pages by source and/or type |
| `memex_backlinks` | Inbound wikilink graph for a slug |

All tools support an optional `source` argument; omit it for federated queries across every registered vault.

## Daily CLI use

```bash
memex sync --source my-vault                       # incremental; hash-skips unchanged files
memex search "currency mismatch" --source my-vault
memex backlinks concepts/lazy-upsert --source my-vault
memex doctor --source my-vault                     # broken links + orphans + conflicts + asymmetries
memex conflicts list                               # if any concurrent-edit conflicts arose
memex get decisions/cart-currency-locked --source my-vault
memex list --source my-vault --type decision
```

## Dev

```bash
bun install
bun run dev -- --version       # → 0.0.0
bun run typecheck
```

`bun run dev` is ~55 ms slower per invocation than the compiled binary because Bun has to load + compile TypeScript at startup.

## Build

```bash
bun run build                  # ./dist/memex single binary (Linux x86_64)
```

Cross-platform builds aren't wired up yet. Bun supports `--target=darwin-arm64` / `linux-x64` / etc. if you need them.

## Stack

- Runtime: Bun (binary bundles the runtime + all deps; ~99 MB)
- Language: TypeScript
- CLI: commander
- MCP: `@modelcontextprotocol/sdk` (stdio transport)
- Postgres client: porsager/postgres
- YAML frontmatter: gray-matter
- Config validation: zod

## Architecture notes

- **Two pooler URLs.** CLI commands use the transaction pooler (6543) for short-lived calls; the MCP server uses the session pooler (5432) for its long-lived connection. Both stored in `~/.memex/config.json`.
- **Markdown is sovereign.** The database is a derived index. `sync` is one-way (filesystem → DB); pages on disk are never auto-modified.
- **Conflict surfaces, never auto-merges.** Concurrent edits from two hosts are logged to `pages_conflicts` for human resolution via `memex conflicts resolve`.
- **Stdio MCP server.** Stdout is reserved for JSON-RPC; all server logs go to stderr.
