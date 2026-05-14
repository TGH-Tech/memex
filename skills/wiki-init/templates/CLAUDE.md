# CLAUDE.md — Wiki Schema & Operating Manual

This repo is the team's **persistent engineering memory** for the {{PROJECT}} project. It exists so we never re-debug, re-decide, or re-explain the same thing twice.

You (Claude) are the wiki's maintainer. The human curates sources and asks questions; you do the reading, summarizing, cross-referencing, and bookkeeping. This file tells you how.

## What this wiki captures

Three core artifact types, each answering a question the codebase can't:

1. **Decisions** — *why* something was chosen. Context, options weighed, tradeoffs accepted, what we'd revisit if X changed.
2. **Bug playbooks** — symptom → root cause → fix → detection. So the same class of bug doesn't get re-debugged in 6 months.
3. **Feature flows** — trigger → data path → components touched → edge cases. So a new dev gets a 30-line overview instead of reading 500 lines of source.

Plus **concepts** — entities/ideas that get cross-referenced from many pages (e.g. "order state machine", "soft-delete pattern"). Promote something into its own concept page when it's referenced from 3+ places.

## Architecture

```
raw/            immutable source materials. You read from these, never modify.
├── features/     feature specs, PRDs, design docs, scope/acceptance criteria
├── sessions/     working session notes (decisions made, bugs solved, clarifications)
├── slack/        distilled Slack threads (decision/bug-fix/tribal knowledge)
├── linear/       Linear issue resolution context
├── notes/        free-form notes / journal entries
└── transcripts/  meeting / podcast / video transcripts

wiki/           LLM-generated, cross-linked pages. You own this layer entirely.
├── decisions/    one page per decision
├── bugs/         one page per bug playbook
├── flows/        one page per feature flow
└── concepts/     entities / ideas referenced across the wiki

index.md        content catalog — every wiki page with a one-line summary
log.md          chronological append-only log of ingests, queries, lint passes
CLAUDE.md       this file
```

## Operations

### Ingest (the main loop)

When the human drops a file into `raw/<category>/` and says "ingest", do this:

1. **Read** the source end-to-end.
2. **Discuss** the key takeaways with the human in chat — what's worth filing, what isn't. Don't dump the whole thing as a summary; surface the 3-5 things that matter for the wiki.
3. **Classify** — does this contribute to existing pages, or warrant new ones? A single source typically touches 3-15 wiki pages (some new, most updates).
4. **Write/update** wiki pages. For each page:
   - If new, use the page template for that type (see "Page formats" below).
   - If existing, merge the new info — don't overwrite. Note contradictions explicitly with `> ⚠ Contradicts <other source>:` blocks rather than silently picking a winner.
   - Add `[[wikilinks]]` to other pages liberally. Bidirectional thinking: if A links to B, B usually should mention A.
5. **Update `index.md`** — add new pages, update one-line summaries that changed.
6. **Append to `log.md`** — one entry per ingest (format below).
7. **Report back** — list of pages touched (created vs updated), any contradictions flagged, any follow-up questions raised.

### Ingesting a PRD (special case — fan-out rules)

A full PRD typically compiles to several wiki pages, not one. On a PRD ingest, **expect this fan-out**:

| PRD section | Compiles to |
|---|---|
| One-line summary, target user flows, architecture (before/after), data flow, components | **`wiki/flows/<feature>.md`** with `status: proposed` |
| Each entry in the alternatives table | The chosen approach → primary `wiki/decisions/<chosen>.md` with the rejected alternatives preserved as a sub-section in that page (not separate pages — keeps them with the chosen one for context) |
| Standalone design choices stated in "Decisions committed" | One `wiki/decisions/<choice>.md` per non-trivial choice |
| New entities introduced (e.g. `BrainService`, `retrieval_hint`, `mergeAndRerank`) | One `wiki/concepts/<entity>.md` per entity that will be referenced from 2+ places |
| Failure-mode matrix entries | **Not** pre-emptively filed as bugs. Stay in the raw PRD until a failure actually materializes — then ingest the bug-fix session and create `wiki/bugs/<slug>.md`. |
| CEO/Eng/DX consensus tables, premise-challenge, dream-state delta | **Stay in `raw/`. Do not compile.** These are review process artifacts, not retrieval material. |
| Acceptance criteria, test plan, rollout plan | **Stay in `raw/`.** Reference the raw file from the flow page; don't duplicate. These belong to the work-tracking layer, not the memory layer. |
| "Deferred to TODOS" / "Not in scope" | **Stay in `raw/`.** Note the reference in `log.md` follow-ups so it's findable. Don't mirror into the wiki. |

