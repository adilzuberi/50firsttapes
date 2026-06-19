import { parse as parseYaml } from "yaml";
import type { Frontmatter } from "./types.js";

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface Parsed {
  frontmatter: Frontmatter;
  body: string;
}

/** Split a markdown document into its YAML frontmatter and body. */
export function parseDocument(raw: string): Parsed {
  const m = FM.exec(raw);
  if (!m) return { frontmatter: {}, body: raw };
  const fm = (parseYaml(m[1]) ?? {}) as Frontmatter;
  return { frontmatter: fm, body: raw.slice(m[0].length) };
}
