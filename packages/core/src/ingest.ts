import type { Frontmatter } from "./types.js";
import { serializeNote } from "./frontmatter.js";

/** Raw material plus the metadata needed to scaffold a note. */
export interface IngestInput {
  /** The note body — the source material. */
  content: string;
  /** Kind (default "note"). */
  kind?: string;
  /** Title (default: the first heading, else "untitled"). */
  title?: string;
  /** Concept id / path (default: inbox/<slug-of-title>). */
  id?: string;
  summary?: string;
  status?: string;
  /** Provenance. Default: "ingested <date>". */
  source?: string;
  /** ISO date YYYY-MM-DD. Default: today. */
  date?: string;
  tags?: string[];
}

export interface BuiltNote {
  id: string;
  frontmatter: Frontmatter;
  content: string;
}

/** A filesystem-safe slug from arbitrary text. */
export function slugify(s: string): string {
  const out = s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return out || "untitled";
}

/** The first markdown heading's text, if any. */
export function firstHeading(body: string): string | undefined {
  const m = body.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/m);
  return m ? m[1].trim() : undefined;
}

/** Scaffold a valid OKF note from raw material. Pure: pass `date` for determinism. */
export function buildNote(input: IngestInput): BuiltNote {
  const kind = input.kind?.trim() || "note";
  const title = input.title?.trim() || firstHeading(input.content) || "untitled";
  const date = input.date || new Date().toISOString().slice(0, 10);
  const id = input.id ? input.id.replace(/^\/+/, "").replace(/\.md$/, "") : `inbox/${slugify(title)}`;

  // Field order mirrors the vault note shape: type, title, then trust/lifecycle keys.
  const fm: Frontmatter = { type: kind, title };
  if (input.summary) fm.summary = input.summary;
  if (input.status) fm.status = input.status;
  fm.date = date;
  fm.source = input.source || `ingested ${date}`;
  if (input.tags?.length) fm.tags = input.tags;

  return { id, frontmatter: fm, content: serializeNote(fm, input.content) };
}
