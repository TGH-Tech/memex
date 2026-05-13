import { getClient } from '../db/client.ts';
import { queryBacklinks } from '../queries/backlinks.ts';

export async function runBacklinks(
  slug: string,
  opts: { source?: string },
): Promise<void> {
  const sql = await getClient();
  try {
    const rows = await queryBacklinks(sql, slug, opts);
    if (rows.length === 0) {
      const scope = opts.source ? ` in source "${opts.source}"` : '';
      console.log(`No inbound wikilinks to [[${slug}]]${scope}.`);
      return;
    }

    const showSource = !opts.source;
    const sourceLabel = opts.source
      ? ` (source: ${opts.source})`
      : ` across ${new Set(rows.map((r) => r.source)).size} source(s)`;
    console.log(`Inbound wikilinks to [[${slug}]]${sourceLabel}:`);

    const sourceW = Math.max('SOURCE'.length, ...rows.map((r) => r.source.length));
    const pathW = Math.max('FROM'.length, ...rows.map((r) => r.from_path.length));

    for (const r of rows) {
      const occ = r.occurrences > 1 ? ` (×${r.occurrences})` : '';
      if (showSource) {
        console.log(`  ${r.source.padEnd(sourceW)}   ${r.from_path.padEnd(pathW)}${occ}`);
      } else {
        console.log(`  ${r.from_path}${occ}`);
      }
    }

    const total = rows.reduce((n, r) => n + r.occurrences, 0);
    const pageWord = rows.length === 1 ? 'page' : 'pages';
    const occWord = total === 1 ? 'occurrence' : 'occurrences';
    console.log(`${rows.length} citing ${pageWord}, ${total} ${occWord}.`);
  } finally {
    await sql.end({ timeout: 1 });
  }
}
