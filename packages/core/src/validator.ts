import type { Frontmatter, Issue, Kind, Note } from "./types.js";

/** Frontmatter tags as a string array, tolerating a scalar or a missing value. */
export function tagsOf(fm: Frontmatter): string[] {
  const t = (fm as Record<string, unknown>).tags;
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return typeof t === "string" ? [t] : [];
}

/**
 * Resolve a note's kind. Prefer an explicit top-level `type:`; fall back to a
 * `type/<kind>` tag, which is how the dogfood vault encodes its kind today; and
 * failing that, a bare tag that names a known kind (e.g. a log entry tagged `log`).
 */
export function resolveType(fm: Frontmatter, known?: Iterable<string>): string | undefined {
  if (typeof fm.type === "string" && fm.type) return fm.type;
  const tags = tagsOf(fm);
  const typeTag = tags.find((t) => t.startsWith("type/"));
  if (typeTag) return typeTag.slice("type/".length);
  if (known) {
    const set = known instanceof Set ? known : new Set(known);
    const bare = tags.find((t) => set.has(t));
    if (bare) return bare;
  }
  return undefined;
}

/** Resolve a note's lifecycle status from `status:` or a `status/<x>` tag. */
export function statusOf(fm: Frontmatter): string | undefined {
  if (typeof fm.status === "string" && fm.status) return fm.status;
  const tag = tagsOf(fm).find((t) => t.startsWith("status/"));
  return tag ? tag.slice("status/".length) : undefined;
}

/** Check one note's frontmatter against its declared kind. */
export function validateNote(note: Note, kinds: Map<string, Kind>): Issue[] {
  const issues: Issue[] = [];

  if (note.parseError) {
    return [
      {
        level: "error",
        code: "bad-frontmatter",
        message: `frontmatter is not valid YAML: ${note.parseError}`,
        path: note.path,
      },
    ];
  }

  const fm = note.frontmatter;
  const type = resolveType(fm, kinds.keys());

  if (!type) {
    issues.push({
      level: "error",
      code: "missing-type",
      message: "frontmatter is missing the required `type` field",
      path: note.path,
    });
    return issues;
  }

  const kind = kinds.get(type);
  if (!kind) {
    // OKF rule: tolerate unknown types, but flag them for curation.
    issues.push({
      level: "warn",
      code: "unknown-kind",
      message: `no schema registered for kind "${type}"`,
      path: note.path,
    });
    return issues;
  }

  const record = fm as Record<string, unknown>;
  for (const rule of kind.fields) {
    const value = record[rule.name];
    const missing = value === undefined || value === null || value === "";
    if (rule.required && missing) {
      issues.push({
        level: "error",
        code: "missing-field",
        message: `kind "${type}" requires field "${rule.name}"`,
        path: note.path,
      });
      continue;
    }
    if (!missing && rule.enum && typeof value === "string" && !rule.enum.includes(value)) {
      issues.push({
        level: "error",
        code: "bad-enum",
        message: `field "${rule.name}" must be one of: ${rule.enum.join(", ")}`,
        path: note.path,
      });
    }
  }
  return issues;
}
