import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export interface WalkedFile {
  absPath: string;
  /** POSIX-style path relative to vault root */
  relPath: string;
  mtime: Date;
}

// Skip noisy dirs that often appear in vaults but never contain wiki content.
// Hidden dirs (anything starting with `.`) are skipped unconditionally — handles
// .git, .obsidian, .memex, .vscode, etc. without enumerating them.
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', '.next', '.cache']);

export async function walkVault(vaultRoot: string): Promise<WalkedFile[]> {
  const out: WalkedFile[] = [];
  await walk(vaultRoot, vaultRoot, out);
  return out;
}

async function walk(dir: string, root: string, out: WalkedFile[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(join(dir, entry.name), root, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      const absPath = join(dir, entry.name);
      const s = await stat(absPath);
      out.push({
        absPath,
        relPath: relative(root, absPath).split(sep).join('/'),
        mtime: s.mtime,
      });
    }
  }
}
