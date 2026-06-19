import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { parseDocument } from "./frontmatter.js";
import { loadKinds } from "./kinds.js";
import { validateNote } from "./validator.js";
import type { Issue, LintResult, Note } from "./types.js";

export * from "./types.js";
export * from "./frontmatter.js";
export * from "./kinds.js";
export * from "./validator.js";
export * from "./govern.js";
export * from "./anchor.js";

/** Load a single note from disk, computing its OKF concept id. */
export async function loadNote(path: string, bundleRoot: string): Promise<Note> {
  const raw = await readFile(path, "utf8");
  const { frontmatter, body } = parseDocument(raw);
  const id = relative(bundleRoot, path).replace(/\.md$/, "");
  return { id, path, frontmatter, body };
}

/** Validate a set of note paths against the kinds in kindsDir. */
export async function lintNotes(
  paths: string[],
  kindsDir: string,
  bundleRoot: string,
): Promise<LintResult> {
  const kinds = await loadKinds(kindsDir);
  const issues: Issue[] = [];
  for (const p of paths) {
    const note = await loadNote(p, bundleRoot);
    issues.push(...validateNote(note, kinds));
  }
  return { ok: !issues.some((i) => i.level === "error"), issues, checked: paths.length };
}
