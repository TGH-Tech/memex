import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, chmod, rename } from 'node:fs/promises';

/**
 * Per-host, per-(source, path) record of the last successfully-synced
 * (content_version, body hash). Used by sync's CAS path to detect concurrent
 * edits from other hosts, AND by the cache-loss-fallback to recover when this
 * file is deleted (PRD §17 decision 17: cache is an optimization, not a
 * correctness dependency).
 */
export interface SyncStateFile {
  host: string;
  sources: Record<string, Record<string, BasedOn>>;
}

export interface BasedOn {
  /** content_version we last successfully synced */
  version: number;
  /** sha256 of the body we last synced (lets hash-fallback decide between adopt vs conflict) */
  hash: string;
}

export const SYNC_STATE_DIR = join(homedir(), '.memex', 'cache');
export const SYNC_STATE_PATH = join(SYNC_STATE_DIR, 'sync-state.json');

export async function loadSyncState(): Promise<SyncStateFile> {
  if (!existsSync(SYNC_STATE_PATH)) {
    return { host: hostname(), sources: {} };
  }
  try {
    const raw = await readFile(SYNC_STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as SyncStateFile;
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('not an object');
    }
    return {
      host: typeof parsed.host === 'string' ? parsed.host : hostname(),
      sources: parsed.sources && typeof parsed.sources === 'object' ? parsed.sources : {},
    };
  } catch {
    // Corrupted cache → start over. The hash-fallback path in sync will
    // re-detect "no edit" cases by comparing local hash to DB hash, so this
    // never produces silent data loss (PRD §17 decision 17).
    return { host: hostname(), sources: {} };
  }
}

export async function saveSyncState(state: SyncStateFile): Promise<void> {
  await mkdir(SYNC_STATE_DIR, { recursive: true, mode: 0o700 });
  // Atomic write: tempfile + rename. Crashes mid-write don't leave a truncated file.
  const tmpPath = `${SYNC_STATE_PATH}.tmp`;
  await writeFile(tmpPath, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  await chmod(tmpPath, 0o600);
  await rename(tmpPath, SYNC_STATE_PATH);
}

export function getBasedOn(
  state: SyncStateFile,
  sourceName: string,
  path: string,
): BasedOn | undefined {
  return state.sources[sourceName]?.[path];
}

export function setBasedOn(
  state: SyncStateFile,
  sourceName: string,
  path: string,
  basedOn: BasedOn,
): void {
  state.host = hostname();
  if (!state.sources[sourceName]) state.sources[sourceName] = {};
  state.sources[sourceName]![path] = basedOn;
}

export function clearBasedOn(
  state: SyncStateFile,
  sourceName: string,
  path: string,
): void {
  const src = state.sources[sourceName];
  if (src) delete src[path];
}

export function clearSource(state: SyncStateFile, sourceName: string): void {
  delete state.sources[sourceName];
}
