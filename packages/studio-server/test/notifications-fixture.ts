import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";

export async function notificationFixture() {
  const platform = await getPlatformProxy<{ DB: D1Database }>({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  for (const name of readdirSync("migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    for (const sql of readFileSync(`migrations/${name}`, "utf8")
      .split(/;(?!(?:\s*END\b))/i)
      .filter((s) => s.trim()))
      await platform.env.DB.prepare(sql).run();
  }
  return { db: platform.env.DB, dispose: () => platform.dispose() };
}
