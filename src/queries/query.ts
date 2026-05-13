import type { DbClient } from '../db/client.ts';
import { embedBatch } from '../embed/openai.ts';
import { loadConfig } from '../db/config.ts';
import { dedupeResults, type DedupStats } from './dedup.ts';
import { expandQuery } from './expand.ts';
import { rrfFuse, type RankedList } from './rrf.ts';

/**
 * Hybrid retrieval pipeline (PRD §9):
 *
 *    expand   →  embed (batched)  →  retrieve (vector × N + keyword × 1)
 *           →  fuse (RRF k=60)   →  re-rank (cosine vs ORIGINAL)
 *           →  backlink boost    →  3-layer dedup    →  top-K
 *
 * The function never throws on degraded subsystems: missing API key drops to
 * keyword-only; expansion failure drops to single-vector + keyword; both down
 * still returns keyword-only results. The caller learns about degradation via
 * `report.degradations`.
 */

// ─── Retrieval breadth tuning ──────────────────────────────────────────────
// Each individual retrieval list returns this many results. With 4 vector
// lists + 1 keyword list and good agreement, we have ~30-150 unique candidates
// pre-dedup; that's a comfortable working set to re-rank.
const PER_LIST_TOP_K = 30;

// After fusion, we keep this many candidates to re-rank. Anything past here is
// extremely unlikely to surface in the top-K user-facing results.
const POST_FUSION_KEEP = 60;

// Backlink boost — empirically tuned in the PRD. Capped so a single 200-backlink
// hub page doesn't drown out everything else.
const BACKLINK_CAP = 10;
const BACKLINK_BOOST_FACTOR = 0.1;

// Display cap for chunk content in the returned rows. Full content is also
// available in the chunks table if a downstream tool wants more.
const CHUNK_DISPLAY_CHARS = 600;

export interface QueryOptions {
  source?: string;
  topK?: number;
  /** Disable expansion explicitly. Federated queries also skip it by default. */
  noExpand?: boolean;
}

export interface QueryRow {
  source: string;
  slug: string;
  path: string;
  type: string;
  title: string | null;
  /** Best chunk's H2 heading (null for preamble chunks). */
  heading: string | null;
  /** Best chunk's content, truncated to CHUNK_DISPLAY_CHARS. */
  content: string;
  /** Keyword search snippet with «»-wrapped match highlights, if any. */
  snippet: string | null;
  /** Final score after re-rank + backlink boost. */
  score: number;
  /** Cosine similarity (1 - distance) against the original query embedding. */
  cosineSim: number;
  /** Inbound wikilink count, capped contribution-wise but reported raw. */
  backlinks: number;
  /** Per-source ranks for the "(vector: N, keyword: N)" display. */
  ranks: {
    /** Best 1-indexed rank across the up-to-4 vector lists. */
    vectorBest?: number;
    /** Number of vector lists this page appeared in. */
    vectorLists?: number;
    /** 1-indexed rank in the keyword list. */
    keyword?: number;
  };
}

export interface QueryReport {
  query: string;
  /** The 3 expansions actually used (empty if expansion was skipped/failed). */
  expansions: string[];
  expansionSource: 'cache' | 'api' | 'disabled' | 'fallback';
  /** True if at least the original-query embedding succeeded. */
  vectorEnabled: boolean;
  rows: QueryRow[];
  /** Number of results dropped by 3-layer dedup. */
  dedupStats: DedupStats;
  /** Non-fatal subsystem failures the caller may want to surface. */
  degradations: string[];
  durationMs: number;
}

interface ChunkRow {
  chunk_id: number;
  page_id: number;
  distance: number;
}

interface KeywordRow {
  page_id: number;
  source_name: string;
  slug: string;
  path: string;
  type: string;
  title: string | null;
  rank: number;
  snippet: string;
}

interface PageDetailRow {
  page_id: number;
  source_name: string;
  slug: string;
  path: string;
  type: string;
  title: string | null;
  content_hash: string;
  chunk_id: number | null;
  chunk_heading: string | null;
  chunk_content: string | null;
  /** Distance against the original embedding; null when page has no embedded chunks. */
  distance: number | null;
}

interface BacklinkCountRow {
  page_id: number;
  backlinks: number;
}

