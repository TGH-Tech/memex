import { hostname, homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';

export interface MountsFile {
  host: string;
  mounts: Record<string, string>;
}

export const MOUNTS_DIR = join(homedir(), '.memex');
export const MOUNTS_PATH = join(MOUNTS_DIR, 'mounts.json');

export async function loadMounts(): Promise<MountsFile> {
  if (!existsSync(MOUNTS_PATH)) {
    return { host: hostname(), mounts: {} };
  }
  const raw = await readFile(MOUNTS_PATH, 'utf8');
  const parsed = JSON.parse(raw) as MountsFile;
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Invalid mounts.json: not an object`);
  }
  return {
    host: typeof parsed.host === 'string' ? parsed.host : hostname(),
    mounts: parsed.mounts && typeof parsed.mounts === 'object' ? parsed.mounts : {},
  };
}

export async function saveMounts(mounts: MountsFile): Promise<void> {
  await mkdir(MOUNTS_DIR, { recursive: true, mode: 0o700 });
  await writeFile(MOUNTS_PATH, JSON.stringify(mounts, null, 2) + '\n', { mode: 0o600 });
  await chmod(MOUNTS_PATH, 0o600);
}

export async function setMount(name: string, path: string): Promise<void> {
  const m = await loadMounts();
  m.host = hostname();
  m.mounts[name] = path;
  await saveMounts(m);
}

export async function removeMount(name: string): Promise<void> {
  const m = await loadMounts();
  if (!(name in m.mounts)) return;
  delete m.mounts[name];
  await saveMounts(m);
}

export async function getMount(name: string): Promise<string | undefined> {
  const m = await loadMounts();
  return m.mounts[name];
}
