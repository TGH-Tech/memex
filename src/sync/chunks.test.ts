import { describe, expect, test } from 'bun:test';
import { chunkPage } from './chunks.ts';

describe('chunkPage', () => {
  test('empty body returns no chunks', () => {
    expect(chunkPage('')).toEqual([]);
    expect(chunkPage('   \n   \n')).toEqual([]);
  });

  test('body with no H2 returns one preamble chunk', () => {
    const chunks = chunkPage('Just a paragraph.\n\nAnd another.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.heading).toBeNull();
    expect(chunks[0]!.ordinal).toBe(0);
    expect(chunks[0]!.content).toBe('Just a paragraph.\n\nAnd another.');
  });

  test('preamble + single H2 produces two chunks with correct ordinals', () => {
    const chunks = chunkPage('Preamble text.\n\n## Decision\n\nWe pick X.');
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.heading).toBeNull();
    expect(chunks[0]!.ordinal).toBe(0);
    expect(chunks[0]!.content).toBe('Preamble text.');
    expect(chunks[1]!.heading).toBe('Decision');
    expect(chunks[1]!.ordinal).toBe(1);
    expect(chunks[1]!.content).toContain('## Decision');
    expect(chunks[1]!.content).toContain('We pick X.');
  });

  test('body starting with H2 has no preamble', () => {
    const chunks = chunkPage('## A\n\nfirst');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.heading).toBe('A');
    expect(chunks[0]!.ordinal).toBe(0);
  });

  test('multiple H2s produce sequentially-ordered chunks', () => {
    const chunks = chunkPage('## A\n\nfirst\n\n## B\n\nsecond\n\n## C\n\nthird');
    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.heading)).toEqual(['A', 'B', 'C']);
    expect(chunks.map((c) => c.ordinal)).toEqual([0, 1, 2]);
  });

  test('H2 with empty body still produces a chunk (heading-only)', () => {
    const chunks = chunkPage('## Empty\n\n## After');
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.heading).toBe('Empty');
    expect(chunks[0]!.content).toBe('## Empty');
    expect(chunks[1]!.heading).toBe('After');
  });

  test('## inside a fenced code block does NOT split', () => {
    const body =
      '## Real\n\nSome text\n\n```ts\n## not-a-heading\nconst x = 1;\n```\n\nMore text.';
    const chunks = chunkPage(body);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.heading).toBe('Real');
    expect(chunks[0]!.content).toContain('## not-a-heading');
    expect(chunks[0]!.content).toContain('More text.');
  });

  test('## inside a tilde-fenced code block does NOT split', () => {
    const body = '## Real\n\n~~~\n## fake\n~~~\n\ntail.';
    const chunks = chunkPage(body);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.heading).toBe('Real');
  });

  test('content hash is deterministic across calls', () => {
    const a = chunkPage('## A\n\nText');
    const b = chunkPage('## A\n\nText');
    expect(a[0]!.contentHash).toBe(b[0]!.contentHash);
    expect(a[0]!.contentHash).toHaveLength(64); // sha256 hex
  });

  test('different content produces different hashes', () => {
    const a = chunkPage('## A\n\nText one');
    const b = chunkPage('## A\n\nText two');
    expect(a[0]!.contentHash).not.toBe(b[0]!.contentHash);
  });

  test('H3 and lower headings stay inside their H2 chunk', () => {
    const body = '## Top\n\nIntro\n\n### Subsection\n\nDetail\n\n## Next\n\nMore';
    const chunks = chunkPage(body);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.content).toContain('### Subsection');
    expect(chunks[1]!.heading).toBe('Next');
  });
});
