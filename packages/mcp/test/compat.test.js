import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createHandlers } from "../dist/handlers.js";

async function setup() {
  const bundle = await mkdtemp(join(tmpdir(), "tapes-compat-"));
  await mkdir(join(bundle, "wiki"), { recursive: true });
  await mkdir(join(bundle, "Log"), { recursive: true });
  await mkdir(join(bundle, "secrets"), { recursive: true });
  await writeFile(join(bundle, "AI_INSTRUCTIONS.md"), "# Rules\nbe good");
  await writeFile(join(bundle, "index.md"), "# Index\ndashboard");
  await writeFile(join(bundle, "wiki/a.md"), "---\ntype: note\ntitle: Alpha\n---\n\nthe vector lives here");
  await writeFile(join(bundle, "secrets/s.md"), "secret");
  await writeFile(join(bundle, "Log/2026-06-18-0900-fix-old.md"), "old entry body");
  await writeFile(join(bundle, "Log/2026-06-19-1000-feat-new.md"), "new entry body");
  return createHandlers({ bundle, kinds: join(bundle, "spec/kinds") });
}

test("session_bootstrap concatenates the files; lite skips the index", async () => {
  const h = await setup();
  const full = await h.session_bootstrap({});
  assert.match(full, /=== AI_INSTRUCTIONS\.md ===/);
  assert.match(full, /=== index\.md ===/);
  const lite = await h.session_bootstrap({ lite: true });
  assert.match(lite, /=== AI_INSTRUCTIONS\.md ===/);
  assert.ok(!/=== index\.md ===/.test(lite));
});

test("read_note reads by relative path; off-limits is refused", async () => {
  const h = await setup();
  assert.match(await h.read_note({ path: "wiki/a.md" }), /vector lives here/);
  await assert.rejects(() => h.read_note({ path: "secrets/s.md" }), /off-limits/);
});

test("list_folder lists entries and hides off-limits", async () => {
  const h = await setup();
  const names = (await h.list_folder({ path: "" })).map((e) => e.name);
  assert.ok(names.includes("wiki"));
  assert.ok(!names.includes("secrets"));
  await assert.rejects(() => h.list_folder({}), /requires a path/);
});

test("search returns ranked matches as text; scope filters", async () => {
  const h = await setup();
  assert.match(await h.search({ query: "vector" }), /wiki\/a/);
  assert.equal(await h.search({ query: "vector", scope: "other" }), "[no matches]");
});

test("get_recent_logs returns the newest entries first", async () => {
  const h = await setup();
  const logs = await h.get_recent_logs({ n: 5 });
  assert.equal(logs[0].path, "Log/2026-06-19-1000-feat-new.md");
  assert.match(logs[0].preview, /new entry/);
});
