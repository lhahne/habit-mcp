import { spawn } from "node:child_process";
import { rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportJWK, generateKeyPair } from "jose";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1" },
    });
    let err = "";
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

export default async function globalSetup(): Promise<void> {
  await rm(path.join(repoRoot, ".wrangler"), { recursive: true, force: true });

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
  ]);
}
