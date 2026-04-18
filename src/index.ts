import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp";

import { authHandler } from "./auth/handler.js";
import { buildMcpServer } from "./tools.js";

const mcpApiHandler = {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const handler = createMcpHandler(buildMcpServer(env.DB), {
      route: "/mcp",
      enableJsonResponse: true,
    });
    return handler(request, env, ctx);
  },
};

export default new OAuthProvider({
  apiHandlers: { "/mcp": mcpApiHandler },
  defaultHandler: authHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["mcp"],
  accessTokenTTL: 60 * 60 * 24 * 365,
  allowPlainPKCE: false,
});
