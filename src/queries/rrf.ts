/**
 * Reciprocal Rank Fusion (RRF) — combines multiple ranked lists into a single
 * ranking that's robust to score-scale differences across retrievers.
 *
 *   RRF(d) = sum over lists L containing d of   1 / (k + rank_L(d))
 *
 * k=60 is the standard default from Cormack et al. 2009. Higher k flattens
 * the contribution curve (rank #1 vs rank #50 matters less); lower k makes
 * top-rank dominance stronger. PRD pins k=60 (also exposed via config.rrfK).
 *
 * We track per-list ranks on the output so callers can show the breakdown
 * "(vector: 3, keyword: 7, score: 0.041)" without re-walking input lists.
 */

export interface RankedList {
  /** Stable name used in the output `ranks` map (e.g. 'vector-original'). */
  name: string;
  /** IDs in 1-based rank order. First element has rank 1. */
  ids: string[];
}

export interface FusedResult {
  id: string;
  score: number;
  /** Per-list 1-indexed rank, present only for lists where this id appeared. */
  ranks: Record<string, number>;
}

export function rrfFuse(lists: RankedList[], k = 60): FusedResult[] {
  if (k <= 0) {
    throw new Error(`rrfFuse: k must be positive, got ${k}`);
  }

  // Accumulator keyed by id. We track first-seen insertion order via the Map
  // so ties resolve deterministically (whichever list mentioned the item
  // first wins on score-tie).
  const acc = new Map<string, FusedResult>();

  for (const list of lists) {
    for (let i = 0; i < list.ids.length; i++) {
      const id = list.ids[i]!;
      const rank = i + 1;
      const contribution = 1 / (k + rank);
      const existing = acc.get(id);
      if (existing) {
        existing.score += contribution;
        existing.ranks[list.name] = rank;
      } else {
        acc.set(id, {
          id,
          score: contribution,
          ranks: { [list.name]: rank },
        });
      }
    }
  }

  const out = [...acc.values()];
  // Sort by score desc. Stable sort means insertion-order is the tiebreaker,
  // which corresponds to the earliest-appearing list. Good enough for ties.
  out.sort((a, b) => b.score - a.score);
  return out;
}
