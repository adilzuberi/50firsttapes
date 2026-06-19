import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseDocument } from "./frontmatter.js";
import { loadKinds } from "./kinds.js";
import { validateNote } from "./validator.js";
import { checkCommittedBlobs, checkStructure } from "./structure.js";
import { queryNotes, type QueryFilter, type QueryHit, type QueryOptions } from "./query.js";
import { buildNote, type IngestInput } from "./ingest.js";
import { defaultGates, runGates } from "./govern.js";
import type { BlobInfo, Issue, LintOptions, LintResult, Note } from "./types.js";

export * from "./types.js";
export * from "./frontmatter.js";
export * from "./kinds.js";
export * from "./validator.js";
export * from "./structure.js";
export * from "./query.js";
export * from "./ingest.js";
export * from "./govern.js";
export * from "./anchor.js";

// Off-limits by the vault rulebook — never read. Dot-directories (`.git`,
// `.obsidian`, macOS `.DocumentRevisions-V100`, a committed `.tapes` index) are
// machinery, not substrate, and are skipped too.
const OFF_LIMITS = /^(private-no-ai|private|no-ai|secrets)$/;

function skipDir(name: string): boolean {
  return name.startsWith(".") || name === "node_modules" || OFF_LIMITS.test(name);
}

interface WalkResult {
  noteFiles: string[];
  blobs: Array<BlobInfo & { abs: string }>;
}

/** Walk a bundle, splitting markdown notes from other (blob) files. Unreadable paths are skipped. */
export async function walkBundle(root: string): Promise<WalkResult> {
  const noteFiles: string[] = [];
  const blobs: Array<BlobInfo & { abs: string }> = [];
  async function recur(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // permission denied, vanished, etc. — not substrate, move on
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipDir(entry.name)) continue;
        await recur(abs);
      } else if (entry.isFile()) {
        if (entry.name.endsWith(".md")) noteFiles.push(abs);
        else {
          try {
            const { size } = await stat(abs);
            blobs.push({ path: relative(root, abs), size, abs });
          } catch {
            // broken symlink or unreadable file — skip
          }
        }
      }
    }
  }
  await recur(root);
  return { noteFiles, blobs };
}

/** Load a single note from disk, computing its OKF concept id. */
export async function loadNote(path: string, bundleRoot: string): Promise<Note> {
  const raw = await readFile(path, "utf8");
  const { frontmatter, body, error } = parseDocument(raw);
  const id = relative(bundleRoot, path).replace(/\.md$/, "");
  return { id, path, frontmatter, body, parseError: error };
}

/** Validate a set of note paths against the kinds in kindsDir (schema only). */
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

/**
 * Lint a whole bundle: per-note schema validation plus structural-health checks
 * (broken/stale links, orphans, hot-core budget, committed-blob guard).
 */
export async function lintBundle(
  bundleRoot: string,
  kindsDir: string,
  opts: LintOptions = {},
): Promise<LintResult> {
  const kinds = await loadKinds(kindsDir);
  const { noteFiles, blobs } = await walkBundle(bundleRoot);
  const notes = await Promise.all(noteFiles.map((p) => loadNote(p, bundleRoot)));

  const issues: Issue[] = [];
  for (const note of notes) issues.push(...validateNote(note, kinds));

  if (opts.structure !== false) {
    issues.push(
      ...checkStructure(notes, {
        orphans: opts.orphans,
        hotCoreTokenBudget: opts.hotCoreTokenBudget,
      }),
    );
    issues.push(
      ...checkCommittedBlobs(
        blobs.map(({ path, size }) => ({ path, size })),
        { maxBlobBytes: opts.maxBlobBytes },
      ),
    );
  }

  return {
    ok: !issues.some((i) => i.level === "error"),
    issues,
    checked: notes.length,
    blobsChecked: blobs.length,
  };
}

export interface WriteResult {
  id: string;
  path: string;
  written: boolean;
  /** Governance findings — an error here blocks the write. */
  issues: Issue[];
}

/** Resolve a bundle-relative id to a safe absolute path, rejecting escapes. */
function resolveInBundle(bundleRoot: string, id: string): { abs: string; rel: string } {
  const rel = `${id.replace(/^\/+/, "").replace(/\.md$/, "")}.md`;
  if (rel.split("/").includes("..")) throw new Error(`invalid id: ${id}`);
  const abs = resolve(bundleRoot, rel);
  if (abs !== bundleRoot && !abs.startsWith(bundleRoot + sep)) {
    throw new Error(`id escapes the bundle: ${id}`);
  }
  return { abs, rel };
}

/**
 * Write exact content to a note id, through the governance gates. An off-limits
 * path or credential-like content is refused and nothing is written. This is the
 * single governed-write path shared by ingest, the CLI, and the MCP server.
 */
export async function writeNote(
  bundleRoot: string,
  id: string,
  content: string,
  opts: { dryRun?: boolean } = {},
): Promise<WriteResult> {
  const { abs, rel } = resolveInBundle(bundleRoot, id);
  const { frontmatter } = parseDocument(content);
  const issues = runGates(defaultGates, { path: rel, body: content, frontmatter });
  let written = false;
  if (!issues.some((i) => i.level === "error") && !opts.dryRun) {
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    written = true;
  }
  return { id: rel.replace(/\.md$/, ""), path: abs, written, issues };
}

export interface IngestResult {
  id: string;
  path: string;
  written: boolean;
  content: string;
  /** Governance findings — an error here blocks the write. */
  gateIssues: Issue[];
  /** Schema findings — reported for curation, never block intake. */
  schemaIssues: Issue[];
}

/**
 * Ingest raw material as a governed, kind-scaffolded note. The governance gates
 * block (off-limits paths, credentials); schema gaps are reported, not blocked —
 * intake is raw, curation comes after. `dryRun` assembles and checks without writing.
 */
export async function ingestBundle(
  bundleRoot: string,
  kindsDir: string,
  input: IngestInput,
  opts: { dryRun?: boolean } = {},
): Promise<IngestResult> {
  const built = buildNote(input);
  const wr = await writeNote(bundleRoot, built.id, built.content, opts);
  const kinds = await loadKinds(kindsDir);
  const schemaIssues = validateNote(
    { id: built.id, path: wr.path, frontmatter: built.frontmatter, body: input.content },
    kinds,
  );
  return {
    id: built.id,
    path: wr.path,
    written: wr.written,
    content: built.content,
    gateIssues: wr.issues,
    schemaIssues,
  };
}

/** Query a bundle on disk: walk, load, and rank against the filter. */
export async function queryBundle(
  bundleRoot: string,
  kindsDir: string,
  filter: QueryFilter,
  opts: Omit<QueryOptions, "knownKinds"> = {},
): Promise<QueryHit[]> {
  const [{ noteFiles }, kinds] = await Promise.all([walkBundle(bundleRoot), loadKinds(kindsDir)]);
  const notes = await Promise.all(noteFiles.map((p) => loadNote(p, bundleRoot)));
  return queryNotes(notes, filter, { ...opts, knownKinds: kinds.keys() });
}
