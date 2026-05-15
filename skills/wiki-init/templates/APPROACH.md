# Approach

How to add things to the wiki. Same pattern every time:

```
1. Make a file in raw/<folder>/2026-05-06-<slug>.md
2. Write what's below
3. Tell Claude: ingest raw/<folder>/2026-05-06-<slug>.md
```

That's it. Pick the section that matches what you're storing.

---

## Feature

**Do this when:** you finished writing the PRD, before you start coding.

**Where to save:** `raw/features/2026-05-06-<feature-name>.md`

**What to write — full PRD skeleton (paste this as the starting point):**

```markdown
# PRD: <feature name>

**Date:** 2026-05-06
**Status:** Proposed
**Branch:** main
**Author:** <name> (<email>)
**Effort:** ~<N> CC-hours (~<M> human-days)

---

## 1. One-line summary
What this ships, in one sentence.

## 2. Problem
### 2.1 What users / devs experience today
Concrete failures, with real examples (paste log lines, real user quotes).

### 2.2 Why the current architecture can't fix this
Reference exact file paths and functions. Be specific.

### 2.3 Why this is worth fixing now
The product/business/eng cost of not doing it.

---

## 3. CEO review — premise challenge + alternatives

### 3.1 Premises (state, so they can be challenged)
| # | Premise | Risk if wrong |
|---|---|---|
| P1 | ... | ... |
| P2 | ... | ... |

### 3.2 Alternatives considered
| Approach | Completeness | Effort | Verdict |
|---|---|---|---|
| A: ... | x/10 | ... | Rejected — <why> |
| B: ... | x/10 | ... | Rejected — <why> |
| C (chosen): ... | x/10 | ... | Chosen |
| D: ... | x/10 | ... | Deferred |

### 3.3 Scope decision
**In scope:**
- ...

**Deferred to TODOS.md:**
- ...

### 3.4 Dream state delta
TODAY → THIS PLAN → 12-MONTH IDEAL.

---

## 4. Goals & non-goals
### 4.1 Goals
- ...

### 4.2 Non-goals
- ...

### 4.3 Success metrics
| Metric | Baseline | Target | Measurement |
|---|---|---|---|
| ... | ... | ... | ... |

---

## 5. Target user flows
### 5.1 Flow A — <name>
```
trigger → step → step → user sees X
```

### 5.2 Flow B — <name>
...

---

## 6. Architecture
### 6.1 Before
ASCII diagram of current state.

### 6.2 After
ASCII diagram of proposed state.

### 6.3 Components
| Component | Status | File |
|---|---|---|
| ... | new / extended / kept | `path/to/file` |

### 6.4 Data flow
Step-by-step what happens at runtime.

---

## 7. API changes
**External:** ...
**Internal:** ...

## 8. Schema changes
None / list migrations.

---

## 9. Implementation plan
### Step 1 — <action> (<time>)
What to do. Reference exact files.

### Step 2 — ...

---

## 10. Effort summary
| Step | Description | CC-effort | Human-eq |
|---|---|---|---|
| 1 | ... | ... | ... |

---

## 11. Test plan
### 11.1 Codepaths
| Codepath | Test type | File |
|---|---|---|

### 11.2 Eval suite (if applicable)

### 11.3 Non-regression checklist
- [ ] ...

---

## 12. Failure modes & fallback matrix
| Failure | Impact | Fallback | Who notices |
|---|---|---|---|

---

## 13. Security & prompt injection (if applicable)

## 14. Observability & rollout
### 14.1 Rollout plan
1. ...

### 14.2 Logs to watch

---

## 15. DX considerations

## 16. Open questions
1. ...

## 17. Acceptance criteria
- [ ] ...

---

## 18-20. Consensus tables (CEO / Eng / DX)
| Dimension | Verdict | Notes |
|---|---|---|

---

## 21. Cross-phase themes

## 22. Not in scope (explicit)
- ...

## 23. Deferred to TODOS.md
- ...

## 24. Completion summary
| Area | Status | Notes |
|---|---|---|
```

**What of this compiles to the wiki:**

