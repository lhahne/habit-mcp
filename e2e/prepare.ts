// Runs once before `playwright test`. Wipes only the e2e-scoped local
// Wrangler state so each e2e run starts from a clean DB, generates a
// fresh signing key, writes the public JWKS into .dev.vars.e2e (loaded
// by `wrangler dev --env e2e`), and re-applies migrations against the
// freshly created local D1.
//
// Kept as a separate `node` step (not a Playwright globalSetup) because
// Playwright launches the webServer concurrently with globalSetup,
// which would race our cleanup against wrangler dev's bundle directory.

import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportJWK, generateKeyPair } from "jose";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

// Use a dedicated persistence root for e2e so cleanup never touches the
// dev `.wrangler/` dir. Both `wrangler dev --env e2e` (in
// playwright.config.ts) and the migrations apply below pass
// `--persist-to <PERSIST_DIR>`.
const PERSIST_DIR = path.join(repoRoot, ".wrangler-e2e");

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1" },
    });
    let err = "";
    // Drain both pipes so a chatty child can't fill its OS pipe buffer
    // and stall the spawn.
    p.stdout.on("data", () => {});
    p.stderr.on("data", (b) => {
      err += b.toString();
    });
    p.on("error", reject);
    p.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}\n${err}`));
    });
  });
}

async function main(): Promise<void> {
  await rm(PERSIST_DIR, { recursive: true, force: true });

  const { publicKey, privateKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const publicJwk = await exportJWK(publicKey);
  const privateJwk = await exportJWK(privateKey);
  publicJwk.kid = "e2e-key";
  publicJwk.alg = "RS256";
  privateJwk.kid = "e2e-key";
  privateJwk.alg = "RS256";

  const publicJwks = JSON.stringify({ keys: [publicJwk] });

  const devVars = [
    `AUTH_PASSWORD=e2e-unused`,
    `CF_ACCESS_JWKS_JSON_DEV=${publicJwks}`,
  ].join("\n");
  await writeFile(path.join(repoRoot, ".dev.vars.e2e"), devVars + "\n");

  await mkdir(path.join(here, ".state"), { recursive: true });
  await writeFile(
    path.join(here, ".state", "private-jwk.json"),
    JSON.stringify(privateJwk),
  );

  await run("npx", [
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "DB",
    "--env",
    "e2e",
    "--local",
    "--persist-to",
    PERSIST_DIR,
  ]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
