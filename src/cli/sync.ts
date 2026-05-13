import { getClient } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import { syncSource, type SyncResult } from '../sync/run.ts';

export async function runSync(opts: { source?: string; full?: boolean }): Promise<void> {
  const sql = await getClient();
  try {
    // Auto-migrate so users pick up new schema without needing `init --force`.
    // No-op when already current.
    const migResult = await runMigrations(sql);
    if (migResult.applied.length > 0) {
      console.log(`Applied migration(s): ${migResult.applied.join(', ')}`);
    }

    if (opts.source) {
      const result = await syncSource(sql, opts.source, { full: opts.full });
      reportSync(result);
      return;
    }

    const sources = await sql<{ name: string }[]>`SELECT name FROM sources ORDER BY name`;
    if (sources.length === 0) {
      console.log('No sources registered.');
      console.log('  Add one with: memex sources add <name> --path <vault-dir>');
      return;
    }
    for (const s of sources) {
      const result = await syncSource(sql, s.name, { full: opts.full });
      reportSync(result);
    }
  } finally {
    await sql.end({ timeout: 1 });
  }
}

function reportSync(r: SyncResult): void {
  const seconds = (r.durationMs / 1000).toFixed(1);
  console.log(`✔ Synced "${r.source}" in ${seconds}s`);
  const skippedPart = r.skipped > 0 ? ` · ${r.skipped} unchanged (skipped)` : '';
  console.log(
    `  ${r.pagesFound} files found · ${r.inserted} inserted · ${r.updated} updated${skippedPart} · ${r.deleted} stale removed`,
  );
  const types = Object.entries(r.typeBreakdown)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([t, n]) => `${t}: ${n}`)
    .join(', ');
  if (types) console.log(`  Types touched: ${types}`);
  if (r.linksTotal > 0) {
    const brokenSuffix = r.linksUnresolved > 0 ? ` · ${r.linksUnresolved} broken` : '';
    console.log(`  Links: ${r.linksTotal} total${brokenSuffix}`);
    if (r.linksWikilinkInserted + r.linksRelatedInserted > 0) {
      console.log(
        `         (${r.linksWikilinkInserted} wikilink, ${r.linksRelatedInserted} related newly inserted)`,
      );
    }
  }
  if (r.chunksTotal > 0) {
    const failedSuffix = r.chunksFailed > 0 ? ` · ${r.chunksFailed} failed` : '';
    console.log(
      `  Chunks: ${r.chunksTotal} this run · ${r.chunksReembedded} re-embedded · ${r.chunksSkipped} reused${failedSuffix}`,
    );
  }
  if (r.symmetryUpdates > 0) {
    console.log(`  Symmetry: ${r.symmetryUpdates} inverse supersedes edge(s) written`);
  }
  if (r.conflictsConcurrent + r.conflictsCacheLoss > 0) {
    const parts: string[] = [];
    if (r.conflictsConcurrent > 0) parts.push(`${r.conflictsConcurrent} concurrent-edit`);
    if (r.conflictsCacheLoss > 0) parts.push(`${r.conflictsCacheLoss} cache-loss-fallback`);
    console.log(`  ⚠ Conflicts logged: ${parts.join(', ')} — see \`memex conflicts list\``);
  }
  if (r.failed.length > 0) {
    console.log(`  ${r.failed.length} file(s) failed to parse — see errors above`);
  }
}
