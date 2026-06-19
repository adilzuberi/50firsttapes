import { createHash } from "node:crypto";

/** Compute a stable anchor for a span of text: a short content hash. */
export function anchor(span: string): string {
  const norm = span.replace(/\r\n/g, "\n").trim();
  return createHash("sha256").update(norm).digest("hex").slice(0, 12);
}

export interface AnchoredPatch {
  /** The anchor of the span this patch expects to replace. */
  anchor: string;
  /** The replacement text. */
  replacement: string;
}

export interface PatchResult {
  ok: boolean;
  body: string;
  reason?: string;
}

/**
 * Apply an anchored patch to a document by paragraph spans.
 *
 * Optimistic concurrency: if no span matches the anchor, the patch is
 * rejected rather than applied blindly — the caller flags a conflict
 * instead of clobbering changed content.
 */
export function applyPatch(body: string, patch: AnchoredPatch): PatchResult {
  const spans = body.split(/\n{2,}/);
  const idx = spans.findIndex((s) => anchor(s) === patch.anchor);
  if (idx === -1) {
    return { ok: false, body, reason: "anchor not found — content moved; flag a conflict" };
  }
  spans[idx] = patch.replacement;
  return { ok: true, body: spans.join("\n\n") };
}
