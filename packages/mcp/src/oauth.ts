// OAuth 2.1 + Dynamic Client Registration + PKCE for the HTTP transport.
//
// This is the second auth stage, additive to the opaque Bearer tokens in
// http.ts. Opaque tokens (TAPES_MCP_TOKEN) serve LobeChat / LibreChat and any
// client that can carry a static header. OAuth serves claude.ai, which speaks
// the MCP authorization spec: discover the protected-resource metadata, register
// a client dynamically, send the user through a browser login, exchange a PKCE
// auth code for a token. We mint HS256 JWTs as access tokens — stateless, so a
// live token survives a server restart as long as the signing secret is stable.
//
// Ported from the proven wiki-mcp implementation (Python) that already serves
// claude.ai. Registered clients persist to a JSON file; auth codes live in
// memory with a short TTL (a restart mid-login just means the user retries).
import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { IncomingMessage, ServerResponse } from "node:http";

export const OAUTH_SCOPE = "vault";
const CODE_TTL_SECONDS = 5 * 60; // claude.ai exchanges the code within seconds
const TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24h access-token lifetime

export interface OAuthConfig {
  enabled: boolean;
  /** HS256 signing secret for access tokens. */
  jwtSecret: string;
  /** Single shared password the user types at the login screen. */
  loginPassword: string;
  /** Public origin the server is reached at, e.g. https://tapes.adilzuberi.com (no trailing slash). */
  publicUrl: string;
  /** Directory where registered clients persist across restarts. */
  dataDir: string;
}

export function oauthConfigFromEnv(): OAuthConfig {
  return {
    enabled: (process.env.TAPES_MCP_OAUTH_ENABLED ?? "false").toLowerCase() === "true",
    jwtSecret: process.env.TAPES_MCP_OAUTH_JWT_SECRET ?? "",
    loginPassword: process.env.TAPES_MCP_OAUTH_LOGIN_PASSWORD ?? "",
    publicUrl: (process.env.TAPES_MCP_PUBLIC_URL ?? "").replace(/\/+$/, ""),
    dataDir: process.env.TAPES_MCP_OAUTH_DATA_DIR ?? join(tmpdir(), "tapes-oauth"),
  };
}

/** Fail fast at startup if OAuth is on but a required secret is missing. */
export function assertOAuthReady(cfg: OAuthConfig): void {
  if (!cfg.enabled) return;
  const missing: string[] = [];
  if (!cfg.jwtSecret) missing.push("TAPES_MCP_OAUTH_JWT_SECRET");
  if (!cfg.loginPassword) missing.push("TAPES_MCP_OAUTH_LOGIN_PASSWORD");
  if (!cfg.publicUrl) missing.push("TAPES_MCP_PUBLIC_URL");
  if (missing.length) {
    throw new Error(`OAuth enabled but missing: ${missing.join(", ")}`);
  }
}

// --- JWT (HS256) -----------------------------------------------------------

function b64urlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

export function jwtEncode(claims: Record<string, unknown>, secret: string): string {
  const header = b64urlJson({ alg: "HS256", typ: "JWT" });
  const payload = b64urlJson(claims);
  const msg = `${header}.${payload}`;
  const sig = createHmac("sha256", secret).update(msg).digest("base64url");
  return `${msg}.${sig}`;
}

/** Verify + decode an HS256 JWT. Returns claims on success, null on any failure. */
export function jwtDecode(token: string, secret: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expected = createHmac("sha256", secret).update(`${h}.${p}`).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(s, "base64url");
  } catch {
    return null;
  }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims !== "object" || claims === null) return null;
  const c = claims as Record<string, unknown>;
  if (typeof c.exp === "number" && c.exp < Math.floor(Date.now() / 1000)) return null;
  return c;
}

/** True if the token is one of ours: a valid JWT issued by this server. */
export function jwtAuthorized(token: string, cfg: OAuthConfig): boolean {
  if (!cfg.enabled || token.split(".").length !== 3) return false;
  const claims = jwtDecode(token, cfg.jwtSecret);
  return !!claims && claims.iss === cfg.publicUrl;
}

