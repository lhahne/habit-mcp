import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";

let remoteJwks: JWTVerifyGetKey | undefined;
let jwksOverride: JWTVerifyGetKey | undefined;

export function __setJwksForTest(jwks: JWTVerifyGetKey | undefined): void {
  jwksOverride = jwks;
}

function getJwks(teamDomain: string): JWTVerifyGetKey {
  if (jwksOverride) return jwksOverride;
  if (!remoteJwks) {
    remoteJwks = createRemoteJWKSet(
      new URL(`https://${teamDomain}/cdn-cgi/access/certs`),
    );
  }
  return remoteJwks;
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
    const { payload } = await jwtVerify(jwt, getJwks(teamDomain), {
      issuer: `https://${teamDomain}`,
      audience,
    });
    const email = typeof payload.email === "string" ? payload.email : null;
    if (!email) return null;
    const allowedEmail = env.CF_ACCESS_ALLOWED_EMAIL;
    if (allowedEmail && email !== allowedEmail) return null;
    return email;
  } catch {
    return null;
  }
}
