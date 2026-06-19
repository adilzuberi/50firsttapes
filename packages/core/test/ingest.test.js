import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildNote, slugify, firstHeading, ingestBundle, parseDocument } from "../dist/index.js";

test("slugify and firstHeading derive sane defaults", () => {
  assert.equal(slugify("The Production AI Playbook: Deploying!"), "the-production-ai-playbook-deploying");
  assert.equal(slugify("   "), "untitled");
  assert.equal(firstHeading("intro\n\n## A Real Heading\n\nbody"), "A Real Heading");
});

test("buildNote scaffolds valid frontmatter and a default inbox id", () => {
  const built = buildNote({ content: "# Hello\n\nbody", date: "2026-06-19" });
  assert.equal(built.id, "inbox/hello");
  const { frontmatter, body } = parseDocument(built.content);
  assert.equal(frontmatter.type, "note");
  assert.equal(frontmatter.title, "Hello");
  assert.equal(frontmatter.date, "2026-06-19");
  assert.match(String(frontmatter.source), /ingested 2026-06-19/);
  assert.match(body, /body/);
});

test("buildNote quotes a colon-bearing title (valid YAML)", () => {
  const built = buildNote({ content: "x", title: "Playbook: Deploying", date: "2026-06-19" });
  const { frontmatter } = parseDocument(built.content);
  assert.equal(frontmatter.title, "Playbook: Deploying");
});

async function bundle() {
  return mkdtemp(join(tmpdir(), "tapes-ingest-"));
}

test("ingestBundle writes a note and reports schema gaps without blocking", async () => {
  const root = await bundle();
  const res = await ingestBundle(root, join(root, "spec/kinds"), {
    content: "# A Note\n\nsome body",
    date: "2026-06-19",
  });
  assert.equal(res.written, true);
  assert.equal(res.id, "inbox/a-note");
  const onDisk = await readFile(join(root, "inbox/a-note.md"), "utf8");
  assert.match(onDisk, /title: A Note/);
  // no kinds dir → kind "note" is unknown, so no missing-field errors surface here
  assert.equal(res.gateIssues.length, 0);
});

test("ingestBundle is blocked by the gates (off-limits id, credential content)", async () => {
  const root = await bundle();

  const off = await ingestBundle(root, join(root, "spec/kinds"), {
    content: "body",
    id: "secrets/leak",
    date: "2026-06-19",
  });
  assert.equal(off.written, false);
  assert.ok(off.gateIssues.some((i) => i.code === "off-limits"));

  const cred = await ingestBundle(root, join(root, "spec/kinds"), {
    content: "token AKIA1234567890ABCDEF here",
    date: "2026-06-19",
  });
  assert.equal(cred.written, false);
  assert.ok(cred.gateIssues.some((i) => i.code === "secret"));
});

test("dry-run assembles and checks but writes nothing", async () => {
  const root = await bundle();
  const res = await ingestBundle(
    root,
    join(root, "spec/kinds"),
    { content: "# Draft\n\nbody", date: "2026-06-19" },
    { dryRun: true },
  );
  assert.equal(res.written, false);
  await assert.rejects(() => stat(join(root, "inbox/draft.md")));
});
