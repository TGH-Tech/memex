import { createHash } from 'node:crypto';

export interface Chunk {
  /** H2 heading text without the `## ` prefix; null for the preamble chunk */
  heading: string | null;
  /** 0-based position within the page (preamble first if any, then H2 sections in order) */
  ordinal: number;
  /** Full chunk text (heading line + body) — what we embed AND store */
  content: string;
  /** sha256(content) — drives the hash-skip optimization */
  contentHash: string;
}

/**
 * Split a markdown body into chunks at H2 boundaries.
 *
 * Rules:
 *   - First chunk is the preamble (text before the first ## line), heading=null.
 *     Skipped if empty.
 *   - Each subsequent chunk starts at a ## line; heading is the text after ##.
 *   - The chunk's `content` includes the heading line so the embedding carries
 *     topical context, not just body prose.
 *   - ## lines INSIDE a fenced code block (```...``` or ~~~...~~~) do NOT split.
 *     Otherwise an example like "```\n## fake-heading\n```" would create a
 *     bogus chunk break.
 */
export function chunkPage(body: string): Chunk[] {
  if (body == null || body.trim().length === 0) return [];

  const lines = body.split('\n');
  const chunks: Chunk[] = [];

  let currentHeading: string | null = null;
  let currentLines: string[] = [];
  let inFence = false;

  const flush = () => {
    // Drop empty pre-first-H2 preamble — but always flush a real H2 chunk
    // (heading present), even if its body is empty.
    const trimmedBody = currentLines.join('\n').trim();
    if (currentHeading === null && trimmedBody.length === 0) return;
    const content = formatChunk(currentHeading, currentLines);
    chunks.push({
      heading: currentHeading,
      ordinal: chunks.length,
      content,
      contentHash: sha256(content),
    });
  };

  for (const line of lines) {
    // Toggle fence state on triple-backtick or triple-tilde fences.
    // We use startsWith on the trimmed line so both ` ```ts ` and ` ``` ` count.
    const stripped = line.trimStart();
    if (stripped.startsWith('```') || stripped.startsWith('~~~')) {
      inFence = !inFence;
      currentLines.push(line);
      continue;
    }

    if (!inFence && /^## /.test(line)) {
      flush();
      currentHeading = line.slice(3).trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  flush();
  return chunks;
}

function formatChunk(heading: string | null, lines: string[]): string {
  const body = lines.join('\n').trim();
  if (heading === null) return body;
  if (body.length === 0) return `## ${heading}`;
  return `## ${heading}\n\n${body}`;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
