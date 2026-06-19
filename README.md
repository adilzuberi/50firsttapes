# 50 First Tapes

An OKF-compatible, local-first agentic knowledge engine. Plain markdown and git at the floor; a derived index, an agent protocol, and a governance layer on top. Your knowledge stays portable — `git clone` and walk away.

> Apache-2.0. Early scaffold — the design lives in the private project notes; this repo is the engine, and carries no personal data.

## Why

Knowledge that outlives any one tool or chat, that any AI agent can read and write safely, and that you can build products on — a personal vault, a team wiki, an agentic LMS. The field converged on this pattern in 2026 (Karpathy's LLM wiki, Google's Open Knowledge Format). 50 First Tapes adds the hard parts those leave out: trust, governance, multi-agent writes, and a typed schema system.

## The layers

```
Products & views    — your vault · a team wiki · an agentic LMS
Agents & governance — crew + rules as data; gates; audit; the loop runner
Protocol            — ingest · query · lint · write · govern   (MCP · CLI · library)
Derived index       — full-text + vector + graph; rebuilt on demand; never committed
Substrate           — markdown + YAML + git; OKF-compatible; the durable floor
```

## Packages

- `@50firsttapes/core` — the schema system, validator, governance gates, OKF read/write, and hash-anchored edits.
- `@50firsttapes/cli` — the `tapes` command: `ingest · query · lint · write · govern`.
- `@50firsttapes/mcp` — the MCP server, so any agent (Claude Code, Codex, omp, claude.ai) can use a bundle.
- `@50firsttapes/remote` — a git-remote adapter (Forgejo · GitHub · bare). 50 First Tapes depends on git, never on a forge.

## Quickstart

```bash
pnpm install
pnpm build
node packages/cli/dist/index.js lint examples/sample-bundle
```

## Source of truth

Forgejo is the canonical remote; GitHub is a one-way push mirror. Contribute via Issues and PRs on GitHub — see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Licence

[Apache-2.0](./LICENSE).
