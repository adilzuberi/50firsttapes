import type { Hit, RecallQuery, Retriever } from "../types.js";
import type { RecallIndex } from "../store.js";
import { tokenize } from "../store.js";

const tagMatch = (tag: string, t: string): boolean => t === tag || t.startsWith(`${tag}/`);

/**
 * Structure retriever — the cheapest layer. Scores by frontmatter: a tag, kind,
 * or title-term match. A pure tag/kind filter with no query text still returns
 * its set. No body scan, no model.
 */
export function structureRetriever(index: RecallIndex): Retriever {
  const rows = Object.values(index.rows);
  return {
    layer: "structure",
    available: () => rows.length > 0,
    async search(query: RecallQuery, limit: number): Promise<Hit[]> {
      const terms = new Set(tokenize(query.text));
      const filterOnly = terms.size === 0 && Boolean(query.kind || query.tag);
      const hits: Hit[] = [];
      for (const r of rows) {
        if (query.kind && r.kind !== query.kind) continue;
        if (query.tag && !r.tags.some((t) => tagMatch(query.tag as string, t))) continue;

        let score = 0;
        const why: string[] = [];
        if (query.tag && r.tags.some((t) => tagMatch(query.tag as string, t))) {
          score += 2;
          why.push(`tag:${query.tag}`);
        }
        if (query.kind && r.kind === query.kind) {
          score += 1;
          why.push(`kind:${query.kind}`);
        }
        const titleHits = tokenize(r.title ?? "").filter((t) => terms.has(t)).length;
        if (titleHits) {
          score += 3 * titleHits;
          why.push(`title x${titleHits}`);
        }
        if (score > 0 || filterOnly) {
          hits.push({ id: r.id, title: r.title, score: score || 1, layer: "structure", why: why.join(" ") });
        }
      }
      return hits.sort((a, c) => c.score - a.score).slice(0, limit);
    },
  };
}