// --- PKCE -------------------------------------------------------------------

export function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  let expected: string;
  if (method === "S256") expected = createHash("sha256").update(verifier).digest("base64url");
  else if (method === "plain") expected = verifier;
  else return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

// --- Store: clients persisted to disk, codes in memory ----------------------

interface Client {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  registered_at: number;
}

interface Code {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  expires_at: number;
}

export class OAuthStore {
  private clientsPath: string;
  private clients = new Map<string, Client>();
  private codes = new Map<string, Code>();

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.clientsPath = join(dataDir, "oauth-clients.json");
    if (existsSync(this.clientsPath)) {
      try {
        const arr = JSON.parse(readFileSync(this.clientsPath, "utf8")) as Client[];
        for (const c of arr) this.clients.set(c.client_id, c);
      } catch {
        // Corrupt file — start empty rather than crash the server.
      }
    }
  }

  private persist(): void {
    writeFileSync(this.clientsPath, JSON.stringify([...this.clients.values()], null, 2));
  }

  registerClient(name: string, redirectUris: string[]): Client {
    const client: Client = {
      client_id: "client_" + randomBytes(16).toString("base64url"),
      client_name: name,
      redirect_uris: redirectUris,
      registered_at: Math.floor(Date.now() / 1000),
    };
    this.clients.set(client.client_id, client);
    this.persist();
    return client;
  }

  lookupClient(id: string): Client | undefined {
    return this.clients.get(id);
  }

  issueCode(
    clientId: string,
    redirectUri: string,
    codeChallenge: string,
    codeChallengeMethod: string,
    scope: string,
  ): string {
    const code = "code_" + randomBytes(32).toString("base64url");
    this.codes.set(code, {
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      scope,
      expires_at: Math.floor(Date.now() / 1000) + CODE_TTL_SECONDS,
    });
    return code;
  }

  /** Validate + consume an auth code (single use). Returns its scope, or null. */
  redeemCode(code: string, clientId: string, redirectUri: string, codeVerifier: string): { scope: string } | null {
    const row = this.codes.get(code);
    if (!row) return null;
    // Single-use: drop it now whatever the outcome.
    this.codes.delete(code);
    if (row.expires_at < Math.floor(Date.now() / 1000)) return null;
    if (!timingEq(row.client_id, clientId)) return null;
    if (!timingEq(row.redirect_uri, redirectUri)) return null;
    if (!verifyPkce(codeVerifier, row.code_challenge, row.code_challenge_method)) return null;
    return { scope: row.scope };
  }
}

function timingEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// --- HTTP helpers -----------------------------------------------------------

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function readRaw(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  return new URLSearchParams(await readRaw(req));
}

