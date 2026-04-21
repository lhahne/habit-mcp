import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, type Page, type APIRequestContext } from "@playwright/test";
import { SignJWT, importJWK, type JWK } from "jose";

const here = path.dirname(fileURLToPath(import.meta.url));
const PRIVATE_JWK_PATH = path.join(here, ".state", "private-jwk.json");

let cachedJwk: CryptoKey | null = null;

async function loadPrivateKey(): Promise<CryptoKey> {
  if (cachedJwk) return cachedJwk;
  const raw = await readFile(PRIVATE_JWK_PATH, "utf8");
  const jwk = JSON.parse(raw) as JWK;
  cachedJwk = (await importJWK(jwk, "RS256")) as CryptoKey;
  return cachedJwk;
}

export async function signE2eJwt(email = "owner@example.com"): Promise<string> {
  const key = await loadPrivateKey();
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "RS256", kid: "e2e-key" })
    .setIssuer("https://e2e.local")
    .setAudience("e2e-aud")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

export interface SeedInput {
  habits?: {
    name: string;
    startDate?: string;
    endDate?: string | null;
  }[];
  checkIns?: {
    habitName: string;
    date: string;
    done?: boolean;
    note?: string | null;
  }[];
  comments?: { date: string; comment: string }[];
}

async function rpc(
  request: APIRequestContext,
  token: string,
  method: string,
  params: unknown,
  id: number,
): Promise<unknown> {
  const res = await request.post("/mcp", {
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    data: { jsonrpc: "2.0", id, method, params },
  });
  if (!res.ok()) {
    throw new Error(`rpc ${method} failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

async function obtainMcpToken(request: APIRequestContext): Promise<string> {
  const jwt = await signE2eJwt();

  const reg = await request.post("/register", {
    headers: { "content-type": "application/json" },
    data: {
      redirect_uris: ["http://localhost/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "e2e-seed",
    },
  });
  if (!reg.ok()) {
    throw new Error(`register failed: ${reg.status()} ${await reg.text()}`);
  }
  const { client_id } = (await reg.json()) as { client_id: string };

  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );

  const authParams = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: "http://localhost/callback",
    scope: "mcp",
    state: "e2e",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const auth = await request.get(`/authorize?${authParams}`, {
    headers: { "Cf-Access-Jwt-Assertion": jwt },
    maxRedirects: 0,
    failOnStatusCode: false,
  });
  if (auth.status() !== 302) {
    throw new Error(
      `authorize expected 302 got ${auth.status()}: ${await auth.text()}`,
    );
  }
  const loc = auth.headers()["location"];
  if (!loc) throw new Error("authorize missing location header");
  const code = new URL(loc).searchParams.get("code");
  if (!code) throw new Error("authorize missing code");

  const tok = await request.post("/token", {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    form: {
      grant_type: "authorization_code",
      code,
      redirect_uri: "http://localhost/callback",
      client_id,
      code_verifier: verifier,
    },
  });
  if (!tok.ok()) {
    throw new Error(`token failed: ${tok.status()} ${await tok.text()}`);
  }
  const { access_token } = (await tok.json()) as { access_token: string };
  return access_token;
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function seed(
  request: APIRequestContext,
  input: SeedInput,
): Promise<Map<string, number>> {
  const token = await obtainMcpToken(request);
  await rpc(
    request,
    token,
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "e2e", version: "0" },
    },
    1,
  );

  const habitIds = new Map<string, number>();
  let id = 2;
  for (const h of input.habits ?? []) {
    const res = (await rpc(
      request,
      token,
      "tools/call",
      {
        name: "create_habit",
        arguments: {
          name: h.name,
          start_date: h.startDate ?? "2026-01-01",
          end_date: h.endDate ?? null,
        },
      },
      id++,
    )) as {
      result?: {
        structuredContent?: { habit?: { id?: number } };
        isError?: boolean;
      };
    };
    const habitId = res.result?.structuredContent?.habit?.id;
    if (typeof habitId !== "number") {
      throw new Error(
        `create_habit returned no id: ${JSON.stringify(res)}`,
      );
    }
    habitIds.set(h.name, habitId);
  }

  for (const ci of input.checkIns ?? []) {
    const habitId = habitIds.get(ci.habitName);
    if (habitId === undefined) {
      throw new Error(`seed: unknown habit ${ci.habitName}`);
    }
    await rpc(
      request,
      token,
      "tools/call",
      {
        name: "upsert_check_in",
        arguments: {
          habit_id: habitId,
          date: ci.date,
          done: ci.done ?? true,
          note: ci.note ?? null,
        },
      },
      id++,
    );
  }

  for (const c of input.comments ?? []) {
    await rpc(
      request,
      token,
      "tools/call",
      {
        name: "set_day_comment",
        arguments: { date: c.date, comment: c.comment },
      },
      id++,
    );
  }

  return habitIds;
}

type Fixtures = {
  authedPage: Page;
};

export const test = base.extend<Fixtures>({
  authedPage: async ({ context, page }, use) => {
    const jwt = await signE2eJwt();
    await context.setExtraHTTPHeaders({ "Cf-Access-Jwt-Assertion": jwt });
    await use(page);
  },
});

export { expect } from "@playwright/test";
