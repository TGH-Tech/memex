import { getClient } from '../db/client.ts';
import { querySearch } from '../queries/search.ts';

export async function runSearch(
  query: string,
  opts: { source?: string; topK?: number },
): Promise<void> {
  if (query.trim().length === 0) {
    console.error('✘ Query is empty.');
    process.exit(1);
  }
  const rawTopK = opts.topK;
  const topK =
    typeof rawTopK === 'number' && Number.isFinite(rawTopK) && rawTopK > 0
      ? Math.floor(rawTopK)
      : 10;

  const sql = await getClient();
  try {
    const rows = await querySearch(sql, query, { source: opts.source, topK });
    if (rows.length === 0) {
      const scope = opts.source ? ` in source "${opts.source}"` : '';
      console.log(`No matches for "${query}"${scope}.`);
      return;
    }
    for (const r of rows) {
      const title = r.title ?? '(untitled)';
      const rankStr = r.rank.toFixed(3);
      console.log(`[${r.source}] ${r.slug}  (rank: ${rankStr}, type: ${r.type})`);
      console.log(`  ${title}`);
      if (r.snippet) {
        console.log(`  ${r.snippet.replace(/\s+/g, ' ').trim()}`);
      }
      console.log();
    }
    const word = rows.length === 1 ? 'result' : 'results';
    console.log(`${rows.length} ${word}.`);
  } finally {
    await sql.end({ timeout: 1 });
  }
}
