import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Kind } from "./types.js";

/** Load all Kind schemas from a directory of YAML files. */
export async function loadKinds(dir: string): Promise<Map<string, Kind>> {
  const kinds = new Map<string, Kind>();
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return kinds;
  }
  for (const file of entries) {
    if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
    const raw = await readFile(join(dir, file), "utf8");
    const kind = parseYaml(raw) as Kind;
    if (kind?.name) kinds.set(kind.name, kind);
  }
  return kinds;
}
