import type { Context, Hono } from "hono";
import { z } from "zod";
import {
  pluginProjectIdSchema,
  pluginProjectSaveSchema,
  type PluginProjectFiles,
} from "@savia/studio-shared/plugin-projects";
import type { Env } from "./context";
import { fail } from "./context";
import type { PluginStoreOptions } from "./plugin-store";

import {
  encodePluginFilesJson,
  decodePluginFilesJson,
} from "./plugin-file-storage";

const MAX_PROJECTS_PER_SCOPE = 100;

type ProjectRow = {
  id: string;
  label?: string;
  files: string;
  history: string;
  version: number;
  updated_at: string;
};

function projectLabel(filesJson: string): string {
  try {
    const files = JSON.parse(filesJson) as PluginProjectFiles;
    const manifest = z
      .object({ label: z.string().trim().min(1).max(120) })
      .passthrough()
      .safeParse(JSON.parse(files["savia-extension.json"]));
    return manifest.success ? manifest.data.label : "Untitled plugin";
  } catch {
    return "Untitled plugin";
  }
}

async function toProject(row: ProjectRow) {
  return {
    id: row.id,
    files: JSON.parse(
      await decodePluginFilesJson(row.files),
    ) as PluginProjectFiles,
    history: JSON.parse(row.history) as Array<{
      role: "user" | "assistant";
      content: string;
    }>,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

async function requireProjectAdmin(
  c: Context<Env>,
  options: PluginStoreOptions,
  projectId: string,
) {
  const tenant = c.get("tenant");
  const principalId = c.get("principalId");
  if (
    typeof tenant !== "string" ||
    !tenant ||
    typeof principalId !== "string" ||
    !principalId
  )
    fail("Authentication is required.", 401);
  if (!options.canManageExtension)
    fail("Extension administration is not available.", 403);
  let allowed = false;
  try {
    allowed = await options.canManageExtension({
      tenantId: tenant,
      principalId,
      extensionId: projectId,
    });
  } catch {
    allowed = false;
  }
  if (!allowed) fail("Extension administration is required.", 403);
  return { tenant, principalId };
}

export function registerPluginProjects(
  app: Hono<Env>,
  options: PluginStoreOptions,
): void {
  app.get("/api/plugin-projects", async (c) => {
    const { tenant, principalId } = await requireProjectAdmin(
      c,
      options,
      "plugin-projects",
    );
    const result = await c.env.DB.prepare(
      `SELECT id,label,version,updated_at FROM plugin_authoring_projects
       WHERE tenant_id=? AND principal_id=? ORDER BY updated_at DESC,id`,
    )
      .bind(tenant, principalId)
      .all<ProjectRow>();
    return c.json({
      data: result.results.map((row) => ({
        id: row.id,
        label: row.label,
        version: row.version,
        updatedAt: row.updated_at,
      })),
    });
  });

  app.get("/api/plugin-projects/:id", async (c) => {
    const id = pluginProjectIdSchema.safeParse(c.req.param("id"));
    if (!id.success) return fail("Invalid project ID.", 400);
    const { tenant, principalId } = await requireProjectAdmin(
      c,
      options,
      id.data,
    );
    const row = await c.env.DB.prepare(
      `SELECT id,files,history,version,updated_at FROM plugin_authoring_projects
       WHERE tenant_id=? AND principal_id=? AND id=?`,
    )
      .bind(tenant, principalId, id.data)
      .first<ProjectRow>();
    if (!row) return fail("Plugin project not found.", 404);
    return c.json({ data: await toProject(row) });
  });

  app.put("/api/plugin-projects/:id", async (c) => {
    const id = pluginProjectIdSchema.safeParse(c.req.param("id"));
    if (!id.success) return fail("Invalid project ID.", 400);
    const { tenant, principalId } = await requireProjectAdmin(
      c,
      options,
      id.data,
    );
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return fail("Invalid JSON body.", 400);
    }
    const parsed = pluginProjectSaveSchema.safeParse(input);
    if (!parsed.success) return fail("Invalid plugin project.", 422);
    const now = new Date().toISOString();
    const filesJson = JSON.stringify(parsed.data.files);
    const label = projectLabel(filesJson);
    const storedFiles = await encodePluginFilesJson(filesJson);
    if (parsed.data.version === 0) {
      let inserted: { meta: { changes: number } };
      try {
        inserted = await c.env.DB.prepare(
          `INSERT INTO plugin_authoring_projects(tenant_id,principal_id,id,label,files,history,version,updated_at)
           SELECT ?,?,?,?,?,?,1,? WHERE
             (SELECT count(*) FROM plugin_authoring_projects WHERE tenant_id=? AND principal_id=?) < ?`,
        )
          .bind(
            tenant,
            principalId,
            id.data,
            label,
            storedFiles,
            JSON.stringify(parsed.data.history),
            now,
            tenant,
            principalId,
            MAX_PROJECTS_PER_SCOPE,
          )
          .run();
      } catch {
        return fail("Project ID already exists or the save conflicted.", 409);
      }
      if (inserted.meta.changes !== 1)
        return fail(
          "A principal can save at most 100 plugin projects per tenant.",
          409,
        );
    } else {
      const updated = await c.env.DB.prepare(
        `UPDATE plugin_authoring_projects SET label=?,files=?,history=?,version=version+1,
             updated_at=? WHERE tenant_id=? AND principal_id=? AND id=? AND version=?`,
      )
        .bind(
          label,
          storedFiles,
          JSON.stringify(parsed.data.history),
          now,
          tenant,
          principalId,
          id.data,
          parsed.data.version,
        )
        .run();
      if (updated.meta.changes !== 1)
        return fail("Plugin project version conflict.", 409);
    }
    return c.json({
      data: {
        id: id.data,
        files: parsed.data.files,
        history: parsed.data.history,
        version: parsed.data.version + 1,
        updatedAt: now,
      },
    });
  });

  app.delete("/api/plugin-projects/:id", async (c) => {
    const id = pluginProjectIdSchema.safeParse(c.req.param("id"));
    if (!id.success) return fail("Invalid project ID.", 400);
    const { tenant, principalId } = await requireProjectAdmin(
      c,
      options,
      id.data,
    );
    const rawVersion = c.req.query("version");
    const version = rawVersion === undefined ? NaN : Number(rawVersion);
    if (!Number.isSafeInteger(version) || version < 1)
      return fail("An explicit project version is required.", 400);
    const deleted = await c.env.DB.prepare(
      "DELETE FROM plugin_authoring_projects WHERE tenant_id=? AND principal_id=? AND id=? AND version=?",
    )
      .bind(tenant, principalId, id.data, version)
      .run();
    if (deleted.meta.changes !== 1) {
      const existing = await c.env.DB.prepare(
        "SELECT 1 FROM plugin_authoring_projects WHERE tenant_id=? AND principal_id=? AND id=?",
      )
        .bind(tenant, principalId, id.data)
        .first();
      if (!existing) return fail("Plugin project not found.", 404);
      return fail("Plugin project version conflict.", 409);
    }
    return c.body(null, 204);
  });
}
