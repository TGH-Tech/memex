import { loadConfig } from '../db/config.ts';

const OPENAI_API_BASE = 'https://api.openai.com/v1';

/** OpenAI text-embedding-3-small caps input at 8191 tokens. ~25k chars leaves
 *  comfortable headroom for tokenizer variance. Oversize chunks are filtered
 *  by the caller (sync) and reported as failures. */
export const MAX_CHUNK_CHARS = 25000;

export type EmbedResult =
  | { kind: 'ok'; vectors: number[][]; model: string }
  | { kind: 'error'; message: string; status?: number };

/**
 * Embed an array of texts in a single OpenAI API call.
 *
 * Returns a discriminated-union result instead of throwing so callers can
 * degrade gracefully (PRD §17 cache-is-an-optimization spirit applied to
 * embeddings: failures don't block sync).
 *
 * Retry policy: ONE retry with 2s backoff on 5xx or network error. We don't
 * grind on 4xx (auth, malformed request — retry won't help).
 */
export async function embedBatch(texts: string[]): Promise<EmbedResult> {
  if (texts.length === 0) {
    return { kind: 'ok', vectors: [], model: 'noop' };
  }

  const config = await loadConfig();
  if (!config.openaiApiKey) {
    return {
      kind: 'error',
      message: 'OPENAI_API_KEY not configured — pages indexed for keyword search only',
    };
  }

  const url = `${OPENAI_API_BASE}/embeddings`;
  const headers = {
    Authorization: `Bearer ${config.openaiApiKey}`,
    'Content-Type': 'application/json',
  };
  const body = JSON.stringify({
    model: config.embedModel,
    input: texts,
  });

  // 60s is generous for a single batch — OpenAI's p99 for the embeddings
  // endpoint is <10s. Without it, a hung connection blocks the entire sync.
  const REQUEST_TIMEOUT_MS = 60_000;

  let lastError: { message: string; status?: number } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) {
        const data = (await response.json()) as {
          data: Array<{ embedding: number[]; index: number }>;
          model: string;
        };
        // OpenAI returns vectors keyed by input index — sort defensively so
        // callers can rely on result[i] matching input[i] regardless of API order.
        const sorted = [...data.data].sort((a, b) => a.index - b.index);
        return {
          kind: 'ok',
          vectors: sorted.map((d) => d.embedding),
          model: data.model,
        };
      }

      const errText = await response.text().catch(() => '');
      lastError = {
        message: `OpenAI ${response.status}: ${errText.slice(0, 200)}`,
        status: response.status,
      };

      // 4xx: retry won't help (auth, malformed) — fail fast.
      if (response.status < 500) break;
    } catch (err) {
      // AbortError from the timeout surfaces here as a DOMException with
      // name='TimeoutError'. Normalize so callers see a useful message.
      if (err instanceof Error && err.name === 'TimeoutError') {
        lastError = { message: `OpenAI embeddings request timed out after ${REQUEST_TIMEOUT_MS}ms` };
      } else {
        lastError = { message: err instanceof Error ? err.message : String(err) };
      }
    }

    if (attempt === 0) {
      await sleep(2000);
    }
  }

  return {
    kind: 'error',
    message: lastError?.message ?? 'unknown embedding error',
    ...(lastError?.status !== undefined ? { status: lastError.status } : {}),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
