import { resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { getClient } from '../db/client.ts';
import { removeMount, setMount } from '../db/mounts.ts';
import { clearSource, loadSyncState, saveSyncState } from '../db/sync-state.ts';
import { querySources } from '../queries/sources.ts';

// Kebab-case, ≤ 63 chars (Postgres identifier convention). Must start with letter/digit.
// Kept tight on purpose: name appears in `[[source:slug]]` cross-source links per PRD §6.4,
// where ':' and whitespace would break parsing.
const SOURCE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export async function sourcesAdd(name: string, opts: { path: string }): Promise<void> {
  if (!SOURCE_NAME_RE.test(name)) {
    console.error(
      `✘ Invalid source name "${name}". Use lowercase letters, digits, and hyphens (e.g. "e-commerce", "mobile-app").`,
    );
    process.exit(1);
  }

  const absPath = resolve(opts.path);
  if (!existsSync(absPath)) {
    console.error(`✘ Path does not exist: ${absPath}`);
    process.exit(1);
  }
  const stat = statSync(absPath);
  if (!stat.isDirectory()) {
    console.error(`✘ Path is not a directory: ${absPath}`);
    process.exit(1);
  }

  const sql = await getClient();
  try {
    const result = await sql<{ id: number }[]>`
      INSERT INTO sources (name) VALUES (${name})
      ON CONFLICT (name) DO NOTHING
      RETURNING id
    `;
    const row = result[0];
    if (!row) {
      console.error(`✘ Source "${name}" already exists in DB. Remove it first or pick a different name.`);
      process.exit(1);
    }

    await setMount(name, absPath);

    console.log(`✔ Source "${name}" registered (id=${row.id}, path=${absPath})`);
  } finally {
    await sql.end({ timeout: 1 });
  }
}

export async function sourcesList(): Promise<void> {
  const sql = await getClient();
  try {
    const sources = await querySources(sql);

    if (sources.length === 0) {
      console.log('No sources registered.');
      console.log('  Add one with: memex sources add <name> --path <vault-dir>');
      return;
    }

    const rows = sources.map((s) => {
      const mount = s.mount_path ?? '(not on this host)';
      const lastSync = s.last_sync
        ? `${new Date(s.last_sync).toISOString().slice(0, 10)}${s.last_sync_host ? ` (${s.last_sync_host})` : ''}`
        : 'never';
      return {
        name: s.name,
        path: mount,
        pages: String(s.pages_count),
        lastSync,
      };
    });

    const nameW = Math.max('NAME'.length, ...rows.map((r) => r.name.length));
    const pathW = Math.max('PATH'.length, ...rows.map((r) => r.path.length));
    const pagesW = Math.max('PAGES'.length, ...rows.map((r) => r.pages.length));

    console.log(
      `${'NAME'.padEnd(nameW)}   ${'PATH'.padEnd(pathW)}   ${'PAGES'.padStart(pagesW)}   LAST SYNC`,
    );
    for (const r of rows) {
      console.log(
        `${r.name.padEnd(nameW)}   ${r.path.padEnd(pathW)}   ${r.pages.padStart(pagesW)}   ${r.lastSync}`,
      );
    }
  } finally {
    await sql.end({ timeout: 1 });
  }
}

export async function sourcesRemove(name: string, opts: { force?: boolean }): Promise<void> {
  const sql = await getClient();
  try {
    const found = await sql<{ id: number }[]>`SELECT id FROM sources WHERE name = ${name}`;
    if (found.length === 0) {
      console.error(`✘ Source "${name}" not found.`);
      process.exit(1);
    }

    if (!opts.force) {
      const rl = createInterface({ input: stdin, output: stdout });
      let answer: string;
      try {
        answer = (
          await rl.question(
            `Remove source "${name}"? This deletes all pages/chunks/links/tags (cascade). (yes/N): `,
          )
        ).trim().toLowerCase();
      } finally {
        rl.close();
      }
      if (answer !== 'yes' && answer !== 'y') {
        console.log('Cancelled.');
        return;
      }
    }

    await sql`DELETE FROM sources WHERE name = ${name}`;
    await removeMount(name);

    // Drop the local sync-state cache section so it doesn't accumulate dead
    // entries for sources that no longer exist.
    try {
      const syncState = await loadSyncState();
      clearSource(syncState, name);
      await saveSyncState(syncState);
    } catch {
      // Cache cleanup is best-effort; sync-state is rebuilt naturally on the
      // next sync via hash-fallback if it gets corrupted.
    }

    console.log(`✔ Source "${name}" removed.`);
  } finally {
    await sql.end({ timeout: 1 });
  }
}
