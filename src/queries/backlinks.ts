import type { DbClient } from '../db/client.ts';

export interface BacklinkRow {
  source: string;
  from_path: string;
  from_slug: string;
  from_title: string | null;
  occurrences: number;
}

export async function queryBacklinks(
  sql: DbClient,
  slug: string,
  opts: { source?: string } = {},
): Promise<BacklinkRow[]> {
  return opts.source
    ? await sql<BacklinkRow[]>`
        SELECT s.name AS source,
               from_p.path AS from_path,
               from_p.slug AS from_slug,
               from_p.title AS from_title,
               COUNT(*)::int AS occurrences
          FROM links l
          JOIN pages from_p ON from_p.id = l.from_page
          JOIN pages to_p   ON to_p.id   = l.to_page
          JOIN sources s    ON s.id      = l.source_id
         WHERE s.name = ${opts.source}
           AND to_p.slug = ${slug}
           AND to_p.source_id = s.id
           AND l.kind = 'wikilink'
         GROUP BY s.name, from_p.path, from_p.slug, from_p.title
         ORDER BY from_p.path
      `
    : await sql<BacklinkRow[]>`
        SELECT s.name AS source,
               from_p.path AS from_path,
               from_p.slug AS from_slug,
               from_p.title AS from_title,
               COUNT(*)::int AS occurrences
          FROM links l
          JOIN pages from_p ON from_p.id = l.from_page
          JOIN pages to_p   ON to_p.id   = l.to_page
          JOIN sources s    ON s.id      = l.source_id
         WHERE to_p.slug = ${slug}
           AND l.kind = 'wikilink'
         GROUP BY s.name, from_p.path, from_p.slug, from_p.title
         ORDER BY s.name, from_p.path
      `;
}
