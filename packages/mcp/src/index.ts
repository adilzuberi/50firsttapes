#!/usr/bin/env node
// 50 First Tapes — MCP server. Exposes the protocol verbs (query/read/list/lint
// read; write/patch/govern write) to any MCP client over stdio. Supersedes the
// read-only wiki-mcp. Configure with TAPES_BUNDLE (vault root) and TAPES_KINDS.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { join, resolve } from "node:path";
import { createHandlers, SERVER_INSTRUCTIONS, TOOL_DEFS } from "./handlers.js";

export async function start(): Promise<void> {
  const bundle = resolve(process.env.TAPES_BUNDLE ?? process.cwd());
  const kinds = resolve(process.env.TAPES_KINDS ?? join(bundle, "spec/kinds"));
  const handlers = createHandlers({ bundle, kinds });

  const server = new Server(
    { name: "tapes-mcp", version: "0.0.0" },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const handler = handlers[name];
    if (!handler) {
      return { isError: true, content: [{ type: "text" as const, text: `unknown tool: ${name}` }] };
    }
    try {
      const result = await handler((args ?? {}) as Record<string, unknown>);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      return { isError: true, content: [{ type: "text" as const, text }] };
    }
  });

  await server.connect(new StdioServerTransport());
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  void start();
}
