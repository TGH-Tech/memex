import { getClient } from '../db/client.ts';
import { queryList } from '../queries/list.ts';

export async function runList(opts: { source?: string; type?: string }): Promise<void> {
  const sql = await getClient();
  try {
    const rows = await queryList(sql, opts);
    if (rows.length === 0) {
      const scope = opts.source ? ` in source "${opts.source}"` : '';
      const typeScope = opts.type ? ` of type "${opts.type}"` : '';
      console.log(`No pages${typeScope}${scope}.`);
      return;
    }

    const showSource = !opts.source;
    const sourceW = Math.max('SOURCE'.length, ...rows.map((r) => r.source.length));
    const slugW = Math.max('SLUG'.length, ...rows.map((r) => r.slug.length));
    const typeW = Math.max('TYPE'.length, ...rows.map((r) => r.type.length));

    const header = showSource
      ? `${'SOURCE'.padEnd(sourceW)}   ${'SLUG'.padEnd(slugW)}   ${'TYPE'.padEnd(typeW)}   TITLE`
      : `${'SLUG'.padEnd(slugW)}   ${'TYPE'.padEnd(typeW)}   TITLE`;
    console.log(header);

    for (const r of rows) {
      const title = r.title ?? '(untitled)';
      if (showSource) {
        console.log(
          `${r.source.padEnd(sourceW)}   ${r.slug.padEnd(slugW)}   ${r.type.padEnd(typeW)}   ${title}`,
        );
      } else {
        console.log(`${r.slug.padEnd(slugW)}   ${r.type.padEnd(typeW)}   ${title}`);
      }
    }
  } finally {
    await sql.end({ timeout: 1 });
  }
}
