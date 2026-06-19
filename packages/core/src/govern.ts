import type { Issue } from "./types.js";

/** Input handed to a governance gate before a write is accepted. */
export interface GateInput {
  path: string;
  body: string;
  frontmatter: Record<string, unknown>;
}

/** A governance gate runs before a write is accepted. */
export interface Gate {
  name: string;
  /** Return issues; any error-level issue blocks the write. */
  check(input: GateInput): Issue[];
}

/** Block writes to off-limits paths. */
export const offLimitsGate: Gate = {
  name: "off-limits",
  check({ path }) {
    const blocked = /(^|\/)(private-no-ai|private|no-ai|secrets)(\/|$)/;
    return blocked.test(path)
      ? [{ level: "error", code: "off-limits", message: `path is off-limits: ${path}`, path }]
      : [];
  },
};

/** Refuse to persist obvious credentials. Coarse v1 scan. */
export const secretScanGate: Gate = {
  name: "secret-scan",
  check({ path, body }) {
    const patterns = [
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /\bsk-[A-Za-z0-9]{20,}\b/,
      /\bAKIA[0-9A-Z]{16}\b/,
    ];
    return patterns.some((p) => p.test(body))
      ? [{ level: "error", code: "secret", message: "a credential-like string was found; redact before writing", path }]
      : [];
  },
};

/** Run a set of gates. The write is allowed only when no error is returned. */
export function runGates(gates: Gate[], input: GateInput): Issue[] {
  return gates.flatMap((g) => g.check(input));
}

/** The gates every write passes by default. */
export const defaultGates: Gate[] = [offLimitsGate, secretScanGate];
