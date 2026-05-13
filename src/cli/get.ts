import { getClient } from '../db/client.ts';
import { queryGet } from '../queries/get.ts';

export async function runGet(slug: string, opts: { source: string }): Promise<void> {
  const sql = await getClient();
  try {
    const row = await queryGet(sql, slug, opts.source);
    if (!row) {
      console.error(`✘ Page "${slug}" not found in source "${opts.source}".`);
      process.exit(1);
    }

    console.log('---');
    console.log(`type: ${row.type}`);
    console.log(`status: ${row.status}`);
    if (row.author) console.log(`author: ${row.author}`);
    if (Array.isArray(row.co_authors) && row.co_authors.length > 0) {
      console.log(`co_authors: ${JSON.stringify(row.co_authors)}`);
    }
    if (row.date) {
      const d = new Date(row.date);
      console.log(`date: ${d.toISOString().slice(0, 10)}`);
    }
    if (row.supersedes_slug) console.log(`supersedes: [[${row.supersedes_slug}]]`);
    if (row.superseded_by_slug) console.log(`superseded_by: [[${row.superseded_by_slug}]]`);
    if (Array.isArray(row.revision_history) && row.revision_history.length > 0) {
      console.log(`revision_history: ${JSON.stringify(row.revision_history)}`);
    }
    for (const [k, v] of Object.entries(row.frontmatter)) {
      console.log(`${k}: ${formatFrontmatterValue(v)}`);
    }
    console.log('---');
    if (row.body.length > 0) {
      console.log();
      console.log(row.body);
    }
  } finally {
    await sql.end({ timeout: 1 });
  }
}

function formatFrontmatterValue(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}
