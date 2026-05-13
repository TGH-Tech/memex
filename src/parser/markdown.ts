import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import matter from 'gray-matter';

export interface ParsedPage {
  /** vault-relative POSIX path, e.g. "wiki/decisions/foo.md" */
  path: string;
  /** stable identifier across renames-by-frontmatter, e.g. "decisions/foo" */
  slug: string;
  /** decision | flow | bug | concept | feature | session | other (overridable per source later) */
  type: string;
  /** human-readable title (frontmatter > first H1 > slug tail) */
  title: string;

  // ── Typed columns (PRD §6.1). Stripped from `frontmatter` JSONB so they
  //    never drift; typed columns win. ──────────────────────────────────────
  /** 'active' | 'proposed' | 'superseded' | 'deprecated' (per-source extensible) */
  status: string;
  /** primary decider (single name) */
  author: string | null;
  /** drafters/proposers — array of names */
  coAuthors: unknown[];
  /** frontmatter `date:` field, parsed */
  date: Date | null;
  /** this page replaces <supersedes_slug>; bare slug after normalization */
  supersedesSlug: string | null;
  /** this page is replaced by <superseded_by_slug>; bare slug after normalization */
  supersededBySlug: string | null;
  /** append-only list of meaningful changes (gray-matter parses as array) */
  revisionHistory: unknown[];

  /** unknown / per-source frontmatter — typed keys above are stripped */
  frontmatter: Record<string, unknown>;
  /** raw markdown body, byte-equal to the source minus the frontmatter block */
  body: string;
  /** sha256 of the full file contents (frontmatter + body) */
  hash: string;
  mtime: Date;
  /** true when path starts with "raw/" — raw notes are kept indexable but flagged */
  isRaw: boolean;
}

const TYPE_BY_DIR: Record<string, string> = {
  decisions: 'decision',
  flows: 'flow',
  bugs: 'bug',
  concepts: 'concept',
  features: 'feature',
  sessions: 'session',
};

/**
 * Normalize a slug-like string. Applied to BOTH file paths (when deriving the
 * canonical slug for a page) AND wikilink targets (when extracting [[...]]).
 *
 * Symmetric normalization is what makes `[[index.md]]` resolve to the page whose
 * file is `index.md` (slug "index"). Without it, wikilinks written with the .md
 * extension or with a leading `wiki/` prefix never resolve.
 */
export function normalizeSlug(s: string): string {
  let n = s.replace(/\.md$/i, '');
  if (n.startsWith('wiki/')) n = n.slice('wiki/'.length);
  return n;
}

export function deriveSlug(relPath: string): string {
  return normalizeSlug(relPath);
}

export function inferType(
  relPath: string,
  frontmatter: Record<string, unknown>,
): string {
  const fmType = frontmatter.type;
  if (typeof fmType === 'string' && fmType.length > 0) return fmType;
  const segments = relPath.split('/');
  const second = segments[1];
  if (second) {
    const mapped = TYPE_BY_DIR[second];
    if (mapped) return mapped;
  }
  return 'other';
}

export function inferTitle(
  body: string,
  frontmatter: Record<string, unknown>,
  slug: string,
): string {
  const fmTitle = frontmatter.title;
  if (typeof fmTitle === 'string' && fmTitle.trim().length > 0) {
    return fmTitle.trim();
  }
  const h1 = body.match(/^#\s+(.+?)\s*$/m);
  if (h1 && h1[1]) return h1[1].trim();
  const tail = slug.split('/').pop();
  return tail && tail.length > 0 ? tail : slug;
}

/**
 * Resolve a frontmatter field that may reference another page. Accepts:
 *   - `supersedes: [[X]]`        (YAML nested list)
 *   - `supersedes: "[[X]]"`      (quoted wikilink)
 *   - `supersedes: X`            (raw slug)
 *   - `supersedes: [X, Y]`       (returns first usable entry)
 * Returns the normalized bare slug, or null when nothing usable is present.
 */
function normalizeWikilinkRef(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (Array.isArray(val)) {
    for (const item of val) {
      const result = normalizeWikilinkRef(item);
      if (result) return result;
    }
    return null;
  }
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^\[\[([^\]\|]+)(?:\|[^\]]+)?\]\]$/);
  const raw = (match && match[1] ? match[1] : trimmed).trim();
  return raw ? normalizeSlug(raw) : null;
}

