---
name: wiki-interview
version: 1.0.0
description: |
  Interview-driven ingest for a project that has no docs to ingest. Given a
  topic (e.g. "auth", "cart", "deploy"), reads the project's code to ground
  itself, then interviews the builder with focused questions and compiles the
  answers into the wiki — raw note, decision/flow/bug/concept pages, index and
  log updates. Use when asked to "interview the project about X", "capture X",
  "document X", or "ingest X by asking" — i.e. when the knowledge is in
  someone's head, not in a file.
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Write
  - Edit
  - AskUserQuestion
triggers:
  - interview the project
  - capture this topic
  - document this topic
  - wiki interview
  - ingest by asking
---

# /wiki-interview — Reverse-engineer wiki pages by interviewing the builder

The normal wiki loop is: drop a source into `raw/`, then ingest it. But a
half-built project often has **no source to drop** — the decisions, the flow,
the bugs all live in the builder's head. This skill is the way in: pick a
topic, and it interviews the person who built it, then files the answers.

One topic per run. Run it again for the next topic.

## How it works

### 1. Locate the vault and the codebase
- **Vault:** the `*-wiki/` directory holding `wiki.schema.json` + `CLAUDE.md`.
  Read that `CLAUDE.md` now — it defines the exact page formats you must write.
- **Codebase:** usually the current directory, or the vault's sibling/parent
  (`<project>-backend/`, `<project>/`). Confirm with the user if unsure.

### 2. Scope to the topic
The argument is the topic — `auth`, `cart`, `payments`, `deploy`. If none was
given, ask for one. Keep it to a single topic; breadth kills interview depth.

### 3. Ground yourself in the code FIRST
Before asking anything, grep/read the project's source for the topic. Find the
routes, models, middleware, services, and config that implement it. This is
what makes the interview worth doing — your questions become specific:

> "`requireAuth.js` fetches the role from the DB on every request instead of
>  reading it from the JWT — was that deliberate? What did it cost you?"

not:

> "Tell me about auth."

If there's no code for the topic, fall back to open questions.

### 4. Interview in rounds
Ask in waves of ~3-5 questions, not a wall of 20. Follow the thread — a good
answer opens the next question. Use `AskUserQuestion` for choices, plain
questions for open-ended. Cover the four artifact types the wiki captures:

- **Decisions** — "What did you choose for X? What did you rule out, and why?
  What would make you revisit it?"
- **Flow** — "Walk me through what happens, step by step: trigger → data path
  → which files → edge cases."
- **Bugs** — "Any bug here you hit and fixed? Symptom, root cause, the fix,
  how you'd catch it next time."
- **Concepts** — "Any pattern or idea here that shows up in other parts of the
  project too?"

Adapt every question to what the code actually showed. Don't ask what you can
already see; ask *why*.

### 5. Confirm before writing
Summarize the 3-7 things worth filing and get an explicit OK — same as the
ingest loop in the vault's `CLAUDE.md`. Don't file things the user didn't
actually say; flag gaps instead of inventing.

### 6. Write it into the wiki
- **Raw note first:** `raw/sessions/<YYYY-MM-DD>-<topic>-interview.md` — the
  captured Q&A. This is the *source*: every wiki page you write next cites it
  in `sources:`, so the provenance chain is real.
- **Then compile** to `wiki/decisions/`, `wiki/flows/`, `wiki/bugs/`,
  `wiki/concepts/` per the vault's `CLAUDE.md` page formats. Add `[[wikilinks]]`
  between them. If a page for this topic already exists, extend it — don't
  duplicate.
- **Update** `index.md` (new entries) and `log.md` (one ingest entry).

### 7. Close the loop
Ask: **"Anything else about `<topic>` we should add?"** — and list the gaps or
follow-ups you noticed but didn't get answers for. Then suggest running
`wiki-validate` to check the new pages against `wiki.schema.json`.

## Notes

- This is a **pure interview procedure** — no script to run. Scaffolding and
  validation are deterministic (their skills ship scripts); interviewing is
  judgment work.
- It fits between the other two skills: `wiki-init` builds the empty vault →
  `wiki-interview` fills it from what's in your head → `wiki-validate` checks
  the result.
- Respects the vault's `CLAUDE.md` and `wiki.schema.json` — write pages in the
  formats they define, not a format of your own.
- Reads the project's code but never modifies it. Only writes inside the vault.

## Anti-patterns

- Don't invent answers. If the user didn't say it, it doesn't go in the wiki —
  note the gap in `log.md` follow-ups instead.
- Don't skip the raw note. Wiki pages with no `sources:` have no provenance —
  the interview note is what they cite.
- Don't dump every question at once. Rounds of 3-5, following the thread.
- Don't write pages that just restate the code. The code already says *what*;
  the wiki exists for the *why*. Capture the why.
- Don't cover three topics in one run. One topic, deep.
