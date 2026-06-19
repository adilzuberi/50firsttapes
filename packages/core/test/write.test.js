import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeNote } from "../dist/index.js";

const note = (t) => `---\ntype: note\ntitle: ${t}\n---\n\nbody\n`;
const bundle = () => mkdtemp(join(tmpdir(), "tapes-write-"));

test("writeNote writes when the gates pass", async () => {
  const root = await bundle();
  const res = await writeNote(root, "wiki/ok", note("Ok"));
  assert.equal(res.written, true);
  assert.equal(res.id, "wiki/ok");
  assert.match(await readFile(join(root, "wiki/ok.md"), "utf8"), /title: Ok/);
});

test("writeNote refuses off-limits paths and credential-like content", async () => {
  const root = await bundle();
  const off = await writeNote(root, "secrets/x", note("x"));
  assert.equal(off.written, false);
  assert.ok(off.issues.some((i) => i.code === "off-limits"));

  const cred = await writeNote(root, "wiki/leak", "---\ntype: note\n---\ntoken AKIA1234567890ABCDEF\n");
  assert.equal(cred.written, false);
  assert.ok(cred.issues.some((i) => i.code === "secret"));
});

test("writeNote dry-run checks but does not write; an escaping id throws", async () => {
  const root = await bundle();
  const res = await writeNote(root, "wiki/draft", note("Draft"), { dryRun: true });
  assert.equal(res.written, false);
  await assert.rejects(() => stat(join(root, "wiki/draft.md")));
  await assert.rejects(() => writeNote(root, "../escape", note("e")), /escapes the bundle|invalid id/);
});
