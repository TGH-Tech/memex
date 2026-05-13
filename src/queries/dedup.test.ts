import { describe, expect, test } from 'bun:test';
import { dedupeResults } from './dedup.ts';

function mk(source: string, path: string, slug: string, contentHash: string) {
  return { source, path, slug, contentHash };
}

describe('dedupeResults', () => {
  test('empty input returns empty output and zero stats', () => {
    const { kept, stats } = dedupeResults([]);
    expect(kept).toEqual([]);
    expect(stats).toEqual({ kept: 0, droppedByPath: 0, droppedBySlug: 0, droppedByHash: 0 });
  });

  test('all unique items pass through unchanged', () => {
    const items = [
      mk('a', 'p1.md', 's1', 'h1'),
      mk('a', 'p2.md', 's2', 'h2'),
      mk('b', 'p3.md', 's3', 'h3'),
    ];
    const { kept, stats } = dedupeResults(items);
    expect(kept).toHaveLength(3);
    expect(stats.kept).toBe(3);
    expect(stats.droppedByPath + stats.droppedBySlug + stats.droppedByHash).toBe(0);
  });

  test('L1 — same source + same path drops duplicates', () => {
    const items = [
      mk('a', 'shared.md', 's1', 'h1'),
      mk('a', 'shared.md', 's2', 'h2'),
    ];
    const { kept, stats } = dedupeResults(items);
    expect(kept).toHaveLength(1);
    expect(stats.droppedByPath).toBe(1);
  });

  test('L1 — same path across DIFFERENT sources is NOT a duplicate', () => {
    const items = [
      mk('a', 'notes.md', 's-a', 'ha'),
      mk('b', 'notes.md', 's-b', 'hb'),
    ];
    const { kept } = dedupeResults(items);
    expect(kept).toHaveLength(2);
  });

  test('L2 — same source + same slug drops duplicates even with different paths', () => {
    const items = [
      mk('a', 'old/loc.md', 's1', 'h1'),
      mk('a', 'new/loc.md', 's1', 'h2'),
    ];
    const { kept, stats } = dedupeResults(items);
    expect(kept).toHaveLength(1);
    expect(stats.droppedBySlug).toBe(1);
  });

  test('L3 — same content_hash across sources collapses to one', () => {
    const items = [
      mk('a', 'p.md', 'sa', 'shared-content-hash'),
      mk('b', 'q.md', 'sb', 'shared-content-hash'),
    ];
    const { kept, stats } = dedupeResults(items);
    expect(kept).toHaveLength(1);
    expect(stats.droppedByHash).toBe(1);
  });

  test('first occurrence wins — score order is preserved by caller', () => {
    const items = [
      mk('a', 'p.md', 's', 'h1'),
      mk('a', 'p.md', 's', 'h2'),
      mk('a', 'p.md', 's', 'h3'),
    ];
    const { kept } = dedupeResults(items);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.contentHash).toBe('h1');
  });

  test('drops are counted by the FIRST layer that catches them', () => {
    // This duplicates on path AND slug AND hash — should count as path-drop only.
    const items = [
      mk('a', 'x.md', 's', 'h'),
      mk('a', 'x.md', 's', 'h'),
    ];
    const { stats } = dedupeResults(items);
    expect(stats.droppedByPath).toBe(1);
    expect(stats.droppedBySlug).toBe(0);
    expect(stats.droppedByHash).toBe(0);
  });
});
