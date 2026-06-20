import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHandlers, SERVER_INSTRUCTIONS, TOOL_DEFS, type McpConfig } from "./handlers.js";

// MCP JSON-RPC over HTTP, mirroring the shape the read-only wiki-mcp serves to
// claude.ai + LibreChat — so this is a drop-in replacement for those clients.
const PROTOCOL_VERSION = "2024-11-05";

function ok(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}
function err(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function tokensFromEnv(): Set<string> {
  return new Set(
    (process.env.TAPES_MCP_TOKEN ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  );
}

function authorized(req: IncomingMessage, tokens: Set<string>): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
  return m ? tokens.has(m[1].trim()) : false;
}

async function readJson(req: IncomingMessage): Promise<{ method?: string; params?: Record<string, unknown>; id?: unknown }> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

// Discovery + ping carry no user context, so they skip auth (as wiki-mcp does);
// every tool call requires a Bearer token.
function isOpen(method: string | undefined): boolean {
  return (
    method === "initialize" ||
    method === "tools/list" ||
    method === "ping" ||
    (typeof method === "string" && method.startsWith("notifications/"))
  );
}

/** Serve the protocol over HTTP with Bearer auth. Stdio stays the default; this is for hosted use. */
export async function startHttp(cfg: McpConfig, port: number): Promise<void> {
  const tokens = tokensFromEnv();
  if (tokens.size === 0) {
    throw new Error("HTTP mode requires TAPES_MCP_TOKEN (one or more comma-separated Bearer tokens)");
  }
  const handlers = createHandlers(cfg);

  async function dispatch(method: string | undefined, params: Record<string, unknown>, id: unknown) {
    if (method === "initialize") {
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "tapes-mcp", version: "0.0.0" },
        instructions: SERVER_INSTRUCTIONS,
      });
    }
    if (method === "tools/list") return ok(id, { tools: TOOL_DEFS });
    if (method === "ping") return ok(id, {});
    if (typeof method === "string" && method.startsWith("notifications/")) return ok(id, {});
    if (method === "tools/call") {
      const name = params.name as string | undefined;
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const handler = name ? handlers[name] : undefined;
      if (!handler) return err(id, -32601, `unknown tool: ${name}`);
      try {
        const result = await handler(args);
        const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        return ok(id, { content: [{ type: "text", text }] });
      } catch (e) {
        return ok(id, {
          isError: true,
          content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
        });
      }
    }
    return err(id, -32601, `unknown method: ${method}`);
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    process.stderr.write(
      `[req] ${req.method} ${req.url} ua="${String(req.headers["user-agent"] ?? "").slice(0, 40)}"\n`,
    );
    const url = (req.url ?? "").split("?")[0];
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    if (url === "/health") return json(200, { status: "ok", server: "tapes-mcp" });
    if (url !== "/mcp" || req.method !== "POST") {
      res.writeHead(404).end("not found");
      return;
    }

    let body;
    try {
      body = await readJson(req);
    } catch {
      process.stderr.write(`[mcp] parse-error from ua="${String(req.headers["user-agent"] ?? "").slice(0, 48)}"\n`);
      return json(400, err(null, -32700, "parse error"));
    }
    process.stderr.write(
      `[mcp] method=${body.method ?? "?"} auth=${authorized(req, tokens) ? "y" : "n"} ` +
        `accept="${String(req.headers["accept"] ?? "").slice(0, 40)}" ua="${String(req.headers["user-agent"] ?? "").slice(0, 40)}"\n`,
    );
    if (!isOpen(body.method) && !authorized(req, tokens)) {
      res.writeHead(401, { "www-authenticate": "Bearer", "content-type": "application/json" });
      res.end(JSON.stringify(err(body.id ?? null, -32001, "unauthorised")));
      return;
    }
    json(200, await dispatch(body.method, body.params ?? {}, body.id ?? null));
  });

  await new Promise<void>((r) => server.listen(port, r));
  process.stderr.write(`tapes-mcp HTTP on :${port} (/mcp; Bearer required for tool calls)\n`);
}
