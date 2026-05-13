import { getClient } from '../db/client.ts';

interface ConflictRow {
  id: number;
  source: string;
  page_path: string;
  detected_at: Date;
  detecting_host: string;
  base_content_version: number | null;
  current_content_version: number | null;
  cause: string;
}

interface ConflictDetailRow extends ConflictRow {
  loser_body: string;
  loser_frontmatter: Record<string, unknown>;
  resolved_at: Date | null;
  resolution_note: string | null;
}

export async function runConflictsList(opts: { source?: string }): Promise<void> {
  const sql = await getClient();
  try {
    const rows = opts.source
      ? await sql<ConflictRow[]>`
          SELECT c.id::int AS id, s.name AS source, c.page_path,
                 c.detected_at, c.detecting_host,
                 c.base_content_version::int AS base_content_version,
                 c.current_content_version::int AS current_content_version,
                 c.cause
            FROM pages_conflicts c
            JOIN sources s ON s.id = c.source_id
           WHERE s.name = ${opts.source}
             AND c.resolved_at IS NULL
           ORDER BY c.detected_at DESC
        `
      : await sql<ConflictRow[]>`
          SELECT c.id::int AS id, s.name AS source, c.page_path,
                 c.detected_at, c.detecting_host,
                 c.base_content_version::int AS base_content_version,
                 c.current_content_version::int AS current_content_version,
                 c.cause
            FROM pages_conflicts c
            JOIN sources s ON s.id = c.source_id
           WHERE c.resolved_at IS NULL
           ORDER BY s.name, c.detected_at DESC
        `;

    if (rows.length === 0) {
      const scope = opts.source ? ` in source "${opts.source}"` : '';
      console.log(`No open conflicts${scope}.`);
      return;
    }

    console.log(`${rows.length} open conflict(s):`);
    for (const r of rows) {
      const base = r.base_content_version ?? 'null';
      const cur = r.current_content_version ?? 'null';
      const when = new Date(r.detected_at).toISOString();
      console.log(`  [${r.id}] ${r.source} · ${r.page_path}`);
      console.log(`        cause: ${r.cause} · base=${base} · current=${cur}`);
      console.log(`        detected ${when} by host=${r.detecting_host}`);
    }
    console.log();
    console.log(`Inspect: memex conflicts show <id>`);
    console.log(`Resolve: memex conflicts resolve <id> [--note "..."]`);
  } finally {
    await sql.end({ timeout: 1 });
  }
}

export async function runConflictsShow(id: string): Promise<void> {
  const conflictId = parseInt(id, 10);
  if (!Number.isFinite(conflictId)) {
    console.error(`✘ Invalid conflict id: ${id}`);
    process.exit(1);
  }

  const sql = await getClient();
  try {
    const rows = await sql<ConflictDetailRow[]>`
      SELECT c.id::int AS id, s.name AS source, c.page_path,
             c.detected_at, c.detecting_host,
             c.base_content_version::int AS base_content_version,
             c.current_content_version::int AS current_content_version,
             c.cause,
             c.loser_body, c.loser_frontmatter, c.resolved_at, c.resolution_note
        FROM pages_conflicts c
        JOIN sources s ON s.id = c.source_id
       WHERE c.id = ${conflictId}
    `;
    const row = rows[0];
    if (!row) {
      console.error(`✘ Conflict ${conflictId} not found.`);
      process.exit(1);
    }

    console.log(`Conflict ${row.id}`);
    console.log(`  source:        ${row.source}`);
    console.log(`  page:          ${row.page_path}`);
    console.log(`  cause:         ${row.cause}`);
    console.log(`  detected_at:   ${new Date(row.detected_at).toISOString()}`);
    console.log(`  detecting_host: ${row.detecting_host}`);
    console.log(`  base_version:    ${row.base_content_version ?? 'null'}`);
    console.log(`  current_version: ${row.current_content_version ?? 'null'}`);
    console.log(`  resolved_at:   ${row.resolved_at ? new Date(row.resolved_at).toISOString() : '(open)'}`);
    if (row.resolution_note) console.log(`  resolution:    ${row.resolution_note}`);
    console.log();
    console.log('Loser frontmatter (the version that did NOT make it to the DB):');
    console.log(JSON.stringify(row.loser_frontmatter, null, 2));
    console.log();
    console.log('Loser body:');
    console.log('---');
    console.log(row.loser_body);
    console.log('---');
  } finally {
    await sql.end({ timeout: 1 });
  }
}

export async function runConflictsResolve(
  id: string,
  opts: { note?: string },
): Promise<void> {
  const conflictId = parseInt(id, 10);
  if (!Number.isFinite(conflictId)) {
    console.error(`✘ Invalid conflict id: ${id}`);
    process.exit(1);
  }

  const sql = await getClient();
  try {
    const result = await sql<{ id: number }[]>`
      UPDATE pages_conflicts
         SET resolved_at = now(),
             resolution_note = ${opts.note ?? null}
       WHERE id = ${conflictId}
         AND resolved_at IS NULL
      RETURNING id::int AS id
    `;
    if (result.length === 0) {
      console.error(`✘ Conflict ${conflictId} not found or already resolved.`);
      process.exit(1);
    }
    console.log(`✔ Conflict ${conflictId} marked resolved.`);
    console.log(`  To incorporate the loser version, edit the source file and re-sync.`);
  } finally {
    await sql.end({ timeout: 1 });
  }
}
