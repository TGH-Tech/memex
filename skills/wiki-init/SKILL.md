---
name: wiki-init
version: 1.0.0
description: |
  Scaffold an engineering-memory wiki vault for a project that's already
  underway. Creates a <project>-wiki/ folder next to the codebase with the
  full raw/ + wiki/ directory tree, CLAUDE.md schema, APPROACH/WORKFLOWS
  playbooks, an empty index/log, and an Obsidian vault config — ready to
  start ingesting sources into. Use when asked to "init a wiki", "scaffold
  a wiki", "set up engineering memory", or "create a wiki for this project".
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
triggers:
  - init a wiki
  - scaffold a wiki
  - create a wiki
  - set up engineering memory
  - wiki init
---

# /wiki-init — Scaffold an engineering-memory wiki vault

Creates a fresh, fully-formed wiki vault for a project that already exists but
has no engineering memory yet. The vault is a standalone Obsidian-shaped repo
that lives next to the codebase.

## What it produces

```
<project>-wiki/
├── README.md        what this is + workflow
├── CLAUDE.md        schema & operating manual for the LLM maintainer
├── APPROACH.md      paste-and-go templates for adding sources
├── WORKFLOWS.md     human playbook (feature / bug / session rituals)
├── index.md         empty page catalog
├── log.md           seeded with one [DATE] init entry
├── wiki.schema.json machine-readable structure + format contract (strict: false)
├── .gitignore
├── .obsidian/       app / appearance / core-plugins / graph config
├── raw/             features/ sessions/ slack/ linear/ notes/ transcripts/
└── wiki/            decisions/ bugs/ flows/ concepts/
```

`raw/` is for immutable source materials you drop in. `wiki/` is the
LLM-compiled, cross-linked layer. See the generated `CLAUDE.md` for the full
schema and page formats.

`wiki.schema.json` is the machine-readable version of those rules — the single
source of truth a validator checks pages against. It ships with `"strict":
false`, so checks are informational until the wiki matures (a half-finished
project's first pages are expected to be messy). `CLAUDE.md` describes the
rules; `wiki.schema.json` is what gets enforced.

## How to run it

1. **Determine the project name and target location.**
   - Project name: infer from the current directory name (strip a trailing
     `-backend` / `-api` / `-app` if present). Confirm with the user.
   - Target: default to a new folder **inside the current directory** —
     `./<project>-wiki`. If cwd is `/path/to/foo-backend`, the vault goes to
     `/path/to/foo-backend/foo-wiki`. Confirm.
   - If anything is ambiguous, ask with `AskUserQuestion` — name and path only,
     don't over-ask.

2. **Run the scaffolder:**
   ```bash
   bash "${CLAUDE_SKILL_DIR}/bin/scaffold-wiki.sh" <project-name> <target-dir>
   ```
   It creates the tree, substitutes `{{PROJECT}}` / `{{DATE}}` into the
   templates, drops `.gitkeep` files, and runs `git init` on the vault.
   It is safe and idempotent: it refuses to run if `<target>/CLAUDE.md`
   already exists, and skips any individual file that's already present.

3. **Report the result** — show the tree the script printed and the vault path.

4. **Offer the first step (don't do it unprompted):** the vault is empty. The
   way to populate a half-way project is to drop existing material into `raw/`
   and ingest it. Offer:
   > "Want me to seed `raw/notes/` with a starter note from this project's
   > README/docs so the wiki has a foothold? Otherwise, drop any spec, session
   > note, or thread into `raw/<category>/` and say 'ingest <path>'."

## Notes

- The vault is created as a folder **inside the current directory** and is its
  **own git repo**, separate from the codebase's git history.
- The scaffolder only writes structure + boilerplate. It never reads or writes
  the project's source code. Populating the wiki is the ingest loop's job
  (see the generated `CLAUDE.md`).
- To wire the vault into memex afterwards:
  `memex sources add <project> --path <target-dir> && memex sync --source <project>`.

## Anti-patterns

- Don't hand-write the boilerplate files — always use the scaffolder so the
  ~330-line `CLAUDE.md` schema never drifts.
- Don't auto-ingest the whole project. The wiki is curated one source at a
  time, by a human in the loop — that's the whole point.
