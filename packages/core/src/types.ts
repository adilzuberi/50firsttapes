// Core domain types for the Knowledge OS substrate and protocol.

/** A note's parsed frontmatter: arbitrary keys, OKF-compatible. */
export type Frontmatter = Record<string, unknown> & {
  /** OKF: the kind discriminator. Required on every note. */
  type?: string;
};

/** A parsed note: identity, frontmatter, and markdown body. */
export interface Note {
  /** Concept id = path within the bundle, without the .md suffix (OKF). */
  id: string;
  path: string;
  frontmatter: Frontmatter;
  body: string;
}

/** A field rule within a Kind schema. */
export interface FieldRule {
  name: string;
  required?: boolean;
  /** Allowed values, if the field is an enum. */
  enum?: string[];
  /** Loose shape hint for v1. */
  type?: "string" | "number" | "boolean" | "date" | "list" | "map";
}

/** A typed Kind: an OKF `type` plus a validated frontmatter schema. */
export interface Kind {
  /** Matches a note's frontmatter `type` and its tag `type/<name>`. */
  name: string;
  description?: string;
  fields: FieldRule[];
}

/** A validation or lint finding. */
export interface Issue {
  level: "error" | "warn";
  code: string;
  message: string;
  path?: string;
}

/** The outcome of a validation or lint pass. */
export interface LintResult {
  ok: boolean;
  issues: Issue[];
  checked: number;
}

/** The protocol verbs every consumer (CLI, MCP, library) shares. */
export type Verb = "ingest" | "query" | "lint" | "write" | "govern";