| PRD section | Goes to wiki? |
|---|---|
| §1 summary, §5 user flows, §6 architecture, §6.4 data flow, §6.3 components | → `wiki/flows/<feature>.md` (status: proposed) |
| §3.2 alternatives table + chosen approach | → `wiki/decisions/<chosen>.md` (alternatives preserved as sub-section) |
| New entities mentioned in §6 (services, modules, types) | → `wiki/concepts/<entity>.md` (only if referenced 2+ places) |
| §3.1 premises, §18–20 consensus tables, §24 completion summary | Stays in `raw/` only — review artifact, not retrieval |
| §11 test plan, §17 acceptance criteria, §14 rollout | Stays in `raw/` only — work-tracking, not memory |
| §12 failure-mode matrix | Stays in `raw/` until a failure actually materializes — then becomes a `wiki/bugs/` entry |
| §22 not-in-scope, §23 deferred | Stays in `raw/`. Noted as follow-ups in `log.md` |

**After you ship the feature**, do a "Session" entry (next section) — Claude updates the same flow page, flips status to `shipped`, replaces the planned data path with actual, fills `effort-actual`.

---

## Session (end of a Claude coding session)

**Do this when:** before closing a Claude session that produced something real (a decision, a bug fix, a feature shipped, something non-obvious learned).

**Skip when:** scaffolding, renames, lint fixes, dead-end work, nothing settled.

**Don't write the file yourself.** Claude does it. Paste this at the end of the session:

```
Capture this session for the wiki.

Write a concise raw note to:
../{{PROJECT}}-wiki/raw/sessions/2026-05-06-<short-slug>.md

Include only what's worth keeping in 6 months:
- decisions made (what + why + what we ruled out)
- bugs fixed (symptom / root cause / fix / detection)
- non-obvious things about the codebase
- follow-ups deferred

Skip routine code changes.

Then ingest it per ../{{PROJECT}}-wiki/CLAUDE.md and report back.
```

That's the whole ritual. Claude writes the raw file and ingests it.

---

## Bug

**Do this when:** right after the fix lands.

**Where to save:**
- `raw/sessions/2026-05-06-<bug-name>.md` — for any bug
- `raw/linear/2026-05-06-PROJ-N-<bug-name>.md` — if it's from a Linear ticket

**What to write (4 questions):**

```
# Bug: <short name>

Symptom: what was observed (user / log / metric)
Root cause: what was actually broken, and why
Fix: what changed (commit SHA if known)
Detection: how to catch this kind of bug next time
```

If you can't answer one of the 4, the bug isn't fully understood. Investigate first.

---

## Slack thread

**Do this when:** a thread reached a conclusion (a decision was made, a bug was explained, tribal knowledge surfaced).

**Where to save:** `raw/slack/2026-05-06-<topic>.md`

**What to write:**

```
# Slack: <one-line topic>

Channel: #<channel>
Date: 2026-05-06

<paste the full thread, names + timestamps + all messages>
```

Don't summarize. Paste it raw. Claude does the distilling.

---

## Linear ticket

**Do this when:** a ticket closed with non-obvious context (root cause, design choice, follow-ups worth keeping).

**Where to save:** `raw/linear/2026-05-06-PROJ-N-<slug>.md`

**What to write:**

```
# Linear PROJ-N: <title>

Status: closed
Date: 2026-05-06

## Description
<paste the issue description>

## Resolution
<paste comments + final resolution>
```

---

## Meeting / call / podcast / video

**Do this when:** after a design review, customer call, or any meeting that surfaced something useful.

**Where to save:** `raw/transcripts/2026-05-06-<topic>.md`

**What to write:**

```
# Transcript: <topic>

Type: design review | customer call | podcast | etc.
Participants: <names or roles>
Date: 2026-05-06

<paste the transcript>
```

---

## Personal note

**Do this when:** you have a thought worth keeping. "I should remember this."

**Where to save:** `raw/notes/2026-05-06-<topic>.md`

**What to write:** anything. 3 lines or 30. Free-form.

---

## File naming rule

Always: `2026-05-06-<slug>.md`

- Date first, ISO format
- Slug in kebab-case
- Descriptive — `mongodb-decision`, not `note1`

---

## What Claude does on every ingest

1. Reads the source
2. Tells you the 3–5 things worth filing, waits for your OK
3. Writes wiki pages (decisions, bugs, flows, concepts)
4. Updates `index.md` and `log.md`
5. Reports back: pages created, pages updated, anything contradicted, follow-ups raised

You read the report, fix anything wrong, done. ~2–3 minutes.

---

## What you never have to do

- Summarize sources yourself
- Format raw files perfectly (paste-and-go is fine)
- Update `index.md` or `log.md` manually
- Cross-reference between wiki pages
- Decide where things go in the wiki
