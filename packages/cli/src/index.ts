#!/usr/bin/env node
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { ingestBundle, lintBundle, queryBundle, type Issue } from "@50firsttapes/core";

const program = new Command();
program
  .name("tapes")
  .description("50 First Tapes - the agent protocol over your vault")
  .version("0.0.0");

interface LintOpts {
  kinds: string;
  structure: boolean;
  orphans: boolean;
  hotCoreBudget: string;
  maxBlob: string;
}

program
  .command("lint")
  .description("validate notes against their kinds and check structural health")
  .argument("[bundle]", "path to the bundle root", ".")
  .option("--kinds <dir>", "path to the kind schemas", "spec/kinds")
  .option("--no-structure", "schema checks only — skip links, orphans, hot-core, blobs")
  .option("--no-orphans", "skip the orphan check (noisy on large vaults)")
  .option("--hot-core-budget <tokens>", "token budget for the always-loaded hot core", "8000")
  .option("--max-blob <bytes>", "size over which a committed file is flagged", String(1024 * 1024))
  .action(async (bundle: string, opts: LintOpts) => {
    const root = resolve(bundle);
    const result = await lintBundle(root, resolve(opts.kinds), {
      structure: opts.structure,
      orphans: opts.orphans,
      hotCoreTokenBudget: Number(opts.hotCoreBudget),
      maxBlobBytes: Number(opts.maxBlob),
    });

    const order = (i: Issue) => (i.level === "error" ? 0 : 1);
    const sorted = [...result.issues].sort(
      (a, b) => order(a) - order(b) || (a.path ?? "").localeCompare(b.path ?? ""),
    );
    for (const i of sorted) {
      const mark = i.level === "error" ? "x" : "!";
      const where = i.path ? relative(root, i.path) : "(bundle)";
      console.log(`${mark} [${i.code}] ${where} - ${i.message}`);
    }

    const errors = result.issues.filter((i) => i.level === "error").length;
    const warns = result.issues.length - errors;
    const tally = new Map<string, number>();
    for (const i of result.issues) tally.set(i.code, (tally.get(i.code) ?? 0) + 1);

    console.log(
      `\nchecked ${result.checked} notes, ${result.blobsChecked ?? 0} other files`,
    );
    if (result.issues.length) {
      const breakdown = [...tally.entries()].map(([c, n]) => `${c}=${n}`).join(" ");
      console.log(`${errors} error(s), ${warns} warning(s) · ${breakdown}`);
    }
    console.log(result.ok ? "ok" : "errors found");
    if (!result.ok) process.exitCode = 1;
  });

interface QueryOpts {
  bundle: string;
  kinds: string;
  kind?: string;
  tag?: string;
  status?: string;
  linksTo?: string;
  limit: string;
  json?: boolean;
}

program
  .command("query")
  .description("find notes by text, kind, tag, status, or backlinks")
  .argument("[text...]", "free-text terms (all must match)")
  .option("--bundle <path>", "path to the bundle root", ".")
  .option("--kinds <dir>", "path to the kind schemas", "spec/kinds")
  .option("--kind <kind>", "only notes of this kind")
  .option("--tag <tag>", "only notes with this tag (or a deeper tag under it)")
  .option("--status <status>", "only notes with this status")
  .option("--links-to <id>", "only notes that link to this concept id (backlinks)")
  .option("--limit <n>", "max results", "20")
  .option("--json", "machine-readable output")
  .action(async (text: string[], opts: QueryOpts) => {
    const root = resolve(opts.bundle);
    const hits = await queryBundle(
      root,
      resolve(opts.kinds),
      {
        text: text.join(" ") || undefined,
        kind: opts.kind,
        tag: opts.tag,
        status: opts.status,
        linksTo: opts.linksTo,
      },
      { limit: Number(opts.limit) },
    );

    if (opts.json) {
      console.log(JSON.stringify(hits, null, 2));
      return;
    }
    for (const h of hits) {
      console.log(`${h.id}${h.title ? ` — ${h.title}` : ""}${h.kind ? `  [${h.kind}]` : ""}`);
      if (h.snippet) console.log(`    ${h.snippet}`);
    }
    console.log(`\n${hits.length} result(s)`);
  });

interface IngestOpts {
  bundle: string;
  kinds: string;
  kind: string;
  title?: string;
  id?: string;
  summary?: string;
  status?: string;
  source?: string;
  tag?: string[];
  dryRun?: boolean;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

program
  .command("ingest")
  .description("bring new material into the bundle as a governed, kind-scaffolded note")
  .argument("[source]", "source file to ingest; omit to read stdin")
  .option("--bundle <path>", "path to the bundle root", ".")
  .option("--kinds <dir>", "path to the kind schemas", "spec/kinds")
  .option("--kind <kind>", "note kind", "note")
  .option("--title <title>", "title (default: first heading or 'untitled')")
  .option("--id <id>", "concept id / path (default: inbox/<slug>)")
  .option("--summary <text>", "summary frontmatter")
  .option("--status <status>", "status frontmatter")
  .option("--source <text>", "provenance (default: the source filename)")
  .option("--tag <tag...>", "tag(s) to add")
  .option("--dry-run", "assemble and check, but do not write")
  .action(async (source: string | undefined, opts: IngestOpts) => {
    const root = resolve(opts.bundle);
    const content = source ? await readFile(resolve(source), "utf8") : await readStdin();
    const res = await ingestBundle(
      root,
      resolve(opts.kinds),
      {
        content,
        kind: opts.kind,
        title: opts.title,
        id: opts.id,
        summary: opts.summary,
        status: opts.status,
        source: opts.source ?? (source ? basename(source) : "stdin"),
        tags: opts.tag,
      },
      { dryRun: opts.dryRun },
    );

    if (opts.dryRun) {
      console.log(res.content);
      console.log("--- checks ---");
    }
    for (const i of res.gateIssues) console.log(`x [${i.code}] ${i.message}`);
    if (res.gateIssues.some((i) => i.level === "error")) {
      console.log(`\nrefused — ${res.id} not written (governance gate)`);
      process.exitCode = 1;
      return;
    }

    if (res.written) console.log(`ingested → ${relative(root, res.path)}`);
    else if (opts.dryRun) console.log(`(dry-run) would write → ${res.id}.md`);

    const gaps = res.schemaIssues.filter((i) => i.code !== "unknown-kind");
    if (gaps.length) {
      console.log("still needs (per kind schema):");
      for (const i of gaps) console.log(`  ! [${i.code}] ${i.message}`);
    }
  });

for (const verb of ["write", "govern"] as const) {
  program
    .command(verb)
    .description(`${verb} - not yet implemented (v1 stub)`)
    .action(() => {
      console.log(`tapes ${verb}: stub - see the 50 First Tapes v1 plan.`);
    });
}

await program.parseAsync(process.argv);
