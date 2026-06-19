# 50 First Tapes — substrate spec

Status: draft, v0.1.

A 50 First Tapes bundle is a folder of UTF-8 markdown files with YAML frontmatter, versioned in git. It is a valid [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) (OKF) bundle, with a typed schema system layered on top.

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
- **Extension keys** (allowed by OKF; used by 50 First Tapes for trust and lifecycle): `source`, `confidence`, `status`, `replaced_by`, `origin`, `time`.

## Kinds — the schema system

A **kind** is an OKF `type` plus a validated frontmatter schema. Kinds are declared in `spec/kinds/*.yml`. The first set: `note`, `decision`, `source`, `infra`, `person`, `log`, `project`. Verticals add their own (e.g. `course`, `lesson`, `learner`) without changing the engine.

## Reserved files

- `index.md` — bundle navigation; may carry `okf_version` in its frontmatter.
- `log.md` / `Log/` — append-only change history.

## Validation and lint

`tapes lint` runs two passes over a bundle:

- **Schema** — every note against its kind: missing `type`, unknown kinds, missing required fields, bad enums. The kind is read from `type:` or, failing that, a `type/<kind>` tag.
- **Structural health** —
  - `broken-link` (error): a path link `[x](/a.md)` or wikilink `[[a]]` that resolves to no note.
  - `stale-link` (warn): a link to a note that is `superseded`/`archived`/etc. or carries `replaced_by`.
  - `orphan` (warn): a note nothing links to (reserved `index`/`log`/`readme` excluded). Skip with `--no-orphans`.
  - `committed-blob` / `large-blob` (warn): a derived-index artefact or oversized file committed into the substrate.
  - `hot-core-budget` (warn): the always-loaded set (`index`, plus notes flagged `hot: true` or tagged `hot`/`core`) over its token budget.

Any error fails the run (exit 1); warnings do not. `--no-structure` runs the schema pass alone.

## Query

`tapes query` is the find verb. Filters AND together:

- free text — every term must appear in a note's title, body, or id; title hits rank highest, newest wins ties.
- `--kind` / `--tag` / `--status` — by resolved kind, by tag (exact or a `prefix/` of a deeper tag), or by lifecycle status.
- `--links-to <id>` — backlinks: notes that link to a concept id, over path links and wikilinks alike.

`--json` emits machine-readable hits; `--limit` caps results. Query reads the files on demand — no committed index.

## Ingest

`tapes ingest [source]` brings raw material (a file, or stdin) into the bundle as a governed, kind-scaffolded note. It derives a title (from `--title`, the first heading, else `untitled`), files it at `--id` (default `inbox/<slug>`), and scaffolds frontmatter — `type`, `title`, `date`, `source`, plus any `--summary`/`--status`/`--tag`.

Intake is raw, curation comes after: the governance gates **block** (an off-limits path or a credential-like string is refused, nothing written), while schema gaps (missing required fields) are **reported, not blocked**. `--dry-run` assembles and checks without writing.

## Protocol — MCP

`@50firsttapes/mcp` (`tapes-mcp`) is a stdio MCP server exposing the verbs to any client (Claude Code, claude.ai, Codex). It supersedes the read-only wiki-mcp. Configure with `TAPES_BUNDLE` (bundle root) and `TAPES_KINDS`.

- **Read:** `query`, `read`, `list`, `lint`.
- **Write (gated):** `write` and `patch` run every change through the governance gates — an off-limits path (`private`/`secrets`) or a credential-like string is refused and nothing is written. `patch` is hash-anchored: it replaces a paragraph by its content hash and is rejected if that content has moved, so concurrent edits never clobber.
- **Govern:** `govern` dry-runs the gates on a proposed note without writing it.

## Editing

Writes are surgical: a note is patched by addressing a span via its content hash (an anchor) and emitting only the anchor plus the new text — token-cheap and concurrency-safe (a patch is rejected if the anchored content has moved). Whole-file rewrites are avoided.

## Lineage

This format follows the LLM-wiki pattern (Karpathy, 2026) and is compatible with Google's OKF. 50 First Tapes adds what those leave out: a typed schema system, provenance and supersession, governance, and an agent protocol.
