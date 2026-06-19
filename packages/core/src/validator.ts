import type { Issue, Kind, Note } from "./types.js";

/** Check one note's frontmatter against its declared kind. */
export function validateNote(note: Note, kinds: Map<string, Kind>): Issue[] {
  const issues: Issue[] = [];
  const fm = note.frontmatter;
  const type = typeof fm.type === "string" ? fm.type : undefined;

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
