# 50 First Tapes

An open, local-first knowledge engine. Your notes are plain markdown and git — the tapes; your AI reads and writes them behind governance gates. No lock-in: `git clone` and walk away.

> Apache-2.0 · OKF-compatible · TypeScript. The v1 protocol verbs work today. This repo is the engine and carries no personal data.

## Why

Knowledge that outlives any one tool or chat, that an AI agent can read and write *safely*, and that you can build products on — a personal vault, a team wiki, an agentic LMS. The field converged on this pattern in 2026 (Karpathy's LLM wiki, Google's Open Knowledge Format). 50 First Tapes adds the hard parts those leave out: trust, governance, multi-agent writes, and a typed schema system.

## The layers

```
Products & views    — your vault · a team wiki · an agentic LMS
Agents & governance — crew + rules as data; gates; audit; the loop runner
Protocol            — ingest · query · lint · write · govern   (MCP · CLI · library)
Derived index       — full-text + vector + graph; rebuilt on demand; never committed
Substrate           — markdown + YAML + git; OKF-compatible; the durable floor
```

## The verbs

One protocol, three shapes — a CLI (`tapes`), an MCP server, and a library. The five verbs:

| Verb | What it does |
|---|---|
| `ingest` | Bring raw material in as a governed, kind-scaffolded note. Gates block; schema gaps are reported, not blocked. |
| `query` | Find notes by free text (title-weighted), kind, tag, status, or backlinks. Reads on demand — no committed index. |
| `lint` | Validate every note against its kind, and check structural health: broken/stale links, orphans, committed blobs, hot-core budget. |
| `write` | Write exact content to a note id, through the governance gates. |
| `govern` | Dry-run the gates on proposed content without writing. |

```bash
tapes lint                                  # validate the bundle in the current dir
tapes query "vector search" --kind note     # find notes
tapes ingest article.md --kind source       # file new material under inbox/
tapes govern wiki/draft draft.md            # would this write be accepted?
```

**Governance.** Writes pass gates before they land: an off-limits path (`private`, `secrets`) or a credential-like string is refused and nothing is written. Edits are hash-anchored — `patch` replaces a paragraph by its content hash and is rejected if that content has moved, so concurrent edits never clobber.

## Packages

- `@50firsttapes/core` — schema system, validator, structural-health checks, query, ingest, governance gates, hash-anchored edits, OKF read/write.
- `@50firsttapes/cli` — the `tapes` command: `ingest · query · lint · write · govern`.
- `@50firsttapes/mcp` — a stdio or HTTP MCP server exposing the verbs to any client (Claude Code, Codex, claude.ai). The native tools — read (`query`/`read`/`list`/`lint`) and gated write (`write`/`patch`/`govern`) — plus wiki-mcp-compatible tools (`session_bootstrap`, `search`, `read_note`, `list_folder`, `get_recent_logs`) so it can stand in for the read-only wiki-mcp gateway.
- `@50firsttapes/remote` — a git-remote adapter (Forgejo · GitHub · bare). 50 First Tapes depends on git, never on a forge.

## Quickstart

```bash
pnpm install
pnpm build
node packages/cli/dist/index.js lint examples/sample-bundle
node packages/cli/dist/index.js query --kind note --bundle examples/sample-bundle
```

Run the MCP server over a bundle. Stdio is the default (local clients like Claude Code):

```bash
TAPES_BUNDLE=/path/to/bundle node packages/mcp/dist/index.js
```

For hosted use, serve over HTTP with Bearer auth (discovery is open; tool calls require a token):

```bash
TAPES_HTTP_PORT=8080 TAPES_MCP_TOKEN=sk-… TAPES_BUNDLE=/path/to/bundle node packages/mcp/dist/index.js
```

## Source of truth

Forgejo is the canonical remote; GitHub is a one-way push mirror. Contribute via Issues and PRs on GitHub — see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Licence

[Apache-2.0](./LICENSE).