export async function runHybridQuery(
  sql: DbClient,
  query: string,
  opts: QueryOptions = {},
): Promise<QueryReport> {
  const start = Date.now();
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    throw new Error('query is empty');
  }

  const topK = opts.topK && opts.topK > 0 ? Math.floor(opts.topK) : 10;
  const sourceFilter = opts.source ?? null;
  const degradations: string[] = [];

  // ─── 1. Query expansion ──────────────────────────────────────────────────
  const config = await loadConfig();
  // Skip expansion when (a) caller said no, (b) globally disabled, or
  // (c) the query is federated. PRD §9 step 2: federated retrieval already
  // covers more ground, so the cost-quality tradeoff of expansion gets worse.
  const shouldExpand =
    !opts.noExpand && config.multiQueryEnabled && sourceFilter !== null;
  let expansions: string[] = [];
  let expansionSource: QueryReport['expansionSource'] = 'disabled';
  if (shouldExpand) {
    const exp = await expandQuery(trimmed);
    if (exp.kind === 'ok') {
      expansions = exp.expansions;
      expansionSource = exp.cached ? 'cache' : 'api';
    } else {
      expansionSource = 'fallback';
      degradations.push(`query expansion: ${exp.reason}`);
    }
  }

  // ─── 2. Embed original + expansions in ONE batched call ──────────────────
  const textsToEmbed = [trimmed, ...expansions];
  const embedResult = await embedBatch(textsToEmbed);
  let originalEmbedding: number[] | null = null;
  let expansionEmbeddings: number[][] = [];
  let vectorEnabled = false;
  if (embedResult.kind === 'ok') {
    originalEmbedding = embedResult.vectors[0] ?? null;
    expansionEmbeddings = embedResult.vectors.slice(1);
    vectorEnabled = originalEmbedding !== null;
  } else {
    degradations.push(`embedding: ${embedResult.message}`);
  }

  // Sort embeddings into named lists so RRF output keeps a stable breakdown.
  const vectorEmbeddings: Array<{ name: string; vec: number[] }> = [];
  if (originalEmbedding) vectorEmbeddings.push({ name: 'vector-original', vec: originalEmbedding });
  for (let i = 0; i < expansionEmbeddings.length; i++) {
    vectorEmbeddings.push({ name: `vector-exp-${i + 1}`, vec: expansionEmbeddings[i]! });
  }

  // ─── 3. Retrieval — vector lists + keyword list in parallel ──────────────
  const vectorPromises = vectorEmbeddings.map((ve) =>
    runVectorQuery(sql, ve.vec, sourceFilter, PER_LIST_TOP_K).then((rows) => ({
      name: ve.name,
      rows,
    })),
  );
  const keywordPromise = runKeywordQuery(sql, trimmed, sourceFilter, PER_LIST_TOP_K);
  const [vectorListsRaw, keywordRows] = await Promise.all([
    Promise.all(vectorPromises),
    keywordPromise,
  ]);

  // ─── 4. Collapse vector chunks → per-page best (min distance per list) ───
  const vectorPageLists: Array<{ name: string; pageIds: string[] }> = [];
  for (const { name, rows } of vectorListsRaw) {
    const bestByPage = new Map<number, number>();
    for (const r of rows) {
      const prev = bestByPage.get(r.page_id);
      if (prev === undefined || r.distance < prev) bestByPage.set(r.page_id, r.distance);
    }
    const sortedPageIds = [...bestByPage.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([pid]) => String(pid));
    vectorPageLists.push({ name, pageIds: sortedPageIds });
  }
  const keywordPageList: string[] = keywordRows.map((r) => String(r.page_id));

  // ─── 5. RRF fuse — 5 lists down to one ───────────────────────────────────
  const rankedLists: RankedList[] = [
    ...vectorPageLists.map((l) => ({ name: l.name, ids: l.pageIds })),
    { name: 'keyword', ids: keywordPageList },
  ];
  const fused = rrfFuse(rankedLists, config.rrfK);
  if (fused.length === 0) {
    return {
      query: trimmed,
      expansions,
      expansionSource,
      vectorEnabled,
      rows: [],
      dedupStats: { kept: 0, droppedByPath: 0, droppedBySlug: 0, droppedByHash: 0 },
      degradations,
      durationMs: Date.now() - start,
    };
  }
  const candidates = fused.slice(0, POST_FUSION_KEEP);
  const candidateIds = candidates.map((c) => Number(c.id));

  // ─── 6. Re-rank: best chunk vs ORIGINAL embedding (single JOINed query) ──
  // Even if vectorEnabled=false (no original embedding), we still need page
  // detail for the candidates. Pass NULL embedding and the chunk-distance
  // LATERAL skips — pages fall back to the keyword-only path.
  const origVec = originalEmbedding ? `[${originalEmbedding.join(',')}]` : null;
  const pageDetails = await fetchPageDetails(sql, candidateIds, origVec);
  const pageDetailById = new Map<number, PageDetailRow>();
  for (const pd of pageDetails) pageDetailById.set(pd.page_id, pd);

  // ─── 7. Backlinks for all candidates (one query) ─────────────────────────
  const backlinkCounts = await fetchBacklinkCounts(sql, candidateIds);
  const backlinksById = new Map<number, number>();
  for (const b of backlinkCounts) backlinksById.set(b.page_id, b.backlinks);

  // ─── 8. Compute final scores ─────────────────────────────────────────────
  // Cosine sim = 1 - cosine distance (pgvector's <=> is cosine distance).
  // For pages with no original-embedding cosine (no embedded chunks AND we
  // had an original embedding to compare), use the normalized fused score
  // as the proxy. This keeps strong keyword-only hits visible.
  const maxFusedScore = Math.max(...candidates.map((c) => c.score), Number.EPSILON);
  interface ScoredRow {
    pageDetail: PageDetailRow;
    cosineSim: number;
    fusedScore: number;
    backlinks: number;
    score: number;
    ranks: QueryRow['ranks'];
    snippet: string | null;
  }
  const keywordSnippetByPage = new Map<number, string>();
  for (const k of keywordRows) keywordSnippetByPage.set(k.page_id, k.snippet);

  const scored: ScoredRow[] = [];
  for (const c of candidates) {
    const pageId = Number(c.id);
    const pd = pageDetailById.get(pageId);
    if (!pd) continue; // page row gone since fusion — skip

    const cosineSim = pd.distance !== null ? Math.max(0, 1 - pd.distance) : 0;
    // Fall back to fused-score-normalized when cosine isn't available.
    const baseScore = pd.distance !== null ? cosineSim : c.score / maxFusedScore;
    const backlinks = backlinksById.get(pageId) ?? 0;
    const boost = 1 + BACKLINK_BOOST_FACTOR * Math.min(backlinks, BACKLINK_CAP);
    const score = baseScore * boost;

    // Build the rank breakdown for display.
    const ranks: QueryRow['ranks'] = {};
    const vectorRanks: number[] = [];
    for (const name of Object.keys(c.ranks)) {
      if (name.startsWith('vector-')) vectorRanks.push(c.ranks[name]!);
    }
    if (vectorRanks.length > 0) {
      ranks.vectorBest = Math.min(...vectorRanks);
      ranks.vectorLists = vectorRanks.length;
    }
    if (c.ranks.keyword !== undefined) ranks.keyword = c.ranks.keyword;

    scored.push({
      pageDetail: pd,
      cosineSim,
      fusedScore: c.score,
      backlinks,
      score,
      ranks,
      snippet: keywordSnippetByPage.get(pageId) ?? null,
    });
  }
  scored.sort((a, b) => b.score - a.score);

  // ─── 9. 3-layer dedup ────────────────────────────────────────────────────
  const dedupInput = scored.map((s) => ({
    ...s,
    source: s.pageDetail.source_name,
    path: s.pageDetail.path,
    slug: s.pageDetail.slug,
    contentHash: s.pageDetail.content_hash,
  }));
  const { kept, stats } = dedupeResults(dedupInput);

  // ─── 10. Pack rows for output, capped at user-requested top-K ────────────
  const rows: QueryRow[] = kept.slice(0, topK).map((s) => ({
    source: s.pageDetail.source_name,
    slug: s.pageDetail.slug,
    path: s.pageDetail.path,
    type: s.pageDetail.type,
    title: s.pageDetail.title,
    heading: s.pageDetail.chunk_heading,
    content: truncateContent(s.pageDetail.chunk_content ?? ''),
    snippet: s.snippet,
    score: s.score,
    cosineSim: s.cosineSim,
    backlinks: s.backlinks,
    ranks: s.ranks,
  }));

  return {
    query: trimmed,
    expansions,
    expansionSource,
    vectorEnabled,
    rows,
    dedupStats: stats,
    degradations,
    durationMs: Date.now() - start,
  };
}

