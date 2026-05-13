import type { DbClient } from '../db/client.ts';

export interface PageRow {
  source: string;
  path: string;
  slug: string;
  type: string;
  title: string | null;
  status: string;
  author: string | null;
  co_authors: unknown[];
  date: Date | null;
  supersedes_slug: string | null;
  superseded_by_slug: string | null;
  revision_history: unknown[];
  frontmatter: Record<string, unknown>;
  body: string;
  mtime: Date;
  content_version: number;
}

export async function queryGet(
  sql: DbClient,
  slug: string,
  source: string,
): Promise<PageRow | null> {
  const rows = await sql<PageRow[]>`
    SELECT s.name AS source,
           p.path, p.slug, p.type, p.title,
           p.status, p.author, p.co_authors, p.date,
           p.supersedes_slug, p.superseded_by_slug, p.revision_history,
           p.frontmatter, p.body, p.mtime,
           p.content_version::int AS content_version
      FROM pages p
      JOIN sources s ON s.id = p.source_id
     WHERE s.name = ${source}
       AND p.slug = ${slug}
     LIMIT 1
  `;
  return rows[0] ?? null;
}
