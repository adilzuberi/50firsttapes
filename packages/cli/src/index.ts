#!/usr/bin/env node
import { Command } from "commander";
import { relative, resolve } from "node:path";
import { lintBundle, type Issue } from "@50firsttapes/core";

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

for (const verb of ["ingest", "query", "write", "govern"] as const) {
  program
    .command(verb)
    .description(`${verb} - not yet implemented (v1 stub)`)
    .action(() => {
      console.log(`tapes ${verb}: stub - see the 50 First Tapes v1 plan.`);
    });
}

await program.parseAsync(process.argv);