function truncateContent(content: string): string {
  if (content.length <= CHUNK_DISPLAY_CHARS) return content;
  return content.slice(0, CHUNK_DISPLAY_CHARS) + '…';
}

async function runVectorQuery(
  sql: DbClient,
  embedding: number[],
  source: string | null,
  topK: number,
): Promise<ChunkRow[]> {
  // page_id::int cast so postgres-js gives JS numbers not BIGINT-as-string.
  // Page IDs fit comfortably in int4 (2.1B rows would be a lot of pages).
  const literal = `[${embedding.join(',')}]`;
  if (source !== null) {
    return await sql<ChunkRow[]>`
      SELECT c.id::int AS chunk_id,
             c.page_id::int AS page_id,
             (c.embedding <=> ${literal}::vector) AS distance
        FROM chunks c
        JOIN sources s ON s.id = c.source_id
       WHERE c.embedding IS NOT NULL
         AND s.name = ${source}
       ORDER BY c.embedding <=> ${literal}::vector
       LIMIT ${topK}
    `;
  }
  return await sql<ChunkRow[]>`
    SELECT c.id::int AS chunk_id,
           c.page_id::int AS page_id,
           (c.embedding <=> ${literal}::vector) AS distance
      FROM chunks c
     WHERE c.embedding IS NOT NULL
     ORDER BY c.embedding <=> ${literal}::vector
     LIMIT ${topK}
  `;
}

