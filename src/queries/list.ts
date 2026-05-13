import type { DbClient } from '../db/client.ts';

export interface ListRow {
  source: string;
  slug: string;
  type: string;
  title: string | null;
}

export interface ListOptions {
  source?: string;
  type?: string;
}

export async function queryList(
  sql: DbClient,
  opts: ListOptions = {},
): Promise<ListRow[]> {
  const sourceFilter = opts.source ? sql`AND s.name = ${opts.source}` : sql``;
  const typeFilter = opts.type ? sql`AND p.type = ${opts.type}` : sql``;
  return await sql<ListRow[]>`
    SELECT s.name AS source, p.slug, p.type, p.title
      FROM pages p
      JOIN sources s ON s.id = p.source_id
     WHERE 1=1
       ${sourceFilter}
       ${typeFilter}
     ORDER BY s.name, p.slug
  `;
}
