import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from "jose";

const remoteJwksByDomain = new Map<string, JWTVerifyGetKey>();
const localJwksByJson = new Map<string, JWTVerifyGetKey>();
let jwksOverride: JWTVerifyGetKey | undefined;

export function __setJwksForTest(jwks: JWTVerifyGetKey | undefined): void {
  jwksOverride = jwks;
}

function getLocalJwks(json: string): JWTVerifyGetKey {
  let cached = localJwksByJson.get(json);
  if (!cached) {
    cached = createLocalJWKSet(JSON.parse(json) as JSONWebKeySet);
    localJwksByJson.set(json, cached);
  }
  return cached;
}

function getJwks(teamDomain: string, env: Env): JWTVerifyGetKey {
  if (jwksOverride) return jwksOverride;
  if (env.ALLOW_LOCAL_JWKS === "1" && env.CF_ACCESS_JWKS_JSON_DEV) {
    return getLocalJwks(env.CF_ACCESS_JWKS_JSON_DEV);
  }
  let cached = remoteJwksByDomain.get(teamDomain);
  if (!cached) {
    cached = createRemoteJWKSet(
      new URL(`https://${teamDomain}/cdn-cgi/access/certs`),
    );
    remoteJwksByDomain.set(teamDomain, cached);
  }
  return cached;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export async function verifyCfAccessJwt(
  request: Request,
  env: Env,
): Promise<string | null> {
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!jwt) return null;

  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN;
  const audience = env.CF_ACCESS_AUD;
  if (!teamDomain || !audience) return null;

  try {
    const { payload } = await jwtVerify(jwt, getJwks(teamDomain, env), {
      issuer: `https://${teamDomain}`,
      audience,
    });
    const rawEmail =
      typeof payload.email === "string" ? payload.email : null;
    if (!rawEmail) return null;
    const email = normalizeEmail(rawEmail);
    const allowedEmail = env.CF_ACCESS_ALLOWED_EMAIL;
    if (allowedEmail && email !== normalizeEmail(allowedEmail)) return null;
    return email;
  } catch {
    return null;
  }
}