const KEYWORD_HEADLINE_OPTS =
  'StartSel=«, StopSel=», MaxFragments=2, MaxWords=20, MinWords=5, FragmentDelimiter=" … "';

async function runKeywordQuery(
  sql: DbClient,
  query: string,
  source: string | null,
  topK: number,
): Promise<KeywordRow[]> {
  if (source !== null) {
    return await sql<KeywordRow[]>`
      SELECT p.id::int AS page_id,
             s.name AS source_name,
             p.slug,
             p.path,
             p.type,
             p.title,
             ts_rank(p.body_tsv, q) AS rank,
             ts_headline('english', p.body, q, ${KEYWORD_HEADLINE_OPTS}) AS snippet
        FROM pages p
        JOIN sources s ON s.id = p.source_id,
             websearch_to_tsquery('english', ${query}) q
       WHERE p.body_tsv @@ q
         AND s.name = ${source}
       ORDER BY rank DESC, s.name, p.slug
       LIMIT ${topK}
    `;
  }
  return await sql<KeywordRow[]>`
    SELECT p.id::int AS page_id,
           s.name AS source_name,
           p.slug,
           p.path,
           p.type,
           p.title,
           ts_rank(p.body_tsv, q) AS rank,
           ts_headline('english', p.body, q, ${KEYWORD_HEADLINE_OPTS}) AS snippet
      FROM pages p
      JOIN sources s ON s.id = p.source_id,
           websearch_to_tsquery('english', ${query}) q
     WHERE p.body_tsv @@ q
     ORDER BY rank DESC, s.name, p.slug
     LIMIT ${topK}
  `;
}

/**
 * Page metadata + best chunk against the original embedding, in one query.
 * LEFT JOIN handles pages whose chunks have no embedding (graceful-degrade
 * path from /review fix #1) — they still surface with NULL distance.
 *
 * When origEmbedding is null (no original embedding at all), the LATERAL
 * is short-circuited via a stub literal that matches the index sort order
 * but produces NULL distances downstream. The CASE collapses to NULL.
 */
async function fetchPageDetails(
  sql: DbClient,
  pageIds: number[],
  origEmbedding: string | null,
): Promise<PageDetailRow[]> {
  if (pageIds.length === 0) return [];

  if (origEmbedding === null) {
    // Keyword-only path. No embedding to compare against; return pages with
    // NULL distance and we'll fall back to fused-score in the caller.
    return await sql<PageDetailRow[]>`
      SELECT p.id::int AS page_id,
             s.name AS source_name,
             p.slug, p.path, p.type, p.title,
             p.hash AS content_hash,
             NULL::int AS chunk_id,
             NULL::text AS chunk_heading,
             NULL::text AS chunk_content,
             NULL::float8 AS distance
        FROM pages p
        JOIN sources s ON s.id = p.source_id
       WHERE p.id = ANY(${pageIds}::bigint[])
    `;
  }

  return await sql<PageDetailRow[]>`
    SELECT p.id::int AS page_id,
           s.name AS source_name,
           p.slug, p.path, p.type, p.title,
           p.hash AS content_hash,
           best.chunk_id::int AS chunk_id,
           best.chunk_heading,
           best.chunk_content,
           best.distance
      FROM pages p
      JOIN sources s ON s.id = p.source_id
      LEFT JOIN LATERAL (
        SELECT c.id AS chunk_id,
               c.heading AS chunk_heading,
               c.content AS chunk_content,
               (c.embedding <=> ${origEmbedding}::vector) AS distance
          FROM chunks c
         WHERE c.page_id = p.id
           AND c.embedding IS NOT NULL
         ORDER BY c.embedding <=> ${origEmbedding}::vector
         LIMIT 1
      ) best ON TRUE
     WHERE p.id = ANY(${pageIds}::bigint[])
  `;
}

async function fetchBacklinkCounts(
  sql: DbClient,
  pageIds: number[],
): Promise<BacklinkCountRow[]> {
  if (pageIds.length === 0) return [];
  return await sql<BacklinkCountRow[]>`
    SELECT to_page::int AS page_id, COUNT(*)::int AS backlinks
      FROM links
     WHERE to_page = ANY(${pageIds}::bigint[])
       AND kind = 'wikilink'
     GROUP BY to_page
  `;
}
