import postgres from 'postgres';
import { configExists, loadConfig } from './config.ts';

export type PoolerKind = 'transaction' | 'session';

export interface ClientOptions {
  pooler?: PoolerKind;
}

export type DbClient = ReturnType<typeof postgres>;

/**
 * Returns a configured postgres client. Caller MUST `await sql.end()` when done.
 *
 * - 'transaction' (default, port 6543): short-lived CLI commands. `prepare: false`
 *   because PgBouncer in transaction mode doesn't support prepared statements.
 * - 'session' (port 5432): long-lived MCP server. Same `prepare: false` setting
 *   keeps behavior identical across both pools.
 */
export async function getClient(opts: ClientOptions = {}): Promise<DbClient> {
  if (!configExists()) {
    throw new Error('No config found. Run `memex init` first.');
  }
  const config = await loadConfig();
  const pooler: PoolerKind = opts.pooler ?? 'transaction';
  const url =
    pooler === 'transaction'
      ? config.supabaseTransactionPoolerUrl
      : config.supabaseSessionPoolerUrl;
  return postgres(url, {
    prepare: false,
    max: pooler === 'transaction' ? 1 : 10,
    onnotice: () => {}, // silence postgres NOTICEs (e.g. "IF NOT EXISTS" skips)
  });
}
