import type { Hit } from "./types.js";

/**
 * Reciprocal-rank fusion — blend ranked lists from many retrievers into one,
 * deterministically and with no database. Each list contributes `1/(k+rank)` to
 * a note's score; notes found by several layers rise. The fused `why` records
 * which layers agreed — the provenance of the blend.
 */
export function rrf(lists: Hit[][], k = 60): Hit[] {
  const acc = new Map<string, { hit: Hit; score: number; layers: Set<string> }>();
  for (const list of lists) {
    list.forEach((hit, rank) => {
      const contrib = 1 / (k + rank + 1);
      const cur = acc.get(hit.id);
      if (cur) {
        cur.score += contrib;
        cur.layers.add(hit.layer);
      } else {
        acc.set(hit.id, { hit, score: contrib, layers: new Set([hit.layer]) });
      }
    });
  }
  return [...acc.values()]
    .map(({ hit, score, layers }) => ({ ...hit, score, why: [...layers].join("+") }))
    .sort((a, b) => b.score - a.score);
}