**Status-aware ingest:**
- First PRD ingest → `wiki/flows/<feature>.md` is created with `status: proposed`. Data path describes the plan.
- When a `raw/sessions/<feature>-impl-notes.md` arrives later → update the same flow page, flip to `status: shipped`, replace planned data path with actual, fill `effort-actual`, update `Status history`.
- Existing decision/concept pages that the PRD impacts → updated, not duplicated.

### Query

When the human asks a question:

1. Read `index.md` first to find candidate pages.
2. Read those pages, follow `[[links]]` as needed.
3. Answer with **citations** — every non-trivial claim links to the wiki page (and through it, the raw source) it comes from.
4. **Offer to file the answer** if it represents new synthesis. A comparison table, a connection between two flows, a debugging postmortem — these are valuable and shouldn't disappear into chat history. Propose: "Want me to file this as `wiki/concepts/<name>.md`?"
5. Append a `query` entry to `log.md`.

### Lint

When the human asks for a lint pass:

- **Contradictions** — pages that disagree without flagging it
- **Stale claims** — pages that haven't been updated since superseding sources arrived
- **Orphans** — pages with no inbound links (probably mis-categorized or never integrated)
- **Missing concept pages** — entities/ideas mentioned 3+ times across pages but with no dedicated page
- **Broken `[[links]]`** — links to pages that don't exist
- **Index drift** — pages on disk not in `index.md`, or vice versa

Report findings; don't fix automatically. Human picks what to action.

## Page formats

All wiki pages start with YAML frontmatter. Use `[[wikilinks]]` (Obsidian-compatible) for cross-references.

### Decision (`wiki/decisions/<slug>.md`)

```markdown
---
type: decision
date: YYYY-MM-DD
status: active | superseded | rejected
tags: [...]
sources: [raw/<path>, raw/<path>]
supersedes: [[decisions/...]]   # optional
superseded_by: [[decisions/...]]  # optional
---

# <Short title — phrase as the decision, e.g. "Use MongoDB for product catalog">

## Context
What was the situation. What forced the decision.

## Decision
What we chose. One paragraph.

## Alternatives considered

| Approach | Completeness / fit | Effort | Verdict |
|---|---|---|---|
| **A: ...** | ... | ... | Rejected — <reason> |
| **B: ...** | ... | ... | Rejected — <reason> |
| **C (chosen): ...** | ... | ... | Chosen |
| **D: ...** | ... | ... | Deferred — <when to revisit> |

Preserve the table from the source PRD verbatim where possible. Future-us needs to see what was weighed *and* what was ruled out, with the reasoning intact.

## Tradeoffs accepted
What we lose by choosing this. The honest list.

## Revisit if
Conditions under which this should be reopened.

## Related
- [[flows/...]]
- [[concepts/...]]
```

### Bug playbook (`wiki/bugs/<slug>.md`)

```markdown
---
type: bug
date-fixed: YYYY-MM-DD
severity: high | medium | low
tags: [...]
sources: [raw/<path>]
linear: PROJ-123   # optional
---

# Bug: <short symptom-shaped name>

## Symptom
What was observed — by users, in logs, in metrics.

## Root cause
The actual underlying problem. Not "we fixed a typo" — explain *why* the typo broke things.

## Fix
What was changed. Reference commit SHAs if available.

## Detection
How to spot this class of bug in the future:
- Log signature
- Metric/alert
- Test that would catch it

## Why this happened
Contributing factors — design choice, missing test, unclear contract, etc. Optional but valuable.

## Related
- [[decisions/...]] (if a decision contributed)
- [[flows/...]] (the affected flow)
```

### Feature flow (`wiki/flows/<slug>.md`)

```markdown
---
type: flow
status: proposed | implemented | shipped | deprecated
last-updated: YYYY-MM-DD
date-proposed: YYYY-MM-DD
date-shipped: YYYY-MM-DD          # optional, fill on ship
effort-estimated: <e.g. "6 CC-hours">  # optional
effort-actual: <e.g. "11 CC-hours">    # optional, fill after ship
tags: [...]
sources: [raw/features/<spec>.md, raw/sessions/<impl-notes>.md, ...]
---

# Flow: <name>

> **Status:** proposed | implemented | shipped | deprecated
> One-line summary of the flow.

## Trigger
What kicks this off — user action, event, cron, etc.

## Data path
Step-by-step. Keep under ~15 numbered steps; if longer, split into sub-flows.

1. ...
2. ...

## Components touched
- `path/to/file.js` — what it does in this flow
- ...

## Edge cases
- Failure at step N
- Missing X
- ...

## Status history
- YYYY-MM-DD — proposed (sources: [[<spec>]])
- YYYY-MM-DD — implemented (sources: [[<impl-notes>]])
- YYYY-MM-DD — shipped

## Related
- [[bugs/...]]
- [[decisions/...]]
- [[concepts/...]]
```

