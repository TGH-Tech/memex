---
name: wiki-validate
version: 1.0.0
description: |
  Validate an engineering-memory wiki vault against its own wiki.schema.json.
  Checks the markdown files on disk directly — no database, no `memex sync`,
  no memex install needed. Catches missing/invalid frontmatter, undeclared
  page types, files in the wrong directory, broken citation provenance, and
  asymmetric supersession links. Use when asked to "validate the wiki",
  "check the wiki", "lint the wiki", or before committing wiki changes.
allowed-tools:
  - Bash
  - Read
triggers:
  - validate the wiki
  - check the wiki
  - lint the wiki
  - validate wiki
---

# /wiki-validate — Validate a wiki vault against its schema

Checks a wiki vault's pages against the contract it declares for itself in
`wiki.schema.json` (the file the `wiki-init` skill scaffolds). Reads the
markdown **on disk** — the source of truth — so it works on any machine with
no database, no sync, and no memex install.

## What it checks

Two tiers — `wiki.schema.json` defines both.

**Strict** (a violation fails the run when strict mode is on):

- `type:` present in frontmatter and one the schema defines rules for
- the page lives in a declared `wiki/` subdir (`structure.wiki`)
- every required frontmatter key for that type is present
- enum-valued keys (`status`, `severity`, …) hold an allowed value
- `sources:` provenance present in frontmatter
- no `[Inferred …]` markers in `wiki/` pages (those belong only in `raw/`)
- supersession links are symmetric — if A `supersedes` B, then B's
  `superseded_by` points back at A, and B actually exists

**Lint** (warn only, never fails):

- the *required* body sections for that type are present (e.g. a decision
  page has `## Context` and `## Decision`). Optional sections missing is
  silent — never pad a page with empty headings to satisfy the checker.

## How to run it

1. **Find the vault root** — the directory containing `wiki.schema.json` and a
   `wiki/` folder. If the current directory is a vault, that's it; otherwise
   look for a `*-wiki/` directory nearby. Confirm with the user if unsure.

2. **Run the validator** (requires `bun` on PATH):
   ```bash
   bun "${CLAUDE_SKILL_DIR}/bin/validate-wiki.ts" <vault-path>
   ```
   Add `--strict` to force a hard gate (non-zero exit on any strict
   violation), overriding whatever `wiki.schema.json`'s own `strict` flag says.

3. **Report the result** — show the strict violations and lint warnings the
   script printed, grouped as it grouped them. If it exited non-zero, say so.

## Strict vs informational

`wiki.schema.json` ships with `"strict": false`, so by default the run is
**informational** — it lists everything but always exits 0. That's intentional:
a freshly-scaffolded wiki for a half-finished project is *expected* to be messy
at first. Two ways to turn it into a hard gate:

- pass `--strict` on the command line (one-off, e.g. in CI), or
- flip `"strict": true` in the vault's `wiki.schema.json` once the wiki has
  matured (permanent, vault-wide).

## When to use it

- After an ingest, to catch frontmatter or citation slips before they pile up.
- Before committing wiki changes — pair with a warn-only pre-commit hook.
- In CI with `--strict`, once the vault has opted into strict mode.

## Notes

- Pairs with the `wiki-init` skill: `wiki-init` scaffolds the vault *and* its
  `wiki.schema.json`; `wiki-validate` enforces that schema. Edit the schema
  freely as the project's conventions evolve — it's the single source of truth.
- Only `wiki/` pages are checked. `raw/` is immutable source material the
  human drops in — not the wiki's to enforce.
- Reads only; never modifies any file in the vault.

## Anti-patterns

- Don't hand-check pages by reading them one by one — run the script; it's
  deterministic and fast.
- Don't treat lint warnings as failures — missing optional sections is fine.
- Don't edit the script's rules to make a vault pass. The rules live in the
  vault's `wiki.schema.json` — change them there, per project, on purpose.
