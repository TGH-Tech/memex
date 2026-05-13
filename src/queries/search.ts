import type { DbClient } from '../db/client.ts';

export interface SearchRow {
  source: string;
  slug: string;
  type: string;
  title: string | null;
  rank: number;
  snippet: string;
}

const HEADLINE_OPTS =
  'StartSel=«, StopSel=», MaxFragments=2, MaxWords=20, MinWords=5, FragmentDelimiter=" … "';

export interface SearchOptions {
  source?: string;
  topK?: number;
}

/**
 * Hybrid-search-ready keyword retrieval over `pages.body_tsv`. Returns ranked
 * rows with highlighted snippets. CLI prints them; MCP returns them as JSON.
 * Empty/whitespace queries are caller's responsibility to reject — this
 * function would return no rows but that's misleading UX.
 */
export async function querySearch(
  sql: DbClient,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchRow[]> {
  const topK = opts.topK && opts.topK > 0 ? Math.floor(opts.topK) : 10;
  const sourceFilter = opts.source ? sql`AND s.name = ${opts.source}` : sql``;
  return await sql<SearchRow[]>`
    SELECT s.name AS source,
           p.slug,
           p.type,
           p.title,
           ts_rank(p.body_tsv, q) AS rank,
           ts_headline('english', p.body, q, ${HEADLINE_OPTS}) AS snippet
      FROM pages p
      JOIN sources s ON s.id = p.source_id,
           websearch_to_tsquery('english', ${query}) q
     WHERE p.body_tsv @@ q
       ${sourceFilter}
     ORDER BY rank DESC, s.name, p.slug
     LIMIT ${topK}
  `;
}