**Lifecycle rules:**
- On first ingest of a feature spec → status `proposed`. Data path describes the *plan*.
- On post-ship ingest of impl-notes → flip to `shipped`. Data path corrected to match reality. Effort-actual filled.
- If the feature is later replaced → status `deprecated`, link to successor flow.

### Concept (`wiki/concepts/<slug>.md`)

```markdown
---
type: concept
last-updated: YYYY-MM-DD
tags: [...]
sources: [...]
---

# <Concept name>

Short definition (1-2 sentences).

## Details
Whatever's needed — invariants, mechanics, examples.

## Referenced by
- [[flows/...]]
- [[decisions/...]]
- [[bugs/...]]
```

## Index format (`index.md`)

Plain markdown, organized by category. One line per page:

```markdown
# Index

## Decisions
- [[decisions/use-mongodb]] — chose MongoDB for product catalog (2026-04-01)
- ...

## Bugs
- [[bugs/order-double-charge]] — Stripe webhook idempotency miss (2026-04-15, high)
- ...

## Flows
- [[flows/checkout]] — cart → order → payment → fulfillment
- ...

## Concepts
- [[concepts/order-state-machine]] — states an order moves through
- ...
```

Update on every ingest. If a page's one-line summary still accurately describes it, leave it alone.

## Log format (`log.md`)

Append-only. Every entry starts with a parseable header so `grep "^## \[" log.md` works.

```markdown
## [YYYY-MM-DD] ingest | <source path or short title>
- Pages created: [[...]], [[...]]
- Pages updated: [[...]], [[...]]
- Contradictions flagged: <count, with links if any>
- Follow-ups raised: <short list>

## [YYYY-MM-DD] query | <question summary>
- Pages consulted: [[...]], [[...]]
- Filed back: [[...]] (if anything)

## [YYYY-MM-DD] lint
- Contradictions: <count>
- Orphans: <count>
- Stale: <count>
- Action taken: <none | list>
```

## Conventions

- **Slugs:** kebab-case, descriptive. `use-mongodb-for-catalog` not `decision-1`.
- **Dates:** always ISO `YYYY-MM-DD`. Convert relative dates ("yesterday") to absolute.
- **Wikilinks:** `[[decisions/use-mongodb]]` (Obsidian-style, no `.md`).
- **Sources field:** path relative to repo root (`raw/slack/2026-05-06-db-thread.md`).
- **Don't invent specifics.** If a source says "we discussed alternatives" without naming them, don't list them. Note the gap.
- **Flag uncertainty.** If two sources disagree, surface it — `> ⚠ Contradicts ...:` — don't pick silently.
- **Prefer updates over new pages.** Two pages on "the checkout flow" is worse than one detailed page.

## Validation

The page formats above are also encoded — machine-readably — in `wiki.schema.json`
at the vault root. That file is the **single source of truth** a validator checks
pages against; this CLAUDE.md just describes the rules in prose. If the two ever
disagree, `wiki.schema.json` wins — fix the prose.

What gets checked, in two tiers:

- **Strict** (a validator fails on these): `type` present and valid; the
  required frontmatter keys for that type; enum values (`status`, `severity`);
  files living only in the declared `raw/` and `wiki/` subdirs; citation rules
  (every `wiki/` page has `sources:`, supersession edges are symmetric, no
  `[Inferred]` markers in `wiki/`).
- **Lint** (warn only, never fails): the *required* body sections for a type
  are present. Optional sections missing is silent — never pad a page with an
  empty `## Alternatives considered` just to satisfy a checker.

`wiki.schema.json` ships with `"strict": false`. While false, validation is
informational — a brand-new wiki for a half-finished project is *expected* to be
messy at first. Flip it to `true` once the wiki has matured and you want a hard
gate. Edit the schema freely as this project's conventions evolve.

## Workflow style

This wiki is maintained **interactively, one source at a time**. The human drops a source, we discuss, you write. Don't batch-ingest unless explicitly asked. Don't auto-run lint passes — wait for the request. The human stays in the loop because they're the one who knows what matters.

## What you should NOT do

- Don't modify anything in `raw/`. It's the source of truth.
- Don't summarize without filing — chat-only summaries are wasted work.
- Don't create pages without updating `index.md` and `log.md`.
- Don't write pages that just paraphrase the source. Synthesize, cross-reference, connect.
- Don't invent dates, names, file paths, or quotes.
