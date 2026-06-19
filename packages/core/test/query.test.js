import { test } from "node:test";
import assert from "node:assert/strict";
import { queryNotes } from "../dist/index.js";

const note = (id, frontmatter = {}, body = "") => ({
  id,
  path: `/b/${id}.md`,
  frontmatter,
  body,
});

test("text query matches all terms and ranks title hits above body hits", () => {
  const notes = [
    note("a", { title: "Vector search design" }, "about embeddings"),
    note("b", { title: "Cooking" }, "a vector lives only in the body"),
    note("c", { title: "Unrelated" }, "nothing here"),
  ];
  const hits = queryNotes(notes, { text: "vector" });
  assert.deepEqual(hits.map((h) => h.id), ["a", "b"]);
  assert.ok(hits[0].score > hits[1].score);
  assert.ok(hits[1].snippet?.toLowerCase().includes("vector"));
});

test("multi-term text requires every term to appear", () => {
  const notes = [
    note("a", { title: "vector search" }, ""),
    note("b", { title: "vector" }, "no second term"),
  ];
  assert.deepEqual(queryNotes(notes, { text: "vector search" }).map((h) => h.id), ["a"]);
});

test("kind filter resolves the type from a type/<x> tag", () => {
  const notes = [
    note("a", { tags: ["type/note"], title: "n" }),
    note("b", { tags: ["type/project"], title: "p" }),
  ];
  assert.deepEqual(queryNotes(notes, { kind: "project" }).map((h) => h.id), ["b"]);
});

test("tag filter matches the exact tag and deeper tags under it", () => {
  const notes = [
    note("a", { tags: ["topic/ai"] }),
    note("b", { tags: ["topic/ai/agents"] }),
    note("c", { tags: ["topic/cooking"] }),
  ];
  assert.deepEqual(queryNotes(notes, { tag: "topic/ai" }).map((h) => h.id).sort(), ["a", "b"]);
  assert.deepEqual(queryNotes(notes, { tag: "topic" }).map((h) => h.id).sort(), ["a", "b", "c"]);
});

test("status filter", () => {
  const notes = [note("a", { status: "active" }), note("b", { status: "done" })];
  assert.deepEqual(queryNotes(notes, { status: "done" }).map((h) => h.id), ["b"]);
});

test("links-to returns backlinks via both wikilinks and path links", () => {
  const notes = [
    note("target", { title: "T" }),
    note("a", {}, "see [[target]]"),
    note("b", {}, "ref [t](/target.md)"),
    note("c", {}, "no link here"),
  ];
  assert.deepEqual(queryNotes(notes, { linksTo: "target" }).map((h) => h.id).sort(), ["a", "b"]);
});

test("filters AND together (kind + text)", () => {
  const notes = [
    note("a", { tags: ["type/note"], title: "vector note" }),
    note("b", { tags: ["type/project"], title: "vector project" }),
  ];
  assert.deepEqual(queryNotes(notes, { text: "vector", kind: "project" }).map((h) => h.id), ["b"]);
});

test("limit caps the number of results", () => {
  const notes = Array.from({ length: 5 }, (_, i) => note(`n${i}`, { title: "vector" }, "v"));
  assert.equal(queryNotes(notes, { text: "vector" }, { limit: 2 }).length, 2);
});
