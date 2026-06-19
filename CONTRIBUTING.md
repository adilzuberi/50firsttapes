# Contributing

Thanks for helping build 50 First Tapes.

## Where the code lives

The canonical repository is on **Forgejo**. **GitHub is a one-way push mirror** — Forgejo force-pushes to it, so commits made directly on GitHub are overwritten.

That does not block contribution:

1. Open **Issues** and **Pull Requests on GitHub** as normal.
2. A maintainer pulls an accepted PR's ref into Forgejo, reviews, and merges there.
3. The mirror re-publishes the merge back to GitHub.

So GitHub is the front door; Forgejo is the source of truth.

## Licence and sign-off

By contributing you agree your work is licensed under [Apache-2.0](./LICENSE). Please sign off your commits (`git commit -s`) to certify the Developer Certificate of Origin.

## Dev setup

```bash
pnpm install
pnpm build      # tsc across all packages
pnpm lint       # type-check
pnpm test       # node --test
node packages/cli/dist/index.js lint examples/sample-bundle
```

## Boundaries

- This repo is the engine. It carries **no personal data** — never commit notes from a private vault.
- New note kinds go in `spec/kinds/*.yml` with a matching example in `examples/`.
- Anything that touches knowledge, governance, the loop, or the event model is built here. Borrow a library only if it is permissively licensed, does one thing, and saves real plumbing. Never vendor a whole platform.
