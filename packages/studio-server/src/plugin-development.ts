import type { Hono, Context } from "hono";
import {
  pluginCatalogSchema,
  pluginDevelopmentCapabilitiesSchema,
} from "@savia/studio-shared/plugin-development";
import { pluginStoreManifestSchema } from "@savia/studio-shared/plugin-store";
import { compareSolutionVersions } from "@savia/studio-shared/solution-package";
import type { PluginStoreOptions } from "./plugin-store";
import { fail, type Env } from "./context";

export async function authorizePluginDevelopment(
  c: Context<Env>,
  options: PluginStoreOptions,
  operation: "capabilities" | "read" | "publish",
  extensionId = "*",
) {
  const access = options.pluginDevelopmentAccess;
  if (!access) fail("Plugin development is unavailable.", 404);
  if (!c.get("principalId")) fail("Authentication is required.", 401);
  const allowed =
    operation === "capabilities"
      ? access.read || access.publish
      : operation === "read"
        ? access.read
        : access.publish;
  if (!allowed) fail("This key does not grant the required plugin scope.", 403);
  let manages = false;
  try {
    manages = !!(await options.canManageExtension?.({
      tenantId: c.get("tenant"),
      principalId: c.get("principalId"),
      extensionId,
    }));
  } catch {
    /* fail closed */
  }
  if (!manages)
    fail("Current plugin administration permission is required.", 403);
  return access;
}
export function registerPluginDevelopment(
  app: Hono<Env>,
  options: PluginStoreOptions = {},
) {
  app.get("/api/plugin-development/capabilities", async (c) => {
    const access = await authorizePluginDevelopment(c, options, "capabilities");
    const tenantId = Number(c.get("tenant").replace(/^tenant:/, ""));
    return c.json(
      pluginDevelopmentCapabilitiesSchema.parse({
        schemaVersion: 1,
        compilerVersion: 1,
        tenantId,
        principalId: c.get("principalId"),
        workspaceLabel: access.workspaceLabel,
        read: access.read,
        destinations: access.publish
          ? [
              "tenant",
              ...(options.pluginRegistry?.publishToken ? ["shared"] : []),
            ]
          : [],
      }),
    );
  });
  app.get("/api/plugin-development/catalog", async (c) => {
    await authorizePluginDevelopment(c, options, "read");
    const tenant = c.get("tenant");
    const [artifacts, installed] = await c.env.DB.batch([
      c.env.DB.prepare(
        "SELECT a.id,a.version,a.manifest,a.sha256,a.created_at,CASE WHEN s.files IS NULL THEN 0 ELSE 1 END AS authored FROM plugin_store_artifacts a LEFT JOIN plugin_store_sources s ON s.tenant_id=a.tenant_id AND s.id=a.id AND s.version=a.version WHERE a.tenant_id=? ORDER BY a.id LIMIT 10001",
      ).bind(tenant),
      c.env.DB.prepare(
        "SELECT id,version FROM studio_extension_installations WHERE tenant_id=?",
      ).bind(tenant),
    ]);
    if (artifacts.results.length > 10000)
      fail("Plugin catalog exceeds its limit.", 413);
    const installedMap = new Map(
      (installed.results as { id: string; version: string }[]).map((row) => [
        row.id,
        row.version,
      ]),
    );
    const grouped = new Map<
      string,
      {
        pluginId: string;
        label: string;
        versions: {
          version: string;
          sha256: string;
          createdAt: string;
          authored: boolean;
        }[];
        head: { version: string; sha256: string };
        installedVersion: string | null;
      }
    >();
    for (const row of artifacts.results as {
      id: string;
      version: string;
      manifest: string;
      sha256: string;
      created_at: string;
      authored: number;
    }[]) {
      const manifest = pluginStoreManifestSchema.parse(
        JSON.parse(row.manifest),
      );
      let group = grouped.get(row.id);
      if (!group) {
        group = {
          pluginId: row.id,
          label: manifest.label,
          versions: [],
          head: { version: row.version, sha256: row.sha256 },
          installedVersion: installedMap.get(row.id) ?? null,
        };
        grouped.set(row.id, group);
      }
      group.versions.push({
        version: row.version,
        sha256: row.sha256,
        createdAt: row.created_at,
        authored: !!row.authored,
      });
      if (compareSolutionVersions(row.version, group.head.version) > 0) {
        group.head = { version: row.version, sha256: row.sha256 };
        group.label = manifest.label;
      }
    }
    for (const group of grouped.values())
      group.versions.sort((a, b) =>
        compareSolutionVersions(b.version, a.version),
      );
    return c.json(pluginCatalogSchema.parse([...grouped.values()]));
  });
  app.get("/api/plugin-development/:id/checkout", async (c) => {
    await authorizePluginDevelopment(c, options, "read", c.req.param("id"));
    return fail("Plugin checkout service is unavailable.", 502);
  });
  app.post("/api/plugin-development/:id/publish", async (c) => {
    await authorizePluginDevelopment(c, options, "publish", c.req.param("id"));
    return fail("Plugin publication service is unavailable.", 502);
  });
}
