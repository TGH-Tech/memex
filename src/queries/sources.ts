import type { DbClient } from '../db/client.ts';
import { loadMounts } from '../db/mounts.ts';

export interface SourceListRow {
  id: number;
  name: string;
  pages_count: number;
  last_sync: Date | null;
  last_sync_host: string | null;
  /** Local mount path on the calling host, or null if not mounted here. */
  mount_path: string | null;
}

export async function querySources(sql: DbClient): Promise<SourceListRow[]> {
  const rows = await sql<{
    id: number;
    name: string;
    last_sync: Date | null;
    last_sync_host: string | null;
    pages_count: number;
  }[]>`
    SELECT s.id,
           s.name,
           s.last_sync,
           s.last_sync_host,
           COUNT(p.id)::int AS pages_count
      FROM sources s
      LEFT JOIN pages p ON p.source_id = s.id
     GROUP BY s.id, s.name, s.last_sync, s.last_sync_host
     ORDER BY s.name
  `;
  const mounts = await loadMounts();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    pages_count: r.pages_count,
    last_sync: r.last_sync,
    last_sync_host: r.last_sync_host,
    mount_path: mounts.mounts[r.name] ?? null,
  }));
}
