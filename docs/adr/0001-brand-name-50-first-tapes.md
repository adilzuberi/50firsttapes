# 1. Brand name: 50 First Tapes

Status: Accepted — 2026-06-19

## Context

The project needed a brand. The working title, "Knowledge OS", turned out to be unusable: `KNOWLEDGEOS` is a live US trademark (Comake, Inc., Reg. 6803083, classes 9 & 42, the same lane), the phrase is generic-descriptive, and the `<X> OS` pattern is saturated.

An extensive, adversarially-verified vetting pass (existing products, trademark, domains, npm/PyPI, GitHub) showed the AI/knowledge naming space is exhausted. The decisive failure mode is a **same-space twin** — another AI/software project of the same name — which a free domain does not cure:

- `Glinthawk` → `microsoft/glinthawk`, an actively-maintained open-source LLM inference engine.
- `glintbook` / `glinthook` → the live "Glint" brand cluster (Microsoft/LinkedIn Viva Glint trademark; `glintbrain.xyz`).
- `thinkvault` → a live AI-memory competitor at `thinkvault.ai` + a registered company.
- Most Horizon machine names (Watcher, Stormbird, Burrower…) → exact same-space AI twins.

Clean coined words existed (Stoneloom, Lancehorn) but were either disliked or thematically weak.

"50 First Tapes" is Adil's own coinage for the LLM-memory concept — a *50 First Dates* metaphor: the AI is Lucy, Adil is Henry, and the notes are the tapes that restore memory each session. It is precisely the product's thesis (compile knowledge once, replay it to restore an agent's context). It vetted **clean**: no same-space twin; `.com`, npm, PyPI, and GitHub free across spellings; film-association trademark risk low (different class) but non-zero.

## Decision

Adopt **50 First Tapes** as the whole brand — engine, repo, packages, and CLI — not a tagline or a layer.

- Canonical spelling: **`50firsttapes`** (digit form — matches the written brand and the pun).
- Register **`fiftyfirsttapes`** defensively and 301-redirect to the digit form.
- Do **not** use `51sttapes` as canonical (fails the say-it-aloud test); optional throwaway alias only.
- GitHub org `50firsttapes`; npm scope `@50firsttapes`; CLI command `tapes` (the product's own lore word — `tapes lint`, `tapes add`).
- "Knowledge OS" is retired entirely. The plain-English descriptor is "a local-first knowledge engine for AI agents".

## Consequences

- One brand with meaning; no second engine name to coin or maintain. The CLI verb-word `tapes` carries the lore.
- Accepted frictions: digit-vs-word dictation (mitigated by the defensive word-spelled domain), length, and the *50 First Dates* acoustic pun.
- IP hygiene: never use Sony's *50 First Dates* logo, art, fonts, stills, or characters; treat any branded consumer merch as higher-risk than the software; run a formal USPTO/UKIPO clearance before any trademark filing. All "appears-free" domain reads must be registrar-confirmed before announcing.
- Alternatives rejected: Stoneloom (clean, disliked), Lancehorn (clean, weak theme), knutbox (weak brand), the `glint-*` family (Glint brand cluster), ThinkVault (live twin), Knowledge OS (trademarked + generic).
