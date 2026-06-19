# Knowledge OS — substrate spec

Status: draft, v0.1.

A Knowledge OS bundle is a folder of UTF-8 markdown files with YAML frontmatter, versioned in git. It is a valid [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) (OKF) bundle, with a typed schema system layered on top.

## File

Each note is one markdown file: YAML frontmatter, then a markdown body.

```markdown
---
type: note
title: Hello
summary: The smallest valid note.
status: stated
date: 2026-06-19
---

# Hello

Body in markdown.
```

## Identity and links

- **Concept id** = the file's path within the bundle, with `.md` removed (OKF). `notes/hello.md` → `notes/hello`.
- **Links** are path-based markdown links: `[hello](/notes/hello.md)`. This is the portable canonical form. Editor-specific link syntax (e.g. Obsidian wikilinks) is a view concern, generated from these.

## Frontmatter

- `type` (**required**) — the kind. Drives validation, routing, and presentation. Consumers MUST tolerate an unknown type, but a linter flags it for curation (OKF rule).
- OKF-recommended: `title`, `description`/`summary`, `resource`, `tags`, `timestamp`/`date`.
- **Extension keys** (allowed by OKF; used by Knowledge OS for trust and lifecycle): `source`, `confidence`, `status`, `replaced_by`, `origin`, `time`.

## Kinds — the schema system

A **kind** is an OKF `type` plus a validated frontmatter schema. Kinds are declared in `spec/kinds/*.yml`. The first set: `note`, `decision`, `source`, `infra`, `person`, `log`, `project`. Verticals add their own (e.g. `course`, `lesson`, `learner`) without changing the engine.

## Reserved files

- `index.md` — bundle navigation; may carry `okf_version` in its frontmatter.
- `log.md` / `Log/` — append-only change history.

## Validation and lint

`kos lint` checks every file against its kind's schema and reports structural drift (missing `type`, unknown kinds, missing required fields, bad enums). Structural-health checks (orphans, broken or stale links, committed-blob guard, hot-core budget) are added as the engine grows.

## Editing

Writes are surgical: a note is patched by addressing a span via its content hash (an anchor) and emitting only the anchor plus the new text — token-cheap and concurrency-safe (a patch is rejected if the anchored content has moved). Whole-file rewrites are avoided.

## Lineage

This format follows the LLM-wiki pattern (Karpathy, 2026) and is compatible with Google's OKF. Knowledge OS adds what those leave out: a typed schema system, provenance and supersession, governance, and an agent protocol.
