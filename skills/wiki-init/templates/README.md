# {{PROJECT}}-wiki

Persistent engineering memory for the {{PROJECT}} project. Every decision, bug fix, and feature flow — distilled from working sessions, Slack threads, and Linear issues — so we never re-debug, re-decide, or re-explain the same thing twice.

## How it works

- **`raw/`** — source materials. Drop notes, transcripts, distilled Slack/Linear threads here. Immutable; the LLM reads but never modifies.
- **`wiki/`** — LLM-compiled, cross-linked pages. Decisions, bug playbooks, feature flows, concepts.
- **`index.md`** — catalog of every wiki page.
- **`log.md`** — chronological record of ingests / queries / lint passes.
- **`CLAUDE.md`** — schema and operating manual for the LLM. Read this for conventions and page formats.

## Workflow

1. Drop a source into the right `raw/<category>/` folder.
2. Ask Claude to ingest it. Discuss key takeaways. Claude writes/updates wiki pages.
3. Ask questions against the wiki. File good answers back as new pages.
4. Periodically run a lint pass to catch contradictions, orphans, and stale claims.

## Open in Obsidian

This repo is a vault. Open the folder in Obsidian to get `[[wikilinks]]`, graph view, and search.
