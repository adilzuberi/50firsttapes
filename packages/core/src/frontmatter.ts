import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Frontmatter } from "./types.js";

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface Parsed {
  frontmatter: Frontmatter;
  body: string;
  /** Set when the frontmatter block was present but not valid YAML. */
  error?: string;
}

/** Split a markdown document into its YAML frontmatter and body. Never throws on bad YAML. */
export function parseDocument(raw: string): Parsed {
  const m = FM.exec(raw);
  if (!m) return { frontmatter: {}, body: raw };
  const body = raw.slice(m[0].length);
  try {
    // logLevel "error": don't chatter to stderr on odd-but-parseable frontmatter
    // (e.g. a template note with a mapping as a key); real errors still throw.
    const parsed = parseYaml(m[1], { logLevel: "error" });
    const fm =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Frontmatter)
        : {};
    return { frontmatter: fm, body };
  } catch (e) {
    const error = e instanceof Error ? e.message.split("\n")[0] : String(e);
    return { frontmatter: {}, body, error };
  }
}

/** Serialise frontmatter + body into a note. YAML emission handles quoting/escaping. */
export function serializeNote(frontmatter: Frontmatter, body: string): string {
  const fm = stringifyYaml(frontmatter, { lineWidth: 0 });
  const trimmed = body.replace(/^\n+/, "").replace(/\s+$/, "");
  return `---\n${fm}---\n\n${trimmed}\n`;
}
