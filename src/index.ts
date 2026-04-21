import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp";

import { authHandler } from "./auth/handler.js";
import { buildMcpServer } from "./tools.js";
import {
  vectorizeStore,
  workersAIEmbeddings,
} from "./vector/cloudflare.js";

function unsafeLocalJwksResponse(env: Env): Response | null {
  if (env.ALLOW_LOCAL_JWKS === "1" && env.ENVIRONMENT === "production") {
    console.error(
      "refusing to serve: ALLOW_LOCAL_JWKS must not be set in production",
    );
    return new Response("Server misconfigured", { status: 500 });
  }
  return null;
}

const mcpApiHandler = {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const bad = unsafeLocalJwksResponse(env);
    if (bad) return bad;
    const server = buildMcpServer({
      db: env.DB,
      store: vectorizeStore(env.VECTORIZE),
      embed: workersAIEmbeddings(env.AI),
    });
    const handler = createMcpHandler(server, {
      route: "/mcp",
      enableJsonResponse: true,
    });
    return handler(request, env, ctx);
  },
};

const guardedAuthHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const bad = unsafeLocalJwksResponse(env);
    if (bad) return bad;
    return authHandler.fetch(request, env);
  },
};

export default new OAuthProvider({
  apiHandlers: { "/mcp": mcpApiHandler },
  defaultHandler: guardedAuthHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["mcp"],
  accessTokenTTL: 60 * 60 * 24 * 365,
  allowPlainPKCE: false,
});
