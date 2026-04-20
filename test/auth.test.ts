import { SELF } from "cloudflare:test";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from "jose";
import { afterEach, describe, expect, it } from "vitest";

import { __setJwksForTest } from "../src/auth/cf-access.js";

const BASE = "https://habit-mcp.test";

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pkce() {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64url(verifierBytes);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

async function registerClient(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [`${BASE}/callback`],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "test-client",
    }),
  });
  expect(res.status).toBeLessThan(400);
  const body = (await res.json()) as { client_id: string };
  return body.client_id;
}

function authorizeUrl(
  clientId: string,
  challenge: string,
  state = "xyz",
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: `${BASE}/callback`,
    scope: "mcp",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${BASE}/authorize?${params.toString()}`;
}

async function obtainToken(): Promise<string> {
  const clientId = await registerClient();
  const { verifier, challenge } = await pkce();
  const url = authorizeUrl(clientId, challenge);

  const submit = await SELF.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password: "test-password" }),
    redirect: "manual",
  });
  expect(submit.status).toBe(302);
  const location = submit.headers.get("location")!;
  const redirected = new URL(location);
  const code = redirected.searchParams.get("code")!;
  expect(code).toBeTruthy();

  const tokenRes = await SELF.fetch(`${BASE}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${BASE}/callback`,
      client_id: clientId,
      code_verifier: verifier,
    }),
  });
  expect(tokenRes.status).toBe(200);
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  expect(access_token).toBeTruthy();
  return access_token;
}

async function rpc(
  token: string,
  method: string,
  params: Record<string, unknown> = {},
  id = 1,
): Promise<{ status: number; body: unknown }> {
  const res = await SELF.fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await res.text();
  let body: unknown = text;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    body = JSON.parse(text);
  } else if (ct.includes("text/event-stream")) {
    const line = text
      .split("\n")
      .find((l: string) => l.startsWith("data: "));
    if (line) body = JSON.parse(line.slice(6));
  }
  return { status: res.status, body };
}

describe("OAuth + MCP integration", () => {
  it("exposes OAuth authorization server metadata", async () => {
    const res = await SELF.fetch(
      `${BASE}/.well-known/oauth-authorization-server`,
    );
    expect(res.status).toBe(200);
    const meta = (await res.json()) as Record<string, unknown>;
    expect(meta.authorization_endpoint).toContain("/authorize");
    expect(meta.token_endpoint).toContain("/token");
    expect(meta.registration_endpoint).toContain("/register");
    expect((meta.scopes_supported as string[]).includes("mcp")).toBe(true);
  });

  it("exposes protected resource metadata", async () => {
    const res = await SELF.fetch(
      `${BASE}/.well-known/oauth-protected-resource`,
    );
    expect(res.status).toBe(200);
    const meta = (await res.json()) as Record<string, unknown>;
    expect(meta).toHaveProperty("resource");
    expect(meta).toHaveProperty("authorization_servers");
  });

  it("registers a client via Dynamic Client Registration", async () => {
    const clientId = await registerClient();
    expect(clientId).toBeTruthy();
  });

  it("rejects a missing bearer token on /mcp with 401", async () => {
    const res = await SELF.fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
  });

  it("renders the login form and rejects a wrong password", async () => {
    const clientId = await registerClient();
    const { challenge } = await pkce();
    const url = authorizeUrl(clientId, challenge);

    const getRes = await SELF.fetch(url);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("content-type") ?? "").toContain("text/html");
    const html = await getRes.text();
    expect(html).toContain("password");

    const bad = await SELF.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: "wrong" }),
      redirect: "manual",
    });
    expect(bad.status).toBe(401);
  });

  describe("Cloudflare Access short-circuit", () => {
    afterEach(() => {
      __setJwksForTest(undefined);
    });

    async function signAccessJwt(opts: {
      email: string;
      issuer?: string;
      audience?: string;
      expiresIn?: string;
    }): Promise<string> {
      const { publicKey, privateKey } = await generateKeyPair("RS256", {
        extractable: true,
      });
      const publicJwk = await exportJWK(publicKey);
      publicJwk.kid = "test-key";
      publicJwk.alg = "RS256";
      __setJwksForTest(createLocalJWKSet({ keys: [publicJwk] }));

      return new SignJWT({ email: opts.email })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(opts.issuer ?? "https://test.cloudflareaccess.com")
        .setAudience(opts.audience ?? "test-aud")
        .setIssuedAt()
        .setExpirationTime(opts.expiresIn ?? "5m")
        .sign(privateKey);
    }

    it("skips password when a valid Cf-Access-Jwt-Assertion is present", async () => {
      const jwt = await signAccessJwt({ email: "owner@example.com" });
      const clientId = await registerClient();
      const { challenge } = await pkce();
      const url = authorizeUrl(clientId, challenge);

      const res = await SELF.fetch(url, {
        headers: { "Cf-Access-Jwt-Assertion": jwt },
        redirect: "manual",
      });
      expect(res.status).toBe(302);
      const location = res.headers.get("location")!;
      expect(new URL(location).searchParams.get("code")).toBeTruthy();
    });

    it("rejects a JWT whose email is not on the allowlist", async () => {
      const jwt = await signAccessJwt({ email: "stranger@example.com" });
      const clientId = await registerClient();
      const { challenge } = await pkce();
      const url = authorizeUrl(clientId, challenge);

      const res = await SELF.fetch(url, {
        headers: { "Cf-Access-Jwt-Assertion": jwt },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("password");
    });

    it("falls through to the password form when the JWT is malformed", async () => {
      const clientId = await registerClient();
      const { challenge } = await pkce();
      const url = authorizeUrl(clientId, challenge);

      const res = await SELF.fetch(url, {
        headers: { "Cf-Access-Jwt-Assertion": "not.a.real.jwt" },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("password");
    });
  });

  it("completes the OAuth flow and authenticates an MCP call", async () => {
    const token = await obtainToken();

    const init = await rpc(token, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(init.status).toBe(200);
    expect((init.body as { result: unknown }).result).toBeDefined();

    const list = await rpc(token, "tools/list", {}, 2);
    expect(list.status).toBe(200);
    const tools = (list.body as { result: { tools: { name: string }[] } })
      .result.tools;
    const names = tools.map((t) => t.name);
    expect(names).toContain("create_habit");
    expect(names).toContain("upsert_check_in");
  });
});
