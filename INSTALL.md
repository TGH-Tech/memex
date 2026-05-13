# memex — install guide

Multi-source CLI + MCP server for Obsidian-shaped markdown vaults. Indexes pages into Supabase (Postgres + pgvector); serves hybrid retrieval to Claude Code via MCP.

This guide walks one machine from `git clone` to a working `memex` on PATH plus an indexed vault plus an MCP-wired Claude Code.

---

## 1. Prerequisites

- **Bun** ≥ 1.3 — install from <https://bun.com/install> if missing
- **A Supabase project** with the `vector` extension. Supabase enables it by default. (Self-hosted Postgres works too if `pgvector` is installed — see §7 troubleshooting.)
- **An OpenAI API key** — used for embeddings + query expansion. Required if `embedProvider=openai`. ~$0.002 per first-sync of a 40-page vault.
- A vault — any directory of markdown files. Obsidian-style frontmatter and `[[wikilinks]]` are first-class but not required.

Check:
```bash
bun --version          # need ≥ 1.3
echo "$PATH" | tr ':' '\n' | grep -E "(\.local/bin|/usr/local/bin)"  # need at least one
```

If neither `~/.local/bin` nor `/usr/local/bin` is on your PATH, add `~/.local/bin` to it (in `~/.bashrc` or `~/.zshrc`):
```bash
export PATH="$HOME/.local/bin:$PATH"
```

---

## 2. Build the binary

From the repo root:

```bash
bun install
bun run build
```

This produces `dist/memex` — a ~99MB single-file binary with the Bun runtime + all migrations embedded. Startup ~165ms.

Install it onto PATH:

```bash
cp dist/memex ~/.local/bin/memex
memex --version
```

Expected output: `0.0.0` (or whatever `package.json` `version` is).

> **Alternative — dev mode (no binary, tracks source changes):** `bun link` from the repo. `memex` will run via Bun against the source files. Convenient while iterating; depends on the repo staying where it is.

---

## 3. Get your Supabase URL

In the Supabase dashboard:
1. Open your project → **Project Settings** → **Database**
2. Scroll to **Connection pooling**
3. Copy **either** the *Session* (port 5432) or *Transaction* (port 6543) URL. `memex init` derives the other automatically. Replace `[YOUR-PASSWORD]` with the actual password.

A valid URL looks like:
```
postgres://postgres.abcdefghijklmnop:YOUR-PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres
```

---

## 4. Initialize memex

```bash
memex init
```

Prompts:
1. **Supabase pooler URL** — paste either port. `memex init` derives the other and probes both.
2. **Embedding provider** — accept the default `openai` (xenova-local is a stub at this stage).
3. **OPENAI_API_KEY** — your key (`sk-...`). Stored in `~/.memex/config.json`, mode `0600` (user-only readable).

`init` then runs all migrations against your Supabase database. Output:
```
✔ Config written to ~/.memex/config.json (mode 0600)
Running migrations...
  ✔ Applied: 001_init, 002_links, 003_pages_tsv, 004_typed_columns, 005_pages_conflicts, 006_conflict_cause_check, 007_chunks
```

Files now on disk:
| Path | Contents |
|---|---|
| `~/.memex/config.json` | Pooler URLs, embed provider, OpenAI key, knobs (`rrfK`, `multiQueryEnabled`, `queryExpansionModel`) |
| `~/.memex/cache/` | Per-host sync-state cache; deletable without data loss |
| `~/.memex/mounts.json` | Per-host path mappings for registered sources (created on first `sources add`) |

Re-running: `memex init --force` overwrites the config. Migrations are idempotent (`_memex_migrations` table tracks applied names).

---

## 5. Register and sync a vault

```bash
memex sources add my-vault --path /absolute/path/to/your/vault
memex sync --source my-vault
```

