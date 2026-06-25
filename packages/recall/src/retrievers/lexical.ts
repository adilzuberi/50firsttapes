import type { Hit, RecallQuery, Retriever } from "../types.js";
import type { RecallIndex } from "../store.js";
import { tokenize } from "../store.js";

/**
 * Lexical retriever — BM25 over the derived token bags. Pure and file-based, no
 * model. The keyword layer of the hierarchy. Document frequencies are computed
 * once when the retriever is built over a snapshot of the index.
 */
export function lexicalRetriever(index: RecallIndex): Retriever {
  const rows = Object.values(index.rows);
  const N = rows.length || 1;
  const df = new Map<string, number>();
  for (const r of rows) for (const t of new Set(r.tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  const avgdl = rows.reduce((s, r) => s + r.tokens.length, 0) / N || 1;
  const k1 = 1.5;
  const b = 0.75;

  return {
    layer: "lexical",
    available: () => rows.length > 0,
    async search(query: RecallQuery, limit: number): Promise<Hit[]> {
      const terms = tokenize(query.text);
      if (terms.length === 0) return [];
      const hits: Hit[] = [];
      for (const r of rows) {
        const dl = r.tokens.length || 1;
        const tf = new Map<string, number>();
        for (const t of r.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
        let score = 0;
        for (const term of terms) {
          const f = tf.get(term);
          if (!f) continue;
          const n = df.get(term) ?? 0;
          const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
          score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (dl / avgdl))));
        }
        if (score > 0) hits.push({ id: r.id, title: r.title, score, layer: "lexical" });
      }
      return hits.sort((a, c) => c.score - a.score).slice(0, limit);
    },
  };
}
