// 50 First Tapes - git remote adapter.
//
// 50 First Tapes depends on git, not on any forge. A "remote" is a swappable
// provider: Forgejo, GitHub, a bare server, or a local path. This module owns
// remote config and the push-mirror setup. v1 shells out to git.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Remote {
  name: string;
  url: string;
}

/** List the configured git remotes for a repo. */
export async function listRemotes(repo: string): Promise<Remote[]> {
  const { stdout } = await run("git", ["-C", repo, "remote", "-v"]);
  const seen = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    const m = /^(\S+)\s+(\S+)\s+\(fetch\)/.exec(line);
    if (m) seen.set(m[1], m[2]);
  }
  return [...seen].map(([name, url]) => ({ name, url }));
}

// TODO(v1): configure a push mirror - Forgejo is the source of truth; GitHub
// is a one-way downstream mirror. The op-log relay (v2) rides on top of git.
