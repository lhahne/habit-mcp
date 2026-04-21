import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";
import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM check_ins"),
    env.DB.prepare("DELETE FROM days"),
    env.DB.prepare("DELETE FROM habits"),
    env.DB.prepare("DELETE FROM text_chunks"),
    env.DB.prepare("DELETE FROM sqlite_sequence WHERE name = 'habits'"),
  ]);
  for (const key of await listAll(env.OAUTH_KV)) {
    await env.OAUTH_KV.delete(key);
  }
});

async function listAll(kv: KVNamespace): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page: KVNamespaceListResult<unknown, string> = await kv.list(
      cursor ? { cursor } : {},
    );
    for (const k of page.keys) keys.push(k.name);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}
