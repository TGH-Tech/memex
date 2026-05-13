import {
  CONFIG_PATH,
  configExists,
  loadConfig,
  maskSecret,
  maskUrl,
} from '../db/config.ts';
import { getClient } from '../db/client.ts';
import { probe } from '../db/probe.ts';

export async function runDoctor(opts: { source?: string } = {}): Promise<void> {
  if (!configExists()) {
    console.error(`✘ No config at ${CONFIG_PATH}. Run \`memex init\` first.`);
    process.exit(1);
  }

  let config;
  try {
    config = await loadConfig();
  } catch (err) {
    console.error(
      `✘ Config invalid: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  console.log(`Config: ${CONFIG_PATH}`);
  console.log(`  session pooler:     ${maskUrl(config.supabaseSessionPoolerUrl)}`);
  console.log(`  transaction pooler: ${maskUrl(config.supabaseTransactionPoolerUrl)}`);
  console.log(`  embed provider:     ${config.embedProvider}`);
  console.log(`  embed model:        ${config.embedModel}`);
  console.log(`  openai key:         ${maskSecret(config.openaiApiKey)}`);
  console.log(`  default source:     ${config.defaultSource ?? '(none)'}`);
  console.log();
  console.log('Probing...');

  const [sess, tx] = await Promise.all([
    probe(config.supabaseSessionPoolerUrl),
    probe(config.supabaseTransactionPoolerUrl),
  ]);

  console.log(
    sess.ok
      ? `  ✔ session pooler     OK (${sess.latencyMs}ms)`
      : `  ✘ session pooler     FAIL: ${sess.error}`,
  );
  console.log(
    tx.ok
      ? `  ✔ transaction pooler OK (${tx.latencyMs}ms)`
      : `  ✘ transaction pooler FAIL: ${tx.error}`,
  );

  if (!sess.ok || !tx.ok) {
    // Short-circuit: if the pool itself is unreachable, per-source checks would
    // just re-trigger the same connection error and duplicate the noise.
    process.exit(1);
  }

  if (opts.source) {
    const issues = await checkSource(opts.source);
    if (issues) process.exit(1);
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

interface BrokenLinkRow {
  from_path: string;
  to_slug: string;
}

interface OrphanRow {
  path: string;
}

interface AsymmetryRow {
  src_path: string;
  src_slug: string;
  supersedes_slug: string;
  target_path: string | null;
  target_superseded_by: string | null;
}

async function checkSource(sourceName: string): Promise<boolean> {
  const sql = await getClient();
  let hadIssues = false;
  try {
    const sourceRows = await sql<{ id: number }[]>`
      SELECT id FROM sources WHERE name = ${sourceName}
    `;
    const sourceRow = sourceRows[0];
    if (!sourceRow) {
      console.log();
      console.log(`✘ Source "${sourceName}" not registered.`);
      return true;
    }
    const sourceId = sourceRow.id;

    const pageCountRow = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM pages WHERE source_id = ${sourceId}
    `;
    const pageCount = pageCountRow[0]?.count ?? 0;

    console.log();
    console.log(`Source "${sourceName}":`);
    console.log(`  ✔ ${pageCount} pages indexed`);

    const broken = await sql<BrokenLinkRow[]>`
      SELECT p.path AS from_path, l.to_slug
        FROM links l
        JOIN pages p ON p.id = l.from_page
       WHERE l.source_id = ${sourceId}
         AND l.kind = 'wikilink'
         AND l.to_page IS NULL
       ORDER BY p.path, l.to_slug
    `;
    if (broken.length === 0) {
      console.log(`  ✔ 0 broken wikilinks`);
    } else {
      hadIssues = true;
      console.log(`  ✘ ${broken.length} broken wikilink(s):`);
      for (const r of broken) {
        console.log(`    - ${r.from_path} → [[${r.to_slug}]]`);
      }
    }

    const orphans = await sql<OrphanRow[]>`
      SELECT p.path
        FROM pages p
       WHERE p.source_id = ${sourceId}
         AND p.is_raw = false
         AND NOT EXISTS (
           SELECT 1 FROM links l
            WHERE l.to_page = p.id
              AND l.kind = 'wikilink'
         )
       ORDER BY p.path
    `;
    if (orphans.length === 0) {
      console.log(`  ✔ 0 orphan pages`);
    } else {
      hadIssues = true;
      console.log(`  ✘ ${orphans.length} orphan page(s) (zero inbound wikilinks, excludes raw/):`);
      for (const r of orphans) {
        console.log(`    - ${r.path}`);
      }
    }

    // Supersession DAG asymmetry: Y claims to supersede X, but X.superseded_by
    // doesn't point back at Y. Sync auto-propagates this — if asymmetry exists,
    // someone bypassed sync (or the target doesn't exist as a page).
    const asymmetries = await sql<AsymmetryRow[]>`
      SELECT src.path AS src_path,
             src.slug AS src_slug,
             src.supersedes_slug,
             target.path AS target_path,
             target.superseded_by_slug AS target_superseded_by
        FROM pages src
        LEFT JOIN pages target
          ON target.source_id = src.source_id
         AND target.slug = src.supersedes_slug
       WHERE src.source_id = ${sourceId}
         AND src.supersedes_slug IS NOT NULL
         AND (target.id IS NULL
              OR target.superseded_by_slug IS DISTINCT FROM src.slug)
       ORDER BY src.path
    `;
    if (asymmetries.length === 0) {
      console.log(`  ✔ 0 supersession asymmetries`);
    } else {
      hadIssues = true;
      console.log(`  ✘ ${asymmetries.length} supersession asymmetry(ies):`);
      for (const r of asymmetries) {
        if (!r.target_path) {
          console.log(
            `    - ${r.src_path} → supersedes [[${r.supersedes_slug}]] but target not found in source`,
          );
        } else {
          console.log(
            `    - ${r.src_path} (slug=${r.src_slug}) → supersedes [[${r.supersedes_slug}]]`,
          );
          console.log(
            `        but ${r.target_path}.superseded_by_slug = ${r.target_superseded_by ?? 'null'}`,
          );
        }
      }
    }

    const conflictStatsRow = await sql<{ count: number; bytes: number }[]>`
      SELECT COUNT(*)::int AS count,
             COALESCE(SUM(length(loser_body)), 0)::int AS bytes
        FROM pages_conflicts
       WHERE source_id = ${sourceId}
         AND resolved_at IS NULL
    `;
    const openConflicts = conflictStatsRow[0]?.count ?? 0;
    const conflictBytes = conflictStatsRow[0]?.bytes ?? 0;
    if (openConflicts === 0) {
      console.log(`  ✔ 0 open conflicts`);
    } else {
      hadIssues = true;
      console.log(
        `  ✘ ${openConflicts} open conflict(s) holding ${formatBytes(conflictBytes)} ` +
          `— inspect with \`memex conflicts list\``,
      );
    }
  } finally {
    await sql.end({ timeout: 1 });
  }
  return hadIssues;
}
