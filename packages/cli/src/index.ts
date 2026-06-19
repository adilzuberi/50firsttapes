#!/usr/bin/env node
import { Command } from "commander";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { lintNotes } from "@50firsttapes/core";

const SKIP = /^(node_modules|\.git|private-no-ai|private|no-ai|secrets)$/;

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP.test(entry.name)) continue;
      out.push(...(await walk(p)));
    } else if (entry.name.endsWith(".md")) {
      out.push(p);
    }
  }
  return out;
}

const program = new Command();
program
  .name("tapes")
  .description("50 First Tapes - the agent protocol over your vault")
  .version("0.0.0");

program
  .command("lint")
  .description("validate notes against their kind schemas and report drift")
  .argument("[bundle]", "path to the bundle root", ".")
  .option("--kinds <dir>", "path to the kind schemas", "spec/kinds")
  .action(async (bundle: string, opts: { kinds: string }) => {
    const root = resolve(bundle);
    const paths = await walk(root);
    const result = await lintNotes(paths, resolve(opts.kinds), root);
    for (const i of result.issues) {
      const mark = i.level === "error" ? "x" : "!";
      console.log(`${mark} [${i.code}] ${i.path ?? ""} - ${i.message}`);
    }
    console.log(`\nchecked ${result.checked} notes - ${result.ok ? "ok" : "errors found"}`);
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
