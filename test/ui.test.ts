import { SELF, env as testEnv } from "cloudflare:test";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from "jose";
import { afterEach, describe, expect, it } from "vitest";

import { __setJwksForTest } from "../src/auth/cf-access.js";
import { upsertCheckIn } from "../src/db/check-ins.js";
import { setDayComment } from "../src/db/days.js";
import { db, makeHabit } from "./helpers.js";

const BASE = "https://habit-mcp.test";

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

describe("GET /ui", () => {
  afterEach(() => {
    __setJwksForTest(undefined);
  });

  it("returns 401 without Cf-Access header", async () => {
    const res = await SELF.fetch(`${BASE}/ui`);
    expect(res.status).toBe(401);
  });

  it("returns 401 for a malformed JWT", async () => {
    const res = await SELF.fetch(`${BASE}/ui`, {
      headers: { "Cf-Access-Jwt-Assertion": "not.a.real.jwt" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when JWT email is not allowlisted", async () => {
    const jwt = await signAccessJwt({ email: "stranger@example.com" });
    const res = await SELF.fetch(`${BASE}/ui`, {
      headers: { "Cf-Access-Jwt-Assertion": jwt },
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 HTML with habit names when authenticated", async () => {
    await makeHabit({ name: "Meditate" });
    await makeHabit({ name: "Run" });

    const jwt = await signAccessJwt({ email: "owner@example.com" });
    const res = await SELF.fetch(`${BASE}/ui`, {
      headers: { "Cf-Access-Jwt-Assertion": jwt },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toContain("Meditate");
    expect(body).toContain("Run");
    expect(body).toContain('id="ui-data"');
  });

  it("includes long comments inside the JSON island", async () => {
    const habit = await makeHabit({
      name: "Meditate",
      startDate: "2026-01-01",
    });
    const longComment = "a".repeat(1500) + "\nline break\n" + "b".repeat(1500);
    await setDayComment(db(), "2026-04-20", longComment);
    await upsertCheckIn(db(), {
      habitId: habit.id,
      date: "2026-04-20",
      done: true,
      note: "felt good",
    });

    const jwt = await signAccessJwt({ email: "owner@example.com" });
    const res = await SELF.fetch(`${BASE}/ui`, {
      headers: { "Cf-Access-Jwt-Assertion": jwt },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("a".repeat(1500));
    expect(body).toContain("b".repeat(1500));
    expect(body).toContain("felt good");
  });

  it("escapes </script> in comments inside the JSON island", async () => {
    await makeHabit({ name: "Meditate" });
    await setDayComment(
      db(),
      "2026-04-15",
      '</script><img src=x onerror=alert(1)>',
    );

    const jwt = await signAccessJwt({ email: "owner@example.com" });
    const res = await SELF.fetch(`${BASE}/ui`, {
      headers: { "Cf-Access-Jwt-Assertion": jwt },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    const start = body.indexOf('id="ui-data"');
    const end = body.indexOf("</script>", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const island = body.slice(start, end);
    expect(island).not.toContain("</script>");
    expect(island).not.toContain("<img");
    expect(island).toContain("\\u003c/script>");
    expect(island).toContain("\\u003cimg src=x");
  });

  it("honours ?from and ?to range", async () => {
    const jwt = await signAccessJwt({ email: "owner@example.com" });
    const res = await SELF.fetch(
      `${BASE}/ui?from=2026-04-01&to=2026-04-10`,
      { headers: { "Cf-Access-Jwt-Assertion": jwt } },
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('"from":"2026-04-01"');
    expect(body).toContain('"to":"2026-04-10"');
  });

  it("returns 400 when from > to", async () => {
    const jwt = await signAccessJwt({ email: "owner@example.com" });
    const res = await SELF.fetch(
      `${BASE}/ui?from=2026-04-10&to=2026-04-01`,
      { headers: { "Cf-Access-Jwt-Assertion": jwt } },
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when from is not an ISO date", async () => {
    const jwt = await signAccessJwt({ email: "owner@example.com" });
    const res = await SELF.fetch(`${BASE}/ui?from=not-a-date`, {
      headers: { "Cf-Access-Jwt-Assertion": jwt },
    });
    expect(res.status).toBe(400);
  });

  it("rejects ALLOW_LOCAL_JWKS=1 when ENVIRONMENT=production", async () => {
    const mut = testEnv as unknown as Record<string, string | undefined>;
    const origAllow = mut.ALLOW_LOCAL_JWKS;
    const origEnv = mut.ENVIRONMENT;
    try {
      mut.ALLOW_LOCAL_JWKS = "1";
      mut.ENVIRONMENT = "production";
      const res = await SELF.fetch(`${BASE}/ui`);
      expect(res.status).toBeGreaterThanOrEqual(500);
    } finally {
      mut.ALLOW_LOCAL_JWKS = origAllow;
      mut.ENVIRONMENT = origEnv;
    }
  });
});
