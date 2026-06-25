import { loadNote, walkBundle, type Note } from "@50firsttapes/core";
import type { Layer, RecallQuery, RecallResult, Retriever } from "./types.js";
import { loadIndex, reindex, saveIndex, type RecallIndex, type ReindexReport } from "./store.js";
import { structureRetriever } from "./retrievers/structure.js";
import { lexicalRetriever } from "./retrievers/lexical.js";
import { rrf } from "./fuse.js";

/**
 * Load every note and incrementally refresh the derived index — re-deriving only
 * changed notes and pruning gone ones — then persist it under `.tapes/`.
 */
export async function buildIndex(
  bundleRoot: string,
): Promise<{ index: RecallIndex; notes: Note[]; report: ReindexReport }> {
  const { noteFiles } = await walkBundle(bundleRoot);
  const notes = await Promise.all(noteFiles.map((p) => loadNote(p, bundleRoot)));
  const index = await loadIndex(bundleRoot);
  const report = reindex(index, notes);
  await saveIndex(bundleRoot, index);
  return { index, notes, report };
}

export interface RecallOptions {
  /** Override the retriever set — e.g. add a semantic or memory backend. */
  retrievers?: Retriever[];
  /** Results to return after fusion. Default 10. */
  k?: number;
}

/**
 * Build the best context for a need: refresh the index, run the available
 * retrievers cheapest-first, fuse their rankings, and return ranked hits with
 * provenance. The no-model layers (structure, lexical) run today; semantic,
 * memory, and ai plug in behind the same `Retriever` interface.
 */
export async function recall(
  bundleRoot: string,
  query: RecallQuery,
  opts: RecallOptions = {},
): Promise<RecallResult> {
  const { index } = await buildIndex(bundleRoot);
  const retrievers = opts.retrievers ?? [structureRetriever(index), lexicalRetriever(index)];
  const k = query.k ?? opts.k ?? 10;

  const ran: Layer[] = [];
  const lists: Awaited<ReturnType<Retriever["search"]>>[] = [];
  for (const r of retrievers) {
    if (!(await r.available())) continue;
    ran.push(r.layer);
    lists.push(await r.search(query, k * 2));
  }
  return { hits: rrf(lists).slice(0, k), layers: ran };
}
