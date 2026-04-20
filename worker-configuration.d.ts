interface Env {
  DB: D1Database;
  OAUTH_KV: KVNamespace;
  AUTH_PASSWORD: string;
  SESSION_COOKIE_NAME?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  CF_ACCESS_ALLOWED_EMAIL?: string;
  OAUTH_PROVIDER: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
}

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    OAUTH_KV: KVNamespace;
    AUTH_PASSWORD: string;
    SESSION_COOKIE_NAME?: string;
    CF_ACCESS_TEAM_DOMAIN?: string;
    CF_ACCESS_AUD?: string;
    CF_ACCESS_ALLOWED_EMAIL?: string;
    OAUTH_PROVIDER: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
  }
}
