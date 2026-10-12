import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { createStudioApp } from "../../../../packages/studio-server/src/index";
import { migrationStatements } from "../../../../packages/studio-server/test/migration-statements";
import {
  parsePluginStoreZip,
  persistParsedStoreArtifact,
} from "../../../../packages/studio-server/src/plugin-store";
import { encodeStoredZip } from "@savia/plugin-authoring/zip";
export async function startHostFixture(repo: string) {
  const platform = await getPlatformProxy<{
    DB: D1Database;
    POC_LOCAL: string;
    FILES: R2Bucket;
  }>({
    configPath: join(repo, "packages/studio-server/wrangler.jsonc"),
    persist: false,
  });
  for (const file of readdirSync(
    join(repo, "packages/studio-server/migrations"),
  )
    .filter((file) => file.endsWith(".sql"))
    .sort())
    for (const statement of migrationStatements(
      readFileSync(
        join(repo, "packages/studio-server/migrations", file),
        "utf8",
      ),
    ))
      await platform.env.DB.prepare(statement).run();
  const key = "savia_pat_local_host_" + randomUUID().replaceAll("-", "");
  const manifest = {
    format: "savia.extension",
    formatVersion: 1,
    id: "custom.host-proof",
    version: "1.0.0",
    label: "Host proof",
    description: "Disposable local fixture",
    requires: [],
    apiVersion: 1,
  };
  const source = 'export function render(el) { el.textContent="Before"; }';
  const bytes = encodeStoredZip([
    { name: "savia-extension.json", data: JSON.stringify(manifest) },
    { name: "dist/plugin.js", data: source },
    { name: "src/entry.tsx", data: source },
  ]);
  await persistParsedStoreArtifact(
    platform.env.DB,
    "tenant:12",
    "local-operator",
    await parsePluginStoreZip(bytes),
  );
  const app = createStudioApp("tenant:12", {
    principalId: "local-operator",
    pluginDevelopmentAccess: {
      workspaceLabel: "Local isolated fixture",
      read: true,
      publish: true,
    },
    canManageExtension: () => true,
  });
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.authorization !== `Bearer ${key}`) {
        res.writeHead(401);
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 6 * 1024 * 1024 + 64 * 1024) {
          res.writeHead(413);
          res.end();
          return;
        }
        chunks.push(chunk);
      }
      const url = new URL(req.url!, "http://localhost");
      url.pathname = url.pathname.replace(/^\/v1\/studio\/12/, "");
      const response = await app.fetch(
        new Request(url, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          ...(!["GET", "HEAD"].includes(req.method!)
            ? { body: Buffer.concat(chunks) }
            : {}),
        }),
        platform.env,
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return {
    origin: `http://127.0.0.1:${address.port}`,
    key,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await platform.dispose();
    },
  };
}
