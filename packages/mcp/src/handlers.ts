import { readdir, readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import {
  applyPatch,
  defaultGates,
  lintBundle,
  parseDocument,
  queryBundle,
  runGates,
  writeNote,
  type Issue,
} from "@50firsttapes/core";

export interface McpConfig {
  /** Absolute path to the bundle root. */
  bundle: string;
  /** Absolute path to the kind schemas. */
  kinds: string;
}

// Off-limits by the vault rulebook — never read or written.
const OFF_LIMITS = /(^|\/)(private-no-ai|private|no-ai|secrets)(\/|$)/i;

/** The server-wide instruction handed to every MCP client on initialize. */
export const SERVER_INSTRUCTIONS =
  "This server speaks the 50 First Tapes protocol over a knowledge bundle of " +
  "markdown notes. Read with query/read/list/lint; write with write/patch. " +
  "Every write passes governance gates — off-limits paths (private/secrets) and " +
  "credential-like strings are refused. Use govern to dry-run the gates on a " +
  "proposed note before writing, and patch (hash-anchored) for surgical, " +
  "concurrency-safe edits rather than whole-file rewrites.";

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/** Resolve a bundle-relative id to an absolute path, rejecting escapes. Does not check off-limits. */
function resolveWithin(cfg: McpConfig, id: string): { abs: string; rel: string } {
  const rel = id.replace(/^\/+/, "");
  if (!rel || rel.split("/").includes("..")) throw new Error(`invalid path: ${id}`);
  const withExt = rel.endsWith(".md") ? rel : `${rel}.md`;
  const abs = resolve(cfg.bundle, withExt);
  if (abs !== cfg.bundle && !abs.startsWith(cfg.bundle + sep)) {
    throw new Error(`path escapes the bundle: ${id}`);
  }
  return { abs, rel: withExt };
}

/** List the entries directly under a bundle folder, hiding dot-dirs and off-limits. */
async function listDir(cfg: McpConfig, rawPath: string) {
  const rel = rawPath.replace(/^\/+/, "");
  if (rel.split("/").includes("..") || OFF_LIMITS.test(rel)) throw new Error("invalid path");
  const entries = await readdir(resolve(cfg.bundle, rel), { withFileTypes: true });
  return entries
    .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules" && !OFF_LIMITS.test(e.name))
    .map((e) => ({ name: e.name, path: rel ? `${rel}/${e.name}` : e.name, type: e.isDirectory() ? "dir" : "file" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function blocks(issues: Issue[]): boolean {
  return issues.some((i) => i.level === "error");
}

// Log/ entries are date-prefixed (YYYY-MM-DD-HHMM-...), so a reverse name sort is newest-first.
const LOG_NAME = /^\d{4}-\d{2}-\d{2}-\d{4}-/;

// session_bootstrap concatenates these in order; override with TAPES_BOOTSTRAP_FILES.
function bootstrapFiles(): string[] {
  const env = process.env.TAPES_BOOTSTRAP_FILES;
  if (env) return env.split(",").map((s) => s.trim()).filter(Boolean);
  return ["AI_INSTRUCTIONS.md", "index.md", "wiki/references/ai-pre-authorised-access.md"];
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "query",
    description:
      "Find notes by free text (every term must hit title/body/id; title weighted, newest first), and/or by kind, tag (exact or a prefix of a deeper tag), status, or backlinks (--links-to). Prefer this over guessing what the bundle contains.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Free-text terms; all must appear." },
        kind: { type: "string", description: "Only notes of this kind." },
        tag: { type: "string", description: "Only notes carrying this tag (or a deeper tag under it)." },
        status: { type: "string", description: "Only notes with this lifecycle status." },
        links_to: { type: "string", description: "Backlinks: only notes that link to this concept id." },
        limit: { type: "integer", description: "Max results (default 20)." },
      },
    },
  },
  {
    name: "read",
    description: "Read one note by its concept id (path without the .md suffix). Off-limits paths are refused.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Concept id, e.g. wiki/decisions/foo" } },
      required: ["id"],
    },
  },
  {
    name: "list",
    description: "List the entries directly under a bundle folder. Dot-dirs and off-limits folders are hidden.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Folder path; empty for the bundle root." } },
    },
  },
  {
    name: "lint",
    description:
      "Validate notes against their kinds and check structural health (broken/stale links, orphans, committed blobs, hot-core budget). Returns counts plus a sample of findings.",
    inputSchema: {
      type: "object",
      properties: {
        structure: { type: "boolean", description: "Run structural checks (default true)." },
        orphans: { type: "boolean", description: "Include the orphan check (default true)." },
      },
    },
  },
  {
    name: "govern",
    description:
      "Dry-run the governance gates on a proposed note WITHOUT writing it. Returns whether it would be accepted and any blocking issues. Use before write.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Intended concept id." },
        content: { type: "string", description: "Full note markdown (frontmatter + body)." },
      },
      required: ["id", "content"],
    },
  },
  {
    name: "write",
    description:
      "Write (create or replace) a note. The content passes the governance gates first; an off-limits path or a credential-like string is refused and nothing is written.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Concept id, e.g. wiki/notes/foo" },
        content: { type: "string", description: "Full note markdown (frontmatter + body)." },
      },
      required: ["id", "content"],
    },
  },
  {
    name: "patch",
    description:
      "Surgically edit a note's body by hash anchor: replace the paragraph whose content hash matches `anchor` with `replacement`. Rejected if the anchored content has moved (concurrency-safe). Frontmatter is preserved; the result passes the gates.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Concept id of the note to patch." },
        anchor: { type: "string", description: "The 12-char content hash of the paragraph to replace." },
        replacement: { type: "string", description: "The new paragraph text." },
      },
      required: ["id", "anchor", "replacement"],
    },
  },
  {
    name: "session_bootstrap",
    description:
      "MUST-CALL-FIRST in a new conversation. Returns the bundle's session-start files concatenated (vault rules, dashboard, access ledger). Pass lite=true to skip the large index/dashboard. Compatibility tool for wiki-mcp consumers.",
    inputSchema: {
      type: "object",
      properties: { lite: { type: "boolean", description: "Skip the index/dashboard file for a smaller response." } },
    },
  },
  {
    name: "read_note",
    description: "Read one file by its relative path (wiki-mcp compatibility). Off-limits paths are refused.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Relative path inside the bundle, e.g. wiki/decisions/foo.md" } },
      required: ["path"],
    },
  },
  {
    name: "list_folder",
    description: "List the entries under a bundle folder (wiki-mcp compatibility). Off-limits folders are hidden.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Relative folder path, e.g. wiki/decisions" } },
      required: ["path"],
    },
  },
  {
    name: "search",
    description:
      "Full-text search across the bundle, returning ranked path + title + snippet lines (wiki-mcp compatibility; composed onto query). Optional folder scope.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms." },
        scope: { type: "string", description: "Optional folder to scope the search." },
      },
      required: ["query"],
    },
  },
  {
    name: "get_recent_logs",
    description: "Return the newest N entries from the bundle's Log/ folder, newest first (wiki-mcp compatibility). Default 10, max 50.",
    inputSchema: {
      type: "object",
      properties: { n: { type: "integer", description: "Number of entries (1-50)." } },
    },
  },
];

