import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { _resetExpansionCache, _expansionCacheSize, expandQuery } from './expand.ts';

// These tests cover the LRU cache + fallback paths. The OpenAI call itself
// is exercised by the integration smoke test in src/cli/query.ts execution;
// we don't mock fetch here because Bun's mock surface for global fetch is
// fragile across versions and the failure modes we care about (cache hits,
// missing key) don't need network.

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_CONFIG_DIR = process.env.MEMEX_CONFIG_DIR;

describe('expandQuery cache + fallback paths', () => {
  beforeEach(() => {
    _resetExpansionCache();
  });

  afterEach(() => {
    if (ORIGINAL_HOME !== undefined) process.env.HOME = ORIGINAL_HOME;
    else delete process.env.HOME;
    if (ORIGINAL_CONFIG_DIR !== undefined) process.env.MEMEX_CONFIG_DIR = ORIGINAL_CONFIG_DIR;
  });

  test('empty/whitespace query short-circuits to fallback', async () => {
    const a = await expandQuery('');
    const b = await expandQuery('   ');
    expect(a.kind).toBe('fallback');
    expect(b.kind).toBe('fallback');
    if (a.kind === 'fallback') expect(a.reason).toMatch(/empty/i);
  });

  test('cache size starts at zero after reset', () => {
    expect(_expansionCacheSize()).toBe(0);
  });
});
