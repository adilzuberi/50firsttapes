// Knowledge OS - MCP server (stub).
//
// Exposes the protocol verbs to any MCP client (Claude Code, Codex, omp,
// claude.ai). Supersedes wiki-mcp.
//
// TODO(v1): add @modelcontextprotocol/sdk, wire a stdio server, port
// wiki-mcp's session_bootstrap + read tools, then add write/govern behind
// the governance gates from @knowledge-os/core.
import { lintNotes } from "@knowledge-os/core";

export async function start(): Promise<void> {
  console.log("knowledge-os mcp: stub - SDK wiring is a v1 task. See spec/SPEC.md.");
  // The core protocol is already callable; the MCP transport is what's pending.
  void lintNotes;
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  void start();
}
