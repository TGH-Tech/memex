import { getClient } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import { runHybridQuery } from '../queries/query.ts';

export async function runQuery(
  query: string,
  opts: { source?: string; topK?: number; noExpand?: boolean },
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
    // Auto-migrate so a fresh clone with a newer schema doesn't error on first
    // query. Same posture as `memex sync`.
    const migResult = await runMigrations(sql);
    if (migResult.applied.length > 0) {
      console.log(`Applied migration(s): ${migResult.applied.join(', ')}`);
    }

    const report = await runHybridQuery(sql, query, {
      ...(opts.source !== undefined ? { source: opts.source } : {}),
      topK,
      ...(opts.noExpand ? { noExpand: true } : {}),
    });

    // Header: what just ran. Surfaces degradations and expansion so the user
    // can tell why a query did/didn't use the full pipeline.
    const seconds = (report.durationMs / 1000).toFixed(2);
    const scope = opts.source ? `source: ${opts.source}` : 'federated';
    console.log(`Hybrid query "${report.query}" (${scope}, ${seconds}s)`);
    if (report.expansionSource === 'cache' || report.expansionSource === 'api') {
      const tag = report.expansionSource === 'cache' ? 'cached' : 'fresh';
      console.log(`  Expansions (${tag}):`);
      for (const e of report.expansions) console.log(`    • ${e}`);
    } else if (report.expansionSource === 'fallback') {
      console.log(`  Expansion fallback — running without expansions`);
    }
    for (const d of report.degradations) {
      console.log(`  ⚠ ${d}`);
    }
    if (
      report.dedupStats.droppedByPath +
        report.dedupStats.droppedBySlug +
        report.dedupStats.droppedByHash >
      0
    ) {
      const s = report.dedupStats;
      console.log(
        `  Dedup: dropped ${s.droppedByPath} path, ${s.droppedBySlug} slug, ${s.droppedByHash} content-hash`,
      );
    }
    console.log();

    if (report.rows.length === 0) {
      const reason = report.vectorEnabled
        ? `No matches for "${query}".`
        : `No matches (keyword-only mode — vector retrieval unavailable).`;
      console.log(reason);
      return;
    }

    for (let i = 0; i < report.rows.length; i++) {
      const r = report.rows[i]!;
      const title = r.title ?? '(untitled)';
      const score = r.score.toFixed(3);
      // Rank breakdown: vector (best-rank / lists-hit) + keyword rank.
      const rankParts: string[] = [];
      if (r.ranks.vectorBest !== undefined) {
        const lists = r.ranks.vectorLists ?? 1;
        rankParts.push(`vector: #${r.ranks.vectorBest} (${lists}/4 lists)`);
      } else {
        rankParts.push('vector: —');
      }
      rankParts.push(r.ranks.keyword !== undefined ? `keyword: #${r.ranks.keyword}` : 'keyword: —');
      rankParts.push(`score: ${score}`);
      if (r.backlinks > 0) rankParts.push(`backlinks: ${r.backlinks}`);
      console.log(`${i + 1}. [${r.source}] ${r.slug}  (${rankParts.join(', ')})`);
      console.log(`   ${title}  ·  type: ${r.type}`);
      if (r.heading) {
        console.log(`   § ${r.heading}`);
      }
      if (r.snippet) {
        console.log(`   ${r.snippet.replace(/\s+/g, ' ').trim()}`);
      } else if (r.content) {
        const oneline = r.content.replace(/\s+/g, ' ').trim().slice(0, 200);
        console.log(`   ${oneline}${r.content.length > 200 ? '…' : ''}`);
      }
      console.log();
    }
    const word = report.rows.length === 1 ? 'result' : 'results';
    console.log(`${report.rows.length} ${word}.`);
  } finally {
    await sql.end({ timeout: 1 });
  }
}
