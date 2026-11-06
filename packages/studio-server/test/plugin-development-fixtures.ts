import { getPlatformProxy } from "wrangler";
import { readdirSync, readFileSync } from "node:fs";
import { migrationStatements } from "./migration-statements";
import { createStudioApp } from "../src/index";
import type { PluginStoreOptions } from "../src/plugin-store";
export async function developmentFixture() {
  const platform = await getPlatformProxy<{
    DB: D1Database;
    POC_LOCAL: string;
    FILES: R2Bucket;
  }>({ configPath: "wrangler.jsonc", persist: false });
  for (const file of readdirSync("migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    for (const sql of migrationStatements(
      readFileSync(`migrations/${file}`, "utf8"),
    ))
      await platform.env.DB.prepare(sql).run();
  return {
    db: platform.env.DB,
    dispose: () => platform.dispose(),
    request(
      path: string,
      options: PluginStoreOptions = {},
      init: RequestInit = {},
      tenant = "tenant:12",
    ) {
      const app = createStudioApp(tenant, {
        principalId: "author",
        ...options,
      });
      return app.fetch(
        new Request(`https://savia.test/api/plugin-development${path}`, init),
        platform.env,
      );
    },
  };
}
export const readAccess = {
  workspaceLabel: "Workspace 12",
  read: true,
  publish: false,
};
export const fullAccess = { ...readAccess, publish: true };
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "custom.example",
  version: "1.0.0",
  label: "Example",
  description: "",
  requires: [],
  apiVersion: 1,
};
export async function seedDevelopmentArtifact(
  db: D1Database,
  tenant = "tenant:12",
  version = "1.0.0",
) {
  await db
    .prepare(
      "INSERT INTO plugin_store_artifacts (tenant_id,id,version,manifest,entry_js,sha256,size_bytes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      tenant,
      manifest.id,
      version,
      JSON.stringify({ ...manifest, version }),
      "export function render() {}",
      "a".repeat(64),
      100,
      "author",
      "2026-10-12T00:00:00Z",
    )
    .run();
}