interface ExtractedTyped {
  status: string;
  author: string | null;
  coAuthors: unknown[];
  date: Date | null;
  supersedesSlug: string | null;
  supersededBySlug: string | null;
  revisionHistory: unknown[];
  /** frontmatter copy with all typed keys removed */
  remaining: Record<string, unknown>;
}

/**
 * Pull typed columns out of frontmatter and return a frontmatter copy with
 * those keys stripped. Sync writes the stripped copy into the JSONB column,
 * so we never have two sources of truth.
 */
export function extractTypedColumns(fm: Record<string, unknown>): ExtractedTyped {
  const rest = { ...fm };

  // type + title are already stored in their own columns (pages.type, pages.title) —
  // strip from JSONB to avoid duplicate display + drift.
  delete rest.type;
  delete rest.title;

  const status =
    typeof rest.status === 'string' && rest.status.length > 0 ? rest.status : 'active';
  delete rest.status;

  const author = typeof rest.author === 'string' && rest.author.length > 0 ? rest.author : null;
  delete rest.author;

  const coAuthors = Array.isArray(rest.co_authors) ? rest.co_authors : [];
  delete rest.co_authors;

  // gray-matter parses ISO dates as JS Date; YAML dates as Date; everything else stays string.
  let date: Date | null = null;
  if (rest.date instanceof Date && !Number.isNaN(rest.date.getTime())) {
    date = rest.date;
  } else if (typeof rest.date === 'string' && rest.date.length > 0) {
    const d = new Date(rest.date);
    if (!Number.isNaN(d.getTime())) date = d;
  }
  delete rest.date;

  const supersedesSlug = normalizeWikilinkRef(rest.supersedes);
  delete rest.supersedes;

  const supersededBySlug = normalizeWikilinkRef(rest.superseded_by);
  delete rest.superseded_by;

  const revisionHistory = Array.isArray(rest.revision_history) ? rest.revision_history : [];
  delete rest.revision_history;

  return {
    status,
    author,
    coAuthors,
    date,
    supersedesSlug,
    supersededBySlug,
    revisionHistory,
    remaining: rest,
  };
}

/**
 * Hash the raw file content. Exported so sync can compute the hash without
 * parsing — used by the hash-skip fast path.
 */
export function hashContent(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Parse a markdown file from pre-loaded content. Separating I/O from parsing
 * lets sync read the file once for the hash-skip decision and reuse the bytes
 * if a reparse is needed.
 */
export function parseRaw(
  raw: string,
  hash: string,
  relPath: string,
  mtime: Date,
): ParsedPage {
  const parsed = matter(raw);
  const frontmatter = (parsed.data ?? {}) as Record<string, unknown>;
  const body = parsed.content;
  const slug = deriveSlug(relPath);
  const type = inferType(relPath, frontmatter);
  const title = inferTitle(body, frontmatter, slug);
  const typed = extractTypedColumns(frontmatter);
  return {
    path: relPath,
    slug,
    type,
    title,
    status: typed.status,
    author: typed.author,
    coAuthors: typed.coAuthors,
    date: typed.date,
    supersedesSlug: typed.supersedesSlug,
    supersededBySlug: typed.supersededBySlug,
    revisionHistory: typed.revisionHistory,
    frontmatter: typed.remaining,
    body,
    hash,
    mtime,
    isRaw: relPath.startsWith('raw/'),
  };
}

/**
 * Read + hash + parse. Convenience wrapper for one-shot use; sync prefers the
 * split (read+hash first, then conditional parseRaw) so it can skip parsing
 * when the hash already matches the DB.
 */
export async function parsePage(
  absPath: string,
  relPath: string,
  mtime: Date,
): Promise<ParsedPage> {
  const raw = await readFile(absPath, 'utf8');
  const hash = hashContent(raw);
  return parseRaw(raw, hash, relPath, mtime);
}
