# Log

Chronological, append-only. Every entry starts with `## [YYYY-MM-DD] <op> | ...` so `grep "^## \[" log.md` parses cleanly.

## [{{DATE}}] init
- Wiki scaffold created for {{PROJECT}}. CLAUDE.md schema written. Empty index.md and log.md.
- Directory structure: raw/{features,sessions,slack,linear,notes,transcripts}, wiki/{decisions,bugs,flows,concepts}.
- wiki.schema.json written (machine-readable format contract; strict: false until the wiki matures).
