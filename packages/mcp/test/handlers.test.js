import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createHandlers } from "../dist/handlers.js";
import { anchor } from "@50firsttapes/core";

async function setup() {
  const bundle = await mkdtemp(join(tmpdir(), "tapes-mcp-"));
  await mkdir(join(bundle, "wiki"), { recursive: true });
  await writeFile(
    join(bundle, "wiki/a.md"),
    "---\ntype: note\ntitle: Alpha note\ntags:\n  - topic/ai\n---\n\nThe vector lives here.\n",
  );
  const h = createHandlers({ bundle, kinds: join(bundle, "spec/kinds") });
  return { bundle, h };
}

test("query finds a note by text", async () => {
  const { h } = await setup();
  const hits = await h.query({ text: "vector" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, "wiki/a");
});

test("read returns content; off-limits is refused", async () => {
  const { h } = await setup();
  const r = await h.read({ id: "wiki/a" });
  assert.match(r.content, /Alpha note/);
  await assert.rejects(() => h.read({ id: "secrets/x" }), /off-limits/);
  await assert.rejects(() => h.read({ id: "../escape" }), /invalid path/);
});

test("list shows entries and hides dot-dirs and off-limits", async () => {
  const { bundle, h } = await setup();
  await mkdir(join(bundle, "secrets"), { recursive: true });
  await mkdir(join(bundle, ".git"), { recursive: true });
  const names = (await h.list({ path: "" })).map((e) => e.name);
  assert.ok(names.includes("wiki"));
  assert.ok(!names.includes("secrets"));
  assert.ok(!names.includes(".git"));
});

test("write creates a note when the gates pass", async () => {
  const { bundle, h } = await setup();
  const res = await h.write({ id: "wiki/new", content: "---\ntype: note\ntitle: New\n---\n\nbody\n" });
  assert.equal(res.written, true);
  assert.match(await readFile(join(bundle, "wiki/new.md"), "utf8"), /title: New/);
});

test("write is refused for off-limits paths and credential-like content", async () => {
  const { h } = await setup();
  const off = await h.write({ id: "secrets/x", content: "---\ntype: note\ntitle: x\n---\nbody\n" });
  assert.equal(off.written, false);
  assert.ok(off.issues.some((i) => i.code === "off-limits"));

  const leak = await h.write({
    id: "wiki/leak",
    content: "---\ntype: note\ntitle: x\n---\nkey AKIA1234567890ABCDEF here\n",
  });
  assert.equal(leak.written, false);
  assert.ok(leak.issues.some((i) => i.code === "secret"));
});

test("govern reports acceptance without writing anything", async () => {
  const { bundle, h } = await setup();
  const g = await h.govern({ id: "secrets/y", content: "body" });
  assert.equal(g.accepted, false);
  await assert.rejects(() => readFile(join(bundle, "secrets/y.md"), "utf8"));
});

test("patch replaces an anchored paragraph and rejects a stale anchor", async () => {
  const { bundle, h } = await setup();
  await h.write({ id: "wiki/p", content: "---\ntype: note\ntitle: P\n---\n\nfirst para\n\nsecond para\n" });
  const a = anchor("first para");

  const ok = await h.patch({ id: "wiki/p", anchor: a, replacement: "FIRST changed" });
  assert.equal(ok.written, true);
  const text = await readFile(join(bundle, "wiki/p.md"), "utf8");
  assert.match(text, /FIRST changed/);
  assert.match(text, /second para/); // untouched
  assert.match(text, /title: P/); // frontmatter preserved

  const stale = await h.patch({ id: "wiki/p", anchor: a, replacement: "again" });
  assert.equal(stale.written, false); // the anchor no longer matches
});

test("lint runs over the bundle and reports counts", async () => {
  const { h } = await setup();
  const res = await h.lint({});
  assert.equal(typeof res.ok, "boolean");
  assert.equal(res.checked, 1);
});
