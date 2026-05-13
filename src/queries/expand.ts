import { z } from 'zod';
import { loadConfig } from '../db/config.ts';

const OPENAI_API_BASE = 'https://api.openai.com/v1';
const REQUEST_TIMEOUT_MS = 30_000;
const CACHE_CAPACITY = 200;
const NUM_EXPANSIONS = 3;

/**
 * Lightweight LRU. Map iteration is insertion-ordered in JS, so we move
 * touched keys to the end on access and evict from the head when full.
 * Plenty fast for the 200-entry hot cache we want here; pulling in a
 * dependency for this is overkill.
 *
 * Not exported — callers should use `expandQuery` and trust the cache.
 */
class LRUCache<V> {
  private map = new Map<string, V>();
  constructor(private readonly cap: number) {
    if (cap < 1) throw new Error(`LRUCache cap must be >= 1, got ${cap}`);
  }
  get(k: string): V | undefined {
    const v = this.map.get(k);
    if (v === undefined) return undefined;
    this.map.delete(k);
    this.map.set(k, v);
    return v;
  }
  set(k: string, v: V): void {
    if (this.map.has(k)) {
      this.map.delete(k);
    } else if (this.map.size >= this.cap) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(k, v);
  }
  get size(): number {
    return this.map.size;
  }
  /** Test-only — production code never calls this. */
  clear(): void {
    this.map.clear();
  }
}

// Module-level singleton. Lives for the lifetime of the process — short for
// CLI (cold every call), long for `memex serve --mcp` (hot across tool calls).
const cache = new LRUCache<string[]>(CACHE_CAPACITY);

const ResponseSchema = z.object({
  expansions: z.array(z.string().min(1)).length(NUM_EXPANSIONS),
});

export type ExpandResult =
  | { kind: 'ok'; expansions: string[]; cached: boolean }
  | { kind: 'fallback'; reason: string };

const SYSTEM_PROMPT =
  'You generate alternative phrasings of a search query for a knowledge-base ' +
  'retrieval system. The expansions should capture the SAME intent but use ' +
  'DIFFERENT vocabulary (synonyms, domain-specific rewordings, paraphrases). ' +
  'Each expansion is a complete query, not a fragment. Reply with JSON only.';

function userPrompt(query: string): string {
  return (
    `Original query: "${query}"\n\n` +
    `Return JSON: {"expansions": ["...", "...", "..."]} with exactly ${NUM_EXPANSIONS} expansions.`
  );
}

/**
 * Expand a query into N alternative phrasings via the configured chat model.
 *
 * Returns:
 *   - kind: 'ok' with N expansions on success (cached or fresh)
 *   - kind: 'fallback' on any failure — caller should proceed with just the
 *     original query. We never throw; expansion is a quality boost, not a
 *     prerequisite. PRD §17 cache-is-optimization spirit.
 */
export async function expandQuery(query: string): Promise<ExpandResult> {
  const key = query.trim().toLowerCase();
  if (key.length === 0) {
    return { kind: 'fallback', reason: 'empty query' };
  }

  const hit = cache.get(key);
  if (hit) return { kind: 'ok', expansions: hit, cached: true };

  const config = await loadConfig();
  if (!config.openaiApiKey) {
    return { kind: 'fallback', reason: 'OPENAI_API_KEY not configured' };
  }

  const body = JSON.stringify({
    model: config.queryExpansionModel,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt(query) },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 200,
  });
  const headers = {
    Authorization: `Bearer ${config.openaiApiKey}`,
    'Content-Type': 'application/json',
  };
  const url = `${OPENAI_API_BASE}/chat/completions`;

  let lastError = 'unknown error';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const errText = (await response.text().catch(() => '')).slice(0, 200);
        lastError = `OpenAI ${response.status}: ${errText}`;
        // 4xx: retry won't help (auth, malformed) — fail fast.
        if (response.status < 500) break;
      } else {
        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
          lastError = 'OpenAI returned empty content';
        } else {
          // The JSON-mode contract is "valid JSON, but you still parse it."
          let parsedJson: unknown;
          try {
            parsedJson = JSON.parse(content);
          } catch (err) {
            lastError = `expansion JSON parse failed: ${err instanceof Error ? err.message : String(err)}`;
            break; // bad shape from model — retry unlikely to help
          }
          const validated = ResponseSchema.safeParse(parsedJson);
          if (!validated.success) {
            lastError = `expansion JSON shape wrong: expected ${NUM_EXPANSIONS} non-empty strings`;
            break; // bad shape — retry unlikely to help
          }
          cache.set(key, validated.data.expansions);
          return { kind: 'ok', expansions: validated.data.expansions, cached: false };
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        lastError = `expansion request timed out after ${REQUEST_TIMEOUT_MS}ms`;
      } else {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    if (attempt === 0) {
      await sleep(2000);
    }
  }

  return { kind: 'fallback', reason: lastError };
}

/** Test-only — production code never calls this. */
export function _resetExpansionCache(): void {
  cache.clear();
}

/** Test-only — exposes cache size for invariant checks. */
export function _expansionCacheSize(): number {
  return cache.size;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
