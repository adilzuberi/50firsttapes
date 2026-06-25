import { test } from "node:test";
import assert from "node:assert/strict";
import { reindex, rrf, structureRetriever, lexicalRetriever } from "../dist/index.js";

const note = (id, body, fm = {}) => ({
  id,
  path: `${id}.md`,
  frontmatter: { type: "note", ...fm },
  body,
});

const freshIndex = () => ({ version: 1, rows: {} });

test("reindex is incremental: add, no-op, update, prune", () => {
  const index = freshIndex();
  const a = note("a", "alpha beta", { title: "Alpha" });
  const b = note("b", "gamma delta", { title: "Beta" });

  let r = reindex(index, [a, b]);
  assert.deepEqual(r, { added: 2, updated: 0, unchanged: 0, pruned: 0 });

  // same content again → all unchanged (hash match)
  r = reindex(index, [a, b]);
  assert.deepEqual(r, { added: 0, updated: 0, unchanged: 2, pruned: 0 });

  // change a's body → exactly one update
  r = reindex(index, [note("a", "alpha beta epsilon", { title: "Alpha" }), b]);
  assert.equal(r.updated, 1);
  assert.equal(r.unchanged, 1);

  // drop b → pruned
  r = reindex(index, [note("a", "alpha beta epsilon", { title: "Alpha" })]);
  assert.equal(r.pruned, 1);
  assert.equal(Object.keys(index.rows).length, 1);
});

test("lexical retriever ranks the on-topic note first", async () => {
  const index = freshIndex();
  reindex(index, [
    note("vec", "vector search with embeddings and cosine similarity", { title: "Vector search" }),
    note("cook", "a recipe for bread and butter", { title: "Bread" }),
  ]);
  const hits = await lexicalRetriever(index).search({ text: "vector embeddings" }, 5);
  assert.equal(hits[0].id, "vec");
  assert.equal(hits[0].layer, "lexical");
});

test("structure retriever filters by tag and boosts title hits", async () => {
  const index = freshIndex();
  reindex(index, [
    note("d1", "body", { title: "Recall design", tags: ["topic/retrieval"] }),
    note("d2", "body", { title: "Holiday", tags: ["topic/travel"] }),
  ]);
  const ret = structureRetriever(index);

  const tagged = await ret.search({ text: "", tag: "topic/retrieval" }, 5);
  assert.equal(tagged.length, 1);
  assert.equal(tagged[0].id, "d1");

  const titled = await ret.search({ text: "recall" }, 5);
  assert.equal(titled[0].id, "d1");
});

test("rrf rewards agreement across layers", () => {
  const structure = [{ id: "x", score: 5, layer: "structure" }, { id: "y", score: 4, layer: "structure" }];
  const lexical = [{ id: "y", score: 9, layer: "lexical" }, { id: "z", score: 1, layer: "lexical" }];
  const fused = rrf([structure, lexical]);
  // y is found by both layers → it should top the fused list
  assert.equal(fused[0].id, "y");
  assert.match(fused[0].why, /structure\+lexical|lexical\+structure/);
});
