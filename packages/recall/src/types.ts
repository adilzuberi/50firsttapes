// Core types for the recall spine: the retriever interface every backend plugs
// into, the query, and the fused result with provenance.

/** The retrieval layers, cheapest-first. Each is optional and degrades gracefully. */
export type Layer = "structure" | "lexical" | "semantic" | "memory" | "ai";

/** A need handed to recall: the query text plus optional structure prefilters. */
export interface RecallQuery {
  text: string;
  /** Restrict to a kind (frontmatter `type`). */
  kind?: string;
  /** Restrict to a tag (exact, or a `prefix/` of a deeper tag). */
  tag?: string;
  /** How many results to return after fusion. Default 10. */
  k?: number;
}

/** One retrieved note, with provenance — which layer found it and why. */
export interface Hit {
  id: string;
  title?: string;
  score: number;
  layer: Layer;
  /** A short audit reason (matched tag, title hit, fused layers). */
  why?: string;
}

/** The fused, ranked context recall returns. */
export interface RecallResult {
  hits: Hit[];
  /** Which layers actually ran (absent backends are skipped, not errors). */
  layers: Layer[];
}

/**
 * A retriever over the substrate. Structure and lexical ship today; semantic,
 * memory, and ai plug in behind this same shape. `available()` is the
 * graceful-degradation gate — a missing backend is skipped, never fatal.
 */
export interface Retriever {
  readonly layer: Layer;
  available(): boolean | Promise<boolean>;
  search(query: RecallQuery, limit: number): Promise<Hit[]>;
}