export type Handler = (args: Record<string, unknown>) => Promise<unknown>;

export function createHandlers(cfg: McpConfig): Record<string, Handler> {
  return {
    async query(args) {
      return queryBundle(
        cfg.bundle,
        cfg.kinds,
        {
          text: str(args.text),
          kind: str(args.kind),
          tag: str(args.tag),
          status: str(args.status),
          linksTo: str(args.links_to),
        },
        { limit: typeof args.limit === "number" ? args.limit : 20 },
      );
    },

    async read(args) {
      const id = str(args.id);
      if (!id) throw new Error("read requires an id");
      const { abs, rel } = resolveWithin(cfg, id);
      if (OFF_LIMITS.test(rel)) throw new Error(`off-limits path: ${id}`);
      return { id, content: await readFile(abs, "utf8") };
    },

    async list(args) {
      return listDir(cfg, str(args.path) ?? "");
    },

    async lint(args) {
      const res = await lintBundle(cfg.bundle, cfg.kinds, {
        structure: args.structure as boolean | undefined,
        orphans: args.orphans as boolean | undefined,
      });
      const counts: Record<string, number> = {};
      for (const i of res.issues) counts[i.code] = (counts[i.code] ?? 0) + 1;
      return {
        ok: res.ok,
        checked: res.checked,
        blobsChecked: res.blobsChecked,
        counts,
        sample: res.issues.slice(0, 30),
      };
    },

    async govern(args) {
      const id = str(args.id);
      const content = str(args.content);
      if (!id || content === undefined) throw new Error("govern requires id and content");
      const { frontmatter } = parseDocument(content);
      const issues = runGates(defaultGates, { path: id, body: content, frontmatter });
      return { accepted: !blocks(issues), issues };
    },

    async write(args) {
      const id = str(args.id);
      const content = str(args.content);
      if (!id || content === undefined) throw new Error("write requires id and content");
      return writeNote(cfg.bundle, id, content);
    },

    async patch(args) {
      const id = str(args.id);
      const anchorHash = str(args.anchor);
      const replacement = str(args.replacement);
      if (!id || !anchorHash || replacement === undefined) {
        throw new Error("patch requires id, anchor and replacement");
      }
      const { abs } = resolveWithin(cfg, id);
      const raw = await readFile(abs, "utf8");
      const m = /^(---\n[\s\S]*?\n---\n?)([\s\S]*)$/.exec(raw);
      const head = m ? m[1] : "";
      const body = m ? m[2] : raw;
      const result = applyPatch(body, { anchor: anchorHash, replacement });
      if (!result.ok) return { written: false, reason: result.reason };
      return writeNote(cfg.bundle, id, head + result.body);
    },

    // --- wiki-mcp compatibility: same tool names/shapes so the engine can stand in for the gateway ---

    async session_bootstrap(args) {
      const lite = args.lite === true;
      const files = bootstrapFiles().filter((f) => !lite || !/(^|\/)index\.md$/i.test(f));
      const parts: string[] = [];
      for (const rel of files) {
        try {
          const { abs } = resolveWithin(cfg, rel);
          parts.push(`# === ${rel} ===\n\n${await readFile(abs, "utf8")}`);
        } catch (e) {
          parts.push(`# === ${rel} ===\n\n[unavailable: ${e instanceof Error ? e.message : String(e)}]`);
        }
      }
      return parts.join("\n\n");
    },

    async read_note(args) {
      const path = str(args.path);
      if (!path) throw new Error("read_note requires a path");
      const { abs, rel } = resolveWithin(cfg, path);
      if (OFF_LIMITS.test(rel)) throw new Error(`off-limits path: ${path}`);
      return readFile(abs, "utf8");
    },

    async list_folder(args) {
      if (typeof args.path !== "string") throw new Error("list_folder requires a path");
      return listDir(cfg, args.path);
    },

    async search(args) {
      const query = str(args.query);
      if (!query) throw new Error("search requires a query");
      const scope = str(args.scope)?.replace(/^\/+|\/+$/g, "");
      let hits = await queryBundle(cfg.bundle, cfg.kinds, { text: query }, { limit: 20 });
      if (scope) hits = hits.filter((h) => h.id === scope || h.id.startsWith(`${scope}/`));
      const lines = hits.map(
        (h) => `${h.id}${h.title ? ` — ${h.title}` : ""}${h.snippet ? `\n  ${h.snippet}` : ""}`,
      );
      return lines.join("\n") || "[no matches]";
    },

    async get_recent_logs(args) {
      const n = Math.max(1, Math.min(Number(args.n ?? 10) || 10, 50));
      let names: string[];
      try {
        names = (await readdir(resolve(cfg.bundle, "Log"))).filter((f) => f.endsWith(".md") && LOG_NAME.test(f));
      } catch {
        return [];
      }
      names.sort().reverse();
      const out: Array<{ path: string; preview: string }> = [];
      for (const name of names.slice(0, n)) {
        out.push({ path: `Log/${name}`, preview: (await readFile(resolve(cfg.bundle, "Log", name), "utf8")).slice(0, 400) });
      }
      return out;
    },
  };
}