What sync does the first time (timings from a real 41-page vault):
- Walks every `.md` file, parses frontmatter + body, upserts into `pages`
- Extracts `[[wikilinks]]` and `related:` edges into `links`, then resolves them
- Chunks each page at H2 boundaries, embeds via OpenAI (one batched API call), stores in `chunks` with HNSW index
- ~180–200s on a 40-page vault (embed-bound), one-time cost
- Subsequent runs are hash-skip-bound: ~3s for an unchanged vault

Multiple vaults: add as many as you want. `memex sync` with no args syncs them all serially.

---

## 6. Verify

```bash
memex doctor --source my-vault
memex list --source my-vault --type decision
memex search "your search term"
memex query "natural language question" --source my-vault
```

Expected: `doctor` reports the page count and any broken wikilinks; `query` returns ranked results with a `(vector: #N, keyword: #N, score: X.XXX)` breakdown.

---

## 7. Wire it into Claude Code (MCP)

`memex` ships an MCP stdio server with 6 tools (`memex_search`, `memex_query`, `memex_get`, `memex_list`, `memex_backlinks`, `memex_sources`).

To make Claude Code use it, add this to `~/.claude.json` under your global `mcpServers`:

```json
{
  "mcpServers": {
    "memex": {
      "type": "stdio",
      "command": "memex",
      "args": ["serve", "--mcp"]
    }
  }
}
```

Or per-project, in a `.mcp.json` at the project root (same shape). Restart Claude Code. The tools should now appear when you type `/mcp`.

Smoke test from a shell:
```bash
memex serve --mcp < /dev/null
# stderr should print: memex MCP server ready (6 tools: memex_search, ...)
# Ctrl-C to exit
```

---

## 8. Day-to-day commands

```bash
memex sync                              # sync every registered vault
memex sync --source <name>              # sync one
memex sync --source <name> --full       # bypass hash-skip (force re-embed)

memex search <query>                    # keyword (fast, exact terms)
memex query <query> --source <name>     # hybrid (slower, natural language)
memex query <query>                     # federated across all vaults

memex get <slug> --source <name>        # one page by slug
memex list --source <name>              # all pages
memex backlinks <slug>                  # what links to this slug

memex doctor --source <name>            # health check
memex conflicts list                    # surface concurrent-edit conflicts
memex sources list                      # show registered vaults
```

---

## 9. Updating

Pull new code, rebuild, replace the binary:

```bash
git pull
bun install
bun run build
cp dist/memex ~/.local/bin/memex
```

Migrations auto-apply on the next `memex sync` or `memex init --force`.

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Probing both endpoints... ✘ session pooler FAIL` | Pooler URL wrong, password missing, or self-hosted on non-default ports | Replace `[YOUR-PASSWORD]`; if self-hosted, the prompt will fall back to asking for both URLs explicitly |
| `Config already exists` | Re-running `init` without `--force` | `memex init --force` |
| `ERROR: extension "vector" does not exist` on first migration | Self-hosted Postgres without pgvector | `CREATE EXTENSION vector;` as a superuser, then `memex init --force` |
| `OPENAI_API_KEY not configured — pages indexed for keyword search only` | No key in config | Re-run `memex init --force` and paste the key, or edit `~/.memex/config.json` directly |
| Slow first sync | Embed-bound (single OpenAI call dominates) | Expected. ~180–200s for 40 pages. Subsequent syncs are hash-skipped to ~3s |
| `Synced ... 0 inserted · 0 updated · N unchanged (skipped)` | Nothing changed | Working as intended — hash-skip is doing its job |
| MCP tools not appearing in Claude Code | `.claude.json` syntax error, or `memex` not on PATH for the Claude Code process | `which memex`; restart Claude Code; check stderr of the server with `memex serve --mcp` |
| `memex_query` returns no matches but `memex_search` does | Vector retrieval disabled (no OpenAI key, or all chunks have NULL embeddings) | `memex sync --source <name> --full` to retry embeddings; check `~/.memex/config.json` has `openaiApiKey` |

---

## 11. Uninstall

```bash
rm ~/.local/bin/memex
rm -rf ~/.memex/
```

To also drop the Supabase data: `memex sources remove <name> --force` for each registered vault, or drop the database via the Supabase dashboard.
