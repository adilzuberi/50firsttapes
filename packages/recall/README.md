# @50firsttapes/recall

The progressive-retrieval spine — one `recall` over the markdown substrate, layered cheapest-first and returned with provenance. This package is the foundation slice: a derived, incremental index plus the no-model retrieval layers, with semantic, memory, and AI layers plugging in behind the same interface.

## What this slice ships

- **A derived index** under `.tapes/recall/index.json` — gitignored machinery, rebuilt from the notes, safe to delete. Files stay the truth.
- **Incremental refresh** (`reindex`) — re-derives only notes whose content hash changed, and prunes rows whose note has gone. This is what keeps a moving vault current without a full rebuild.
- **Two no-model retrievers** behind one `Retriever` interface: `structure` (frontmatter, tags, links, title) and `lexical` (BM25 over the token bags). Both run today with no embeddings.
- **Reciprocal-rank fusion** (`rrf`) — blends the layer rankings deterministically, no database.
- **`recall()`** — loads + incrementally indexes the bundle, runs the available retrievers, fuses, and returns ranked hits with provenance.

## Not yet (next slices, behind the same interface)

- Semantic layer (embeddings), memory layer (file-native default, MemPalace optional), and an AI judge layer.
- A persisted SQLite/vector store for the semantic layer (this slice persists as JSON).
- The CLI/MCP `recall` verb wiring and the per-layer token budget / stop rule.

```ts
import { recall } from "@50firsttapes/recall";
const result = await recall("/path/to/bundle", { text: "vector search decision", k: 8 });
// result.hits: [{ id, title, score, layer, why }], result.layers: ["structure","lexical"]
```
