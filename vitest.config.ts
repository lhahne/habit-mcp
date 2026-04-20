import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrations = await readD1Migrations(path.join(here, "migrations"));

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      miniflare: {
        compatibilityDate: "2025-10-01",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        kvNamespaces: ["OAUTH_KV"],
        bindings: {
          AUTH_PASSWORD: "test-password",
          SESSION_COOKIE_NAME: "habit_mcp_session",
          CF_ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com",
          CF_ACCESS_AUD: "test-aud",
          CF_ACCESS_ALLOWED_EMAIL: "owner@example.com",
          TEST_MIGRATIONS: migrations,
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
    isolate: true,
  },
});
