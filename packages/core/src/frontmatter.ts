import { parse as parseYaml } from "yaml";
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
    const parsed = parseYaml(m[1]);
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
