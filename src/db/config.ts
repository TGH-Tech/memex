import { z } from 'zod';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';

export const ConfigSchema = z.object({
  supabaseSessionPoolerUrl: z.string().min(1),
  supabaseTransactionPoolerUrl: z.string().min(1),
  embedProvider: z.enum(['openai', 'xenova-local']),
  embedModel: z.string().default('text-embedding-3-small'),
  openaiApiKey: z.string().optional(),
  /** OpenAI chat model used for query expansion. Cheap-tier by design — the
   *  job is paraphrase generation, not reasoning. */
  queryExpansionModel: z.string().default('gpt-4o-mini'),
  indexRaw: z.boolean().default(false),
  multiQueryEnabled: z.boolean().default(true),
  rrfK: z.number().default(60),
  defaultSource: z.string().nullable().default(null),
});
export type Config = z.infer<typeof ConfigSchema>;

export const CONFIG_DIR = join(homedir(), '.memex');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export function configExists(): boolean {
  return existsSync(CONFIG_PATH);
}

export async function loadConfig(): Promise<Config> {
  const raw = await readFile(CONFIG_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  return ConfigSchema.parse(parsed);
}

export async function saveConfig(config: Config): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  await chmod(CONFIG_PATH, 0o600);
}

const SESSION_PORT = '5432';
const TRANSACTION_PORT = '6543';

export interface PoolerUrls {
  session: string;
  transaction: string;
  /** which pooler the user pasted in */
  provided: 'session' | 'transaction';
}

export function derivePoolerUrls(url: string): PoolerUrls {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Not a valid URL: ${url}`);
  }
  const port = parsed.port;
  if (port !== SESSION_PORT && port !== TRANSACTION_PORT) {
    throw new Error(
      `Expected port ${SESSION_PORT} (session pooler) or ${TRANSACTION_PORT} (transaction pooler), got "${port || '(none)'}". ` +
        `Supabase pooler URLs end in :${SESSION_PORT} or :${TRANSACTION_PORT}.`,
    );
  }
  const other = new URL(url);
  other.port = port === SESSION_PORT ? TRANSACTION_PORT : SESSION_PORT;
  if (port === SESSION_PORT) {
    return { session: url, transaction: other.toString(), provided: 'session' };
  }
  return { session: other.toString(), transaction: url, provided: 'transaction' };
}

export function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '****';
    return u.toString();
  } catch {
    return '****';
  }
}

export function maskSecret(s: string | undefined): string {
  if (!s) return '(not set)';
  if (s.length <= 8) return '****';
  return `${s.slice(0, 4)}…${s.slice(-2)}`;
}
