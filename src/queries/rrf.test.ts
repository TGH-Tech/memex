import { describe, expect, test } from 'bun:test';
import { rrfFuse } from './rrf.ts';

describe('rrfFuse', () => {
  test('empty input returns empty output', () => {
    expect(rrfFuse([])).toEqual([]);
    expect(rrfFuse([{ name: 'a', ids: [] }])).toEqual([]);
  });

  test('single list preserves order', () => {
    const result = rrfFuse([{ name: 'L1', ids: ['a', 'b', 'c'] }], 60);
    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(result[0]!.score).toBeCloseTo(1 / 61, 10);
    expect(result[1]!.score).toBeCloseTo(1 / 62, 10);
    expect(result[2]!.score).toBeCloseTo(1 / 63, 10);
  });

  test('items appearing in multiple lists get summed scores', () => {
    const result = rrfFuse(
      [
        { name: 'vec', ids: ['x', 'y'] },
        { name: 'kw', ids: ['x', 'z'] },
      ],
      60,
    );
    const x = result.find((r) => r.id === 'x')!;
    expect(x.score).toBeCloseTo(1 / 61 + 1 / 61, 10);
    expect(x.ranks).toEqual({ vec: 1, kw: 1 });
  });

  test('items appear only in lists where they actually rank', () => {
    const result = rrfFuse(
      [
        { name: 'vec', ids: ['a', 'b'] },
        { name: 'kw', ids: ['b', 'c'] },
      ],
      60,
    );
    const a = result.find((r) => r.id === 'a')!;
    const b = result.find((r) => r.id === 'b')!;
    const c = result.find((r) => r.id === 'c')!;
    expect(a.ranks).toEqual({ vec: 1 });
    expect(b.ranks).toEqual({ vec: 2, kw: 1 });
    expect(c.ranks).toEqual({ kw: 2 });
  });

  test('cross-list co-occurrence outranks any single list', () => {
    // 'b' is rank 2 in both lists; 'a' is rank 1 in vec, absent from kw.
    // RRF(b) = 1/62 + 1/62 ≈ 0.0323
    // RRF(a) = 1/61          ≈ 0.0164
    const result = rrfFuse(
      [
        { name: 'vec', ids: ['a', 'b'] },
        { name: 'kw', ids: ['c', 'b'] },
      ],
      60,
    );
    expect(result[0]!.id).toBe('b');
  });

  test('score is monotonically non-increasing across the output', () => {
    const result = rrfFuse(
      [
        { name: 'L1', ids: ['a', 'b', 'c', 'd', 'e'] },
        { name: 'L2', ids: ['e', 'd', 'c', 'b', 'a'] },
        { name: 'L3', ids: ['c', 'a', 'b'] },
      ],
      60,
    );
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.score).toBeLessThanOrEqual(result[i - 1]!.score);
    }
  });

  test('k controls top-rank dominance — small k makes #1 dominate more', () => {
    const listsLong = [{ name: 'L1', ids: ['top', 'mid', 'bot'] }];
    const lowK = rrfFuse(listsLong, 1);
    const highK = rrfFuse(listsLong, 1000);
    const ratioLow = lowK[0]!.score / lowK[2]!.score;
    const ratioHigh = highK[0]!.score / highK[2]!.score;
    // Smaller k → larger ratio between #1 and #3
    expect(ratioLow).toBeGreaterThan(ratioHigh);
  });

  test('k must be positive', () => {
    expect(() => rrfFuse([{ name: 'a', ids: ['x'] }], 0)).toThrow();
    expect(() => rrfFuse([{ name: 'a', ids: ['x'] }], -1)).toThrow();
  });

  test('ties break by first-appearance order (stable sort)', () => {
    // Two identical lists — every item should have score = 2/(k+rank).
    // Ties on score should resolve by insertion order: 'a' before 'b' before 'c'.
    const result = rrfFuse(
      [
        { name: 'L1', ids: ['a', 'b', 'c'] },
        { name: 'L2', ids: ['a', 'b', 'c'] },
      ],
      60,
    );
    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});
