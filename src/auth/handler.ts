import { verifyCfAccessJwt } from "./cf-access.js";
import { renderLoginPage } from "./login.html.js";
import { handleUiRequest } from "../ui/handler.js";

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const aa = new Uint8Array(da);
  const bb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < aa.length; i += 1) diff |= aa[i]! ^ bb[i]!;
  return diff === 0;
}

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
};

const TEXT_HEADERS = {
  "content-type": "text/plain; charset=utf-8",
  "cache-control": "no-store",
};

export const authHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return Response.json({ ok: true, service: "habit-mcp" });
    }

    if (url.pathname === "/ui") {
      return handleUiRequest(request, env);
    }

    if (url.pathname !== "/authorize") {
      return new Response("Not Found", { status: 404 });
    }

    const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    const clientInfo = await env.OAUTH_PROVIDER.lookupClient(
      oauthReqInfo.clientId,
    );
    if (!clientInfo) {
      return new Response("Unknown OAuth client.", { status: 400 });
    }

    // Once a request arrives with a Cloudflare Access header, the caller has
    // already authenticated at the edge. Never fall back to the password
    // form in that case — that's what caused the "double auth" UX where
    // users saw both the CF Access login and our own password prompt. If
    // the JWT can't be verified (misconfigured secrets, wrong audience,
    // email not on the allowlist), refuse with 401 instead.
    if (request.headers.has("Cf-Access-Jwt-Assertion")) {
      const cfAccessEmail = await verifyCfAccessJwt(request, env);
      if (!cfAccessEmail) {
        return new Response(
          "Unauthorized: Cloudflare Access token could not be verified.",
          { status: 401, headers: TEXT_HEADERS },
        );
      }
      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReqInfo,
        userId: "owner",
        metadata: { email: cfAccessEmail },
        scope: oauthReqInfo.scope.length > 0 ? oauthReqInfo.scope : ["mcp"],
        props: { userId: "owner", email: cfAccessEmail },
      });
      return Response.redirect(redirectTo, 302);
    }

    if (!env.AUTH_PASSWORD || env.AUTH_PASSWORD.length === 0) {
      return new Response(
        "Server misconfigured: AUTH_PASSWORD is not set.",
        { status: 500 },
      );
    }

    const actionUrl = `/authorize${url.search}`;

    if (request.method === "GET") {
      return new Response(
        renderLoginPage({
          actionUrl,
          clientName: clientInfo.clientName,
        }),
        { status: 200, headers: HTML_HEADERS },
      );
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const form = await request.formData();
    const submitted = String(form.get("password") ?? "");
    if (!(await timingSafeEqual(submitted, env.AUTH_PASSWORD))) {
      return new Response(
        renderLoginPage({
          actionUrl,
          clientName: clientInfo.clientName,
          error: "Incorrect password. Try again.",
        }),
        { status: 401, headers: HTML_HEADERS },
      );
    }

    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthReqInfo,
      userId: "owner",
      metadata: {},
      scope: oauthReqInfo.scope.length > 0 ? oauthReqInfo.scope : ["mcp"],
      props: { userId: "owner" },
    });

    return Response.redirect(redirectTo, 302);
  },
};
