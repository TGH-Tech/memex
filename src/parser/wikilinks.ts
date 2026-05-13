import { normalizeSlug } from './markdown.ts';

// PRD §6.3: backlinks are wikilink-only. Body text mentions, markdown `[text](path)`,
// and HTML anchors do NOT count. We extract literal `[[slug]]` and `[[slug|alias]]`
// occurrences (alias stripped), one row per occurrence.

const WIKILINK_RE = /\[\[([^\]\|]+)(?:\|[^\]]+)?\]\]/g;

// Strip code spans before extraction so example snippets like `[[fake-slug]]`
// inside ```code``` fences or `inline` code don't produce real DB edges.
function stripCode(body: string): string {
  let s = body.replace(/```[\s\S]*?```/g, '');   // fenced ``` ... ```
  s = s.replace(/~~~[\s\S]*?~~~/g, '');           // fenced ~~~ ... ~~~
  s = s.replace(/`[^`\n]+`/g, '');                // inline `...`
  return s;
}

export function extractWikilinks(body: string): string[] {
  const out: string[] = [];
  const stripped = stripCode(body);
  for (const m of stripped.matchAll(WIKILINK_RE)) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    // Symmetric with deriveSlug so `[[index.md]]` resolves to a page whose slug
    // is "index", and `[[wiki/decisions/foo]]` resolves to "decisions/foo".
    out.push(normalizeSlug(raw));
  }
  return out;
}

const RELATED_WIKILINK_RE = /^\[\[([^\]\|]+)(?:\|[^\]]+)?\]\]$/;

// Frontmatter `related:` may be authored as either raw slugs or wikilink-shaped.
// Accept both forms; preserve order and duplicates.
//
// Obsidian convention writes `related: [[concepts/foo]]` unquoted in YAML, which
// pure YAML parses as a NESTED list ([["concepts/foo"]]). We flatten recursively
// so both `related: [["concepts/foo"]]` (YAML's nested view) and
// `related: ["[[concepts/foo]]"]` (quoted) and `related: ["concepts/foo"]` all work.
export function extractRelated(frontmatter: Record<string, unknown>): string[] {
  const out: string[] = [];
  collectRelated(frontmatter.related, out);
  return out;
}

function collectRelated(val: unknown, out: string[]): void {
  if (typeof val === 'string') {
    const match = val.match(RELATED_WIKILINK_RE);
    const raw = (match ? match[1] : val)?.trim();
    if (raw) out.push(normalizeSlug(raw));
  } else if (Array.isArray(val)) {
    for (const item of val) collectRelated(item, out);
  }
  // ignore everything else (numbers, objects, null)
}
