import init001Sql from '../../migrations/001_init.sql' with { type: 'text' };
import links002Sql from '../../migrations/002_links.sql' with { type: 'text' };
import tsv003Sql from '../../migrations/003_pages_tsv.sql' with { type: 'text' };
import typed004Sql from '../../migrations/004_typed_columns.sql' with { type: 'text' };
import conflicts005Sql from '../../migrations/005_pages_conflicts.sql' with { type: 'text' };
import causeCheck006Sql from '../../migrations/006_conflict_cause_check.sql' with { type: 'text' };
import chunks007Sql from '../../migrations/007_chunks.sql' with { type: 'text' };
import type { DbClient } from './client.ts';

interface Migration {
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  { name: '001_init', sql: init001Sql },
  { name: '002_links', sql: links002Sql },
  { name: '003_pages_tsv', sql: tsv003Sql },
  { name: '004_typed_columns', sql: typed004Sql },
  { name: '005_pages_conflicts', sql: conflicts005Sql },
  { name: '006_conflict_cause_check', sql: causeCheck006Sql },
  { name: '007_chunks', sql: chunks007Sql },
];

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function runMigrations(sql: DbClient): Promise<MigrationResult> {
  await sql`
    CREATE TABLE IF NOT EXISTS _memex_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  const applied = await sql<{ name: string }[]>`SELECT name FROM _memex_migrations`;
  const appliedSet = new Set(applied.map((r) => r.name));

  const result: MigrationResult = { applied: [], skipped: [] };

  for (const mig of MIGRATIONS) {
    if (appliedSet.has(mig.name)) {
      result.skipped.push(mig.name);
      continue;
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(mig.sql);
      await tx`INSERT INTO _memex_migrations (name) VALUES (${mig.name})`;
    });
    result.applied.push(mig.name);
  }

  return result;
}
