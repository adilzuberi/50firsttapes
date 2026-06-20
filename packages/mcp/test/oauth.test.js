import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import {
  jwtEncode,
  jwtDecode,
  jwtAuthorized,
  verifyPkce,
  OAuthStore,
  assertOAuthReady,
  oauthConfigFromEnv,
} from "../dist/oauth.js";

const SECRET = "test-signing-secret";
const ISS = "https://tapes.example.com";

function enabledCfg(extra = {}) {
  return { enabled: true, jwtSecret: SECRET, loginPassword: "pw", publicUrl: ISS, dataDir: "/tmp", ...extra };
}

test("jwt round-trips and verifies", () => {
  const now = Math.floor(Date.now() / 1000);
  const token = jwtEncode({ iss: ISS, sub: "adil", exp: now + 60 }, SECRET);
  const claims = jwtDecode(token, SECRET);
  assert.equal(claims.iss, ISS);
  assert.equal(claims.sub, "adil");
});

test("jwt rejects a wrong signature", () => {
  const now = Math.floor(Date.now() / 1000);
  const token = jwtEncode({ iss: ISS, exp: now + 60 }, SECRET);
  assert.equal(jwtDecode(token, "other-secret"), null);
});

test("jwt rejects an expired token", () => {
  const now = Math.floor(Date.now() / 1000);
  const token = jwtEncode({ iss: ISS, exp: now - 1 }, SECRET);
  assert.equal(jwtDecode(token, SECRET), null);
});

test("jwt rejects a tampered payload", () => {
  const now = Math.floor(Date.now() / 1000);
  const token = jwtEncode({ iss: ISS, exp: now + 60 }, SECRET);
  const [h, , s] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ iss: ISS, sub: "mallory", exp: now + 60 })).toString("base64url");
  assert.equal(jwtDecode(`${h}.${forged}.${s}`, SECRET), null);
});

test("jwtAuthorized requires our issuer and enabled config", () => {
  const now = Math.floor(Date.now() / 1000);
  const good = jwtEncode({ iss: ISS, exp: now + 60 }, SECRET);
  assert.equal(jwtAuthorized(good, enabledCfg()), true);
  // wrong issuer
  const wrongIss = jwtEncode({ iss: "https://evil.example", exp: now + 60 }, SECRET);
  assert.equal(jwtAuthorized(wrongIss, enabledCfg()), false);
  // disabled config never authorises
  assert.equal(jwtAuthorized(good, enabledCfg({ enabled: false })), false);
  // not a JWT shape
  assert.equal(jwtAuthorized("sk-tapes-opaque", enabledCfg()), false);
});

test("PKCE S256 verifies and rejects mismatches", () => {
  const verifier = "a-long-random-verifier-string-1234567890";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  assert.equal(verifyPkce(verifier, challenge, "S256"), true);
  assert.equal(verifyPkce("wrong-verifier", challenge, "S256"), false);
  assert.equal(verifyPkce(verifier, challenge, "bogus"), false);
});

test("store: register, lookup, issue + redeem a code", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tapes-oauth-"));
  const store = new OAuthStore(dir);
  const client = store.registerClient("claude.ai", ["https://claude.ai/api/mcp/auth_callback"]);
  assert.ok(client.client_id.startsWith("client_"));
  assert.deepEqual(store.lookupClient(client.client_id).redirect_uris, [
    "https://claude.ai/api/mcp/auth_callback",
  ]);
  assert.equal(store.lookupClient("nope"), undefined);

  const verifier = "verifier-xyz-9876543210-abcdefghij";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirect = "https://claude.ai/api/mcp/auth_callback";
  const code = store.issueCode(client.client_id, redirect, challenge, "S256", "vault");

  // wrong verifier fails
  assert.equal(store.redeemCode(code, client.client_id, redirect, "bad-verifier"), null);
  // the failed attempt consumed the code (single use) — re-issue for the happy path
  const code2 = store.issueCode(client.client_id, redirect, challenge, "S256", "vault");
  const ok = store.redeemCode(code2, client.client_id, redirect, verifier);
  assert.equal(ok.scope, "vault");
  // a code cannot be redeemed twice
  assert.equal(store.redeemCode(code2, client.client_id, redirect, verifier), null);
});

test("store: redeem rejects a wrong client or redirect_uri", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tapes-oauth-"));
  const store = new OAuthStore(dir);
  const client = store.registerClient("c", ["https://claude.ai/cb"]);
  const verifier = "verifier-aaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const code = store.issueCode(client.client_id, "https://claude.ai/cb", challenge, "S256", "vault");
  assert.equal(store.redeemCode(code, "client_other", "https://claude.ai/cb", verifier), null);
});

test("store: registered clients persist across instances", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tapes-oauth-"));
  const a = new OAuthStore(dir);
  const client = a.registerClient("claude.ai", ["https://claude.ai/cb"]);
  const b = new OAuthStore(dir);
  assert.equal(b.lookupClient(client.client_id).client_name, "claude.ai");
});

test("assertOAuthReady throws when a secret is missing", () => {
  assert.throws(() => assertOAuthReady({ enabled: true, jwtSecret: "", loginPassword: "p", publicUrl: ISS, dataDir: "/tmp" }));
  // disabled config is always fine
  assert.doesNotThrow(() => assertOAuthReady({ enabled: false, jwtSecret: "", loginPassword: "", publicUrl: "", dataDir: "/tmp" }));
});

test("oauthConfigFromEnv strips a trailing slash from the public url", () => {
  const prev = process.env.TAPES_MCP_PUBLIC_URL;
  process.env.TAPES_MCP_PUBLIC_URL = "https://tapes.example.com/";
  try {
    assert.equal(oauthConfigFromEnv().publicUrl, "https://tapes.example.com");
  } finally {
    if (prev === undefined) delete process.env.TAPES_MCP_PUBLIC_URL;
    else process.env.TAPES_MCP_PUBLIC_URL = prev;
  }
});
