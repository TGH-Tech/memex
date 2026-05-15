# Workflows

Day-to-day recipes for using the wiki. CLAUDE.md is the schema (for the LLM); this file is the playbook (for humans).

## Feature workflow

Six phases. ~10 minutes of wiki overhead per feature, spread across the work.

### Phase 1 — Plan (10–30 min)
Think the feature through *in chat with Claude only*. No files yet.

- What's the user/business need?
- What's in scope vs explicitly out of scope?
- What are the risky edges (concurrency, payment, auth, migrations)?
- What existing flows/decisions does this touch?

**Output:** alignment. Nothing on disk.

### Phase 2 — Write the PRD (15–30 min)
Co-write the spec with Claude. Save to:

```
raw/features/YYYY-MM-DD-<feature-slug>.md
```

PRD skeleton (paste at the top of every spec):

```markdown
# Feature: <name>

## Problem
What's broken / missing / requested.

## Goal
The success state.

## Scope
**In:**
- ...
**Out (explicitly):**
- ...

## Acceptance criteria
- [ ] User can do X
- [ ] System enforces Y
- [ ] Edge case Z handled

## Design notes
- Data model changes
- API surface (endpoints + payloads)
- External services touched
- Sequencing / state transitions

## Decisions committed
- Why approach A over B

## Open questions
- ...
```

### Phase 3 — Pre-implementation ingest (2 min)
```
ingest raw/features/YYYY-MM-DD-<feature-slug>.md
```

Claude writes the wiki skeleton: `wiki/flows/<feature>.md`, any `wiki/decisions/...`, any `wiki/concepts/...`. Updates `index.md`, `log.md`.

### Phase 4 — Implement
Code in the backend repo. As you discover divergences from the spec, jot 5-line notes in:

```
raw/sessions/YYYY-MM-DD-<feature>-impl-notes.md
```

Don't update the wiki yet — keep coding.

### Phase 5 — Post-ship ingest (5 min)
```
ingest raw/sessions/YYYY-MM-DD-<feature>-impl-notes.md
```

Claude updates `wiki/flows/<feature>.md` to match reality (actual data path, real file paths, edge cases hit, follow-ups deferred to `log.md`).

### Phase 6 — Ship note (optional, 1 min)
One line in team channel pointing to the wiki page.

---

## Bug workflow

```
1. After the fix, answer 4 questions in 3 minutes:

   raw/sessions/YYYY-MM-DD-<bug-slug>.md
   ── or ──
   raw/linear/YYYY-MM-DD-PROJ-N-<bug-slug>.md

   - Symptom: what was observed (user / log / metric)?
   - Root cause: what was actually broken, and why?
   - Fix: what changed (commit SHA if known)?
   - Detection: how do we catch this class next time?

2. ingest raw/<that-path>.md

3. Claude writes wiki/bugs/<bug-slug>.md, links it to the affected
   wiki/flows/, updates wiki/decisions/ if a past decision contributed,
   updates index.md and log.md.
```

If you can't answer one of the 4 questions, the bug isn't fully understood — that's a useful signal. Stop and investigate before filing.

---

## End-of-Claude-session ritual

Before closing a Claude Code session in the backend repo, paste this:

```
Capture this session for the wiki.

Write a concise raw note to:
../{{PROJECT}}-wiki/raw/sessions/YYYY-MM-DD-<short-slug>.md

Include only what's worth keeping in 6 months:
- Decisions made (what + why + what we ruled out)
- Bugs fixed (symptom / root cause / fix / detection)
- Non-obvious things discovered about the codebase
- Follow-ups deferred

Skip: routine code changes, things obvious from the diff.

Then ingest it per ../{{PROJECT}}-wiki/CLAUDE.md — write/update the
relevant wiki pages, update index.md and log.md, and report back.
```

### When to skip the ritual
- Pure scaffolding / boilerplate
- Renames or lint-only changes
- Dead-end work you reverted
- Mid-flight, nothing settled

### When to always do it
- You decided something
- You fixed a non-trivial bug
- You shipped a feature
- You discovered something non-obvious

---

## Querying the wiki

```
"what did we decide about <X>?"
"have we seen this bug before?"
"how does <feature> work end-to-end?"
"what's the relationship between <A> and <B>?"
```

Claude reads `index.md`, loads relevant pages, answers with citations. If the answer is new synthesis, Claude offers to file it as a concept page so the work doesn't vanish into chat history.

---

## Lint pass (every few weeks)

```
lint the wiki
```

Claude checks for contradictions, orphans, stale claims, missing concept pages, broken `[[links]]`, and index/disk drift. Reports findings. You decide what to action.

---

## Source-to-output cheat sheet

| You produce | Goes into | Compiles to |
|---|---|---|
| PRD / spec | `raw/features/` | `wiki/flows/` (skeleton) + `wiki/decisions/` |
| Bug fix notes | `raw/sessions/` or `raw/linear/` | `wiki/bugs/` |
| Session capture | `raw/sessions/` | varies — usually `wiki/decisions/` + flow updates |
| Slack thread | `raw/slack/` | varies |
| Linear ticket | `raw/linear/` | `wiki/bugs/` or `wiki/decisions/` |
| Meeting transcript | `raw/transcripts/` | varies |
| Personal note | `raw/notes/` | varies |