const LOGIN_PAGE = (f: {
  clientName: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
  errorHtml: string;
}) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>50 First Tapes — sign in</title>
<style>
body{font-family:system-ui,sans-serif;max-width:420px;margin:80px auto;padding:24px;background:#fafafa;color:#222}
h1{font-size:1.4em;margin:0 0 8px}
.sub{color:#666;font-size:0.9em;margin:0 0 24px}
.client{background:#fff;border:1px solid #eee;border-radius:4px;padding:12px;margin-bottom:24px}
.client strong{color:#111}
.error{background:#fee;color:#900;padding:10px;border-radius:4px;margin-bottom:16px;font-size:0.9em}
form{margin:0}
input[type=password]{width:100%;padding:12px;font-size:16px;margin-bottom:12px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px}
button{width:100%;padding:12px;font-size:16px;background:#111;color:#fff;border:0;border-radius:4px;cursor:pointer}
button:hover{background:#000}
</style></head><body>
<h1>50 First Tapes</h1>
<p class="sub">Sign in to grant vault access</p>
<div class="client"><strong>${f.clientName}</strong> wants to reach your vault (${f.scope}).</div>
${f.errorHtml}
<form method="POST" action="/authorize">
<input type="hidden" name="client_id" value="${f.clientId}">
<input type="hidden" name="redirect_uri" value="${f.redirectUri}">
<input type="hidden" name="state" value="${f.state}">
<input type="hidden" name="code_challenge" value="${f.codeChallenge}">
<input type="hidden" name="code_challenge_method" value="${f.codeChallengeMethod}">
<input type="hidden" name="scope" value="${f.scope}">
<input type="password" name="password" placeholder="Password" autofocus required>
<button type="submit">Sign in</button>
</form>
</body></html>`;

function renderLogin(
  res: ServerResponse,
  client: Client,
  redirectUri: string,
  state: string,
  codeChallenge: string,
  codeChallengeMethod: string,
  scope: string,
  error?: string,
): void {
  const html = LOGIN_PAGE({
    clientName: htmlEscape(client.client_name),
    clientId: htmlEscape(client.client_id),
    redirectUri: htmlEscape(redirectUri),
    state: htmlEscape(state),
    codeChallenge: htmlEscape(codeChallenge),
    codeChallengeMethod: htmlEscape(codeChallengeMethod),
    scope: htmlEscape(scope || OAUTH_SCOPE),
    errorHtml: error ? `<div class="error">${htmlEscape(error)}</div>` : "",
  });
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

// --- Router -----------------------------------------------------------------

/**
 * Handle the OAuth surface. Returns true if the request was an OAuth route (and
 * a response was written), false to let the caller fall through to /mcp or 404.
 * These routes are intentionally unauthenticated — they are the auth mechanism.
 */
export async function handleOAuth(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: OAuthConfig,
  store: OAuthStore,
): Promise<boolean> {
  if (!cfg.enabled) return false;
  const parsed = new URL(req.url ?? "/", cfg.publicUrl || "http://localhost");
  const path = parsed.pathname;
  const method = req.method ?? "GET";

  const sendJson = (status: number, payload: unknown): boolean => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
    return true;
  };
  const oauthError = (status: number, error: string, desc: string): boolean =>
    sendJson(status, { error, error_description: desc });

  // --- Discovery metadata ---
  if (method === "GET" && path === "/.well-known/oauth-protected-resource") {
    return sendJson(200, {
      resource: cfg.publicUrl,
      authorization_servers: [cfg.publicUrl],
      scopes_supported: [OAUTH_SCOPE],
      bearer_methods_supported: ["header"],
    });
  }
  if (method === "GET" && path === "/.well-known/oauth-authorization-server") {
    return sendJson(200, {
      issuer: cfg.publicUrl,
      authorization_endpoint: `${cfg.publicUrl}/authorize`,
      token_endpoint: `${cfg.publicUrl}/token`,
      registration_endpoint: `${cfg.publicUrl}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [OAUTH_SCOPE],
    });
  }

  // --- Dynamic Client Registration ---
  if (method === "POST" && path === "/register") {
    let body: { redirect_uris?: unknown; client_name?: unknown };
    try {
      body = JSON.parse(await readRaw(req));
    } catch {
      return oauthError(400, "invalid_request", "invalid JSON body");
    }
    const redirectUris = body.redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
      return oauthError(400, "invalid_request", "redirect_uris required (non-empty list)");
    }
    for (const uri of redirectUris) {
      if (typeof uri !== "string" || !/^(https:\/\/|http:\/\/localhost|http:\/\/127\.0\.0\.1)/.test(uri)) {
        return oauthError(400, "invalid_redirect_uri", `redirect_uri must be https or localhost: ${uri}`);
      }
    }
    const clientName = typeof body.client_name === "string" && body.client_name ? body.client_name : "Unnamed client";
    const client = store.registerClient(clientName, redirectUris as string[]);
    return sendJson(201, {
      client_id: client.client_id,
      client_id_issued_at: client.registered_at,
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  }

  // --- Authorization endpoint: GET shows the login form ---
  if (method === "GET" && path === "/authorize") {
    const q = parsed.searchParams;
    const responseType = q.get("response_type") ?? "code";
    const codeChallenge = q.get("code_challenge") ?? "";
    const codeChallengeMethod = q.get("code_challenge_method") ?? "S256";
    const clientId = q.get("client_id") ?? "";
    const redirectUri = q.get("redirect_uri") ?? "";
    const state = q.get("state") ?? "";
    const scope = q.get("scope") ?? OAUTH_SCOPE;
    if (responseType !== "code") return oauthError(400, "unsupported_response_type", "response_type must be 'code'");
    if (!codeChallenge || codeChallengeMethod !== "S256") {
      return oauthError(400, "invalid_request", "PKCE (S256 code_challenge) required");
    }
    const client = store.lookupClient(clientId);
    if (!client) return oauthError(400, "invalid_request", "unknown client_id");
    if (!client.redirect_uris.includes(redirectUri)) {
      return oauthError(400, "invalid_request", "redirect_uri not registered for this client_id");
    }
    renderLogin(res, client, redirectUri, state, codeChallenge, codeChallengeMethod, scope);
    return true;
  }

  // --- Authorization endpoint: POST checks the password, issues a code ---
  if (method === "POST" && path === "/authorize") {
    const form = await readForm(req);
    const clientId = form.get("client_id") ?? "";
    const redirectUri = form.get("redirect_uri") ?? "";
    const codeChallenge = form.get("code_challenge") ?? "";
    const codeChallengeMethod = form.get("code_challenge_method") ?? "S256";
    const state = form.get("state") ?? "";
    const scope = form.get("scope") ?? OAUTH_SCOPE;
    const password = form.get("password") ?? "";
    const client = store.lookupClient(clientId);
    if (!client || !client.redirect_uris.includes(redirectUri)) {
      return oauthError(400, "invalid_request", "invalid client_id or redirect_uri");
    }
    if (!timingEq(password, cfg.loginPassword)) {
      renderLogin(res, client, redirectUri, state, codeChallenge, codeChallengeMethod, scope, "Wrong password.");
      return true;
    }
    const code = store.issueCode(clientId, redirectUri, codeChallenge, codeChallengeMethod, scope);
    const sep = redirectUri.includes("?") ? "&" : "?";
    const location = `${redirectUri}${sep}${new URLSearchParams({ code, state }).toString()}`;
    res.writeHead(302, { location });
    res.end();
    return true;
  }

  // --- Token endpoint: exchange the PKCE code for a JWT ---
  if (method === "POST" && path === "/token") {
    const form = await readForm(req);
    if ((form.get("grant_type") ?? "") !== "authorization_code") {
      return oauthError(400, "unsupported_grant_type", "grant_type must be authorization_code");
    }
    const code = form.get("code") ?? "";
    const redirectUri = form.get("redirect_uri") ?? "";
    const codeVerifier = form.get("code_verifier") ?? "";
    const clientId = form.get("client_id") ?? "";
    const redeemed = store.redeemCode(code, clientId, redirectUri, codeVerifier);
    if (!redeemed) return oauthError(400, "invalid_grant", "invalid or expired authorization code");
    const now = Math.floor(Date.now() / 1000);
    const accessToken = jwtEncode(
      {
        iss: cfg.publicUrl,
        sub: "adil",
        aud: clientId,
        iat: now,
        exp: now + TOKEN_TTL_SECONDS,
        scope: redeemed.scope || OAUTH_SCOPE,
      },
      cfg.jwtSecret,
    );
    return sendJson(200, {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: TOKEN_TTL_SECONDS,
      scope: redeemed.scope || OAUTH_SCOPE,
    });
  }

  return false;
}

/** The WWW-Authenticate value for a 401 so clients can discover the OAuth server. */
export function wwwAuthenticate(cfg: OAuthConfig): string {
  if (cfg.enabled && cfg.publicUrl) {
    return `Bearer realm="tapes-mcp", resource_metadata="${cfg.publicUrl}/.well-known/oauth-protected-resource"`;
  }
  return "Bearer";
}
