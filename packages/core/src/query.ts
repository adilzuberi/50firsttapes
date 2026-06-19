import type { Note } from "./types.js";
import { resolveType, statusOf, tagsOf } from "./validator.js";
import { buildBasenameIndex, extractLinkTargets, resolveLinkTarget } from "./structure.js";

/** A query over a loaded bundle. Filters AND together. */
export interface QueryFilter {
  /** Free text — every whitespace-separated term must appear (title, body, or id). */
  text?: string;
  /** Only this kind (resolved from `type:` or a `type/<kind>` tag). */
  kind?: string;
  /** Only notes carrying this tag (exact, or a `prefix/` of a deeper tag). */
  tag?: string;
  /** Only this lifecycle status. */
  status?: string;
  /** Backlinks: only notes that link to this concept id. */
  linksTo?: string;
}

export interface QueryHit {
  id: string;
  title?: string;
  kind?: string;
  score: number;
  snippet?: string;
}

export interface QueryOptions {
  limit?: number;
  knownKinds?: Iterable<string>;
}

function titleOf(n: Note): string | undefined {
  const t = (n.frontmatter as Record<string, unknown>).title;
  return typeof t === "string" ? t : undefined;
}

function dateOf(n: Note): string {
  const d = (n.frontmatter as Record<string, unknown>).date;
  return typeof d === "string" ? d : d instanceof Date ? d.toISOString() : "";
}

function tagMatch(tags: string[], filter: string): boolean {
  return tags.some((t) => t === filter || t.startsWith(`${filter}/`));
}

function countOccurrences(haystack: string, needle: string): number {
  return needle ? haystack.split(needle).length - 1 : 0;
}

function firstSnippet(body: string, terms: string[], max = 160): string | undefined {
  const lines = body.split("\n").map((l) => l.trim());
  const hit = lines.find((l) => l && terms.some((t) => l.toLowerCase().includes(t)));
  const line = hit ?? lines.find((l) => l && !l.startsWith("#"));
  if (!line) return undefined;
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

/** Compute the set of note ids that link to a target id (backlinks). */
function backlinkSet(notes: Note[], targetId: string): Set<string> {
  const idSet = new Set(notes.map((n) => n.id));
  const byBasename = buildBasenameIndex(notes);
  const out = new Set<string>();
  for (const n of notes) {
    for (const link of extractLinkTargets(n.body)) {
      const targets = resolveLinkTarget(link, n.id, idSet, byBasename);
      if (targets && targets.includes(targetId)) {
        out.add(n.id);
        break;
      }
    }
  }
  return out;
}

/** Query a loaded note set. Pure; ranks text hits by weighted occurrence, newest first on ties. */
export function queryNotes(notes: Note[], filter: QueryFilter, opts: QueryOptions = {}): QueryHit[] {
  const limit = opts.limit ?? 20;
  const terms = (filter.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const backlinkers = filter.linksTo ? backlinkSet(notes, filter.linksTo) : undefined;

  const hits: QueryHit[] = [];
  for (const n of notes) {
    if (filter.kind && resolveType(n.frontmatter, opts.knownKinds) !== filter.kind) continue;
    if (filter.status && statusOf(n.frontmatter) !== filter.status) continue;
    if (filter.tag && !tagMatch(tagsOf(n.frontmatter), filter.tag)) continue;
    if (backlinkers && !backlinkers.has(n.id)) continue;

    let score = 1;
    let snippet: string | undefined;
    if (terms.length) {
      const title = (titleOf(n) ?? "").toLowerCase();
      const body = n.body.toLowerCase();
      const id = n.id.toLowerCase();
      let matchedAll = true;
      let s = 0;
      for (const term of terms) {
        const t = countOccurrences(title, term);
        const b = countOccurrences(body, term);
        const i = id.includes(term) ? 1 : 0;
        if (!t && !b && !i) {
          matchedAll = false;
          break;
        }
        s += t * 5 + b + i * 2;
      }
      if (!matchedAll) continue;
      score = s;
      snippet = firstSnippet(n.body, terms);
    }

    hits.push({ id: n.id, title: titleOf(n), kind: resolveType(n.frontmatter, opts.knownKinds), score, snippet });
  }

  const dateById = new Map(notes.map((n) => [n.id, dateOf(n)]));
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      (dateById.get(b.id) ?? "").localeCompare(dateById.get(a.id) ?? "") ||
      a.id.localeCompare(b.id),
  );
  return hits.slice(0, limit);
}
