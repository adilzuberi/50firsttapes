import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractLinkTargets,
  checkStructure,
  checkHotCore,
  checkCommittedBlobs,
  resolveType,
  statusOf,
} from "../dist/index.js";

const note = (id, frontmatter = {}, body = "") => ({
  id,
  path: `/bundle/${id}.md`,
  frontmatter,
  body,
});

const codes = (issues) => issues.map((i) => i.code).sort();

test("extractLinkTargets finds path links and wikilinks, skips images and embeds", () => {
  const body = [
    "A path link [hello](/notes/hello.md).",
    "A wikilink [[other-note]] and [[aliased|shown]].",
    "An image ![alt](/img/x.png) and an embed ![[big.png]] must be ignored.",
  ].join("\n");
  const got = extractLinkTargets(body);
  const path = got.filter((t) => t.kind === "path").map((t) => t.raw);
  const wiki = got.filter((t) => t.kind === "wiki").map((t) => t.raw);
  assert.deepEqual(path, ["/notes/hello.md"]);
  assert.deepEqual(wiki, ["other-note", "aliased"]);
});

test("broken-link fires for a link to a missing note", () => {
  const notes = [note("a", {}, "see [[missing]] and [[b]]"), note("b")];
  const issues = checkStructure(notes, { orphans: false });
  const broken = issues.filter((i) => i.code === "broken-link");
  assert.equal(broken.length, 1);
  assert.match(broken[0].message, /missing/);
});

test("orphan fires for an unlinked note, but not for a linked one or the index", () => {
  const notes = [
    note("index", {}, "entry: [[a]]"),
    note("a", {}, "links to [[b]]"),
    note("b"),
    note("lonely"),
  ];
  const orphans = checkStructure(notes).filter((i) => i.code === "orphan");
  const ids = orphans.map((i) => i.path);
  assert.ok(ids.includes("/bundle/lonely.md"));
  assert.ok(!ids.some((p) => p.endsWith("/index.md")));
  assert.ok(!ids.some((p) => p.endsWith("/b.md")));
});

test("stale-link warns when the target is superseded or replaced", () => {
  const notes = [
    note("a", {}, "old ref [[b]]"),
    note("b", { status: "superseded", replaced_by: "c" }),
    note("c"),
  ];
  const stale = checkStructure(notes, { orphans: false }).filter((i) => i.code === "stale-link");
  assert.equal(stale.length, 1);
  assert.match(stale[0].message, /superseded by "c"/);
});

test("committed-blob guard flags derived artefacts and oversized files", () => {
  const issues = checkCommittedBlobs(
    [
      { path: ".tapes/index/vectors.faiss", size: 10 },
      { path: "data/notes.sqlite", size: 10 },
      { path: "attachments/photo.jpg", size: 5 * 1024 * 1024 },
      { path: "notes/ok.md", size: 100 },
    ],
    { maxBlobBytes: 1024 * 1024 },
  );
  assert.deepEqual(codes(issues), ["committed-blob", "committed-blob", "large-blob"]);
});

test("hot-core-budget warns only when over budget", () => {
  const big = note("index", {}, "x".repeat(40000)); // ~10k tokens
  assert.equal(checkHotCore([big], 8000).length, 1);
  assert.equal(checkHotCore([big], 50000).length, 0);
  assert.equal(checkHotCore([note("plain", {}, "small")], 8000).length, 0);
});

test("resolveType and statusOf fall back to type/<x> and status/<x> tags", () => {
  assert.equal(resolveType({ tags: ["topic/x", "type/project"] }), "project");
  assert.equal(resolveType({ type: "note", tags: ["type/project"] }), "note");
  assert.equal(statusOf({ tags: ["status/active"] }), "active");
});

test("resolveType maps a bare tag that names a known kind", () => {
  const known = new Set(["log", "note", "project"]);
  assert.equal(resolveType({ tags: ["log", "log/2026", "verb/feat"] }, known), "log");
  assert.equal(resolveType({ tags: ["topic/x"] }, known), undefined);
});

test("link extraction ignores code blocks and inline code", () => {
  const body = "real [[a]]\ninline `[[b]]`\n```\n[[c]]\n```\n";
  const raws = extractLinkTargets(body).map((t) => t.raw);
  assert.deepEqual(raws, ["a"]);
});

test("a path-qualified wikilink to a moved note resolves by basename, not broken", () => {
  const notes = [
    note("AI_INSTRUCTIONS", {}, "see [[wiki/references/voice-uk-english]]"),
    note("rules-of-engagement/voice-uk-english"),
  ];
  const broken = checkStructure(notes, { orphans: false }).filter((i) => i.code === "broken-link");
  assert.equal(broken.length, 0);
});
