import { createHash } from "node:crypto";

/** A short, stable content hash — the key for incremental reindexing. */
export function contentHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}
