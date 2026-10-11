import type { Context, Hono } from "hono";
import { z } from "zod";
import { fail, type Env } from "./context";
import type { PluginStoreOptions } from "./plugin-store";
import {
  EDITOR_EXTENSION_MAX_COMPRESSED_BYTES,
  getOpenVsxVersion,
  searchOpenVsx,
  downloadOpenVsxVsix,
} from "./plugin-editor-marketplace";
import {
  cleanupEditorExtensionObjects,
  expireEditorExtensionInspections,
  findOwnedEditorExtension,
  installStagedEditorExtension,
  listOwnedEditorExtensions,
  readOwnedEditorExtensionPackage,
  stageEditorExtensionInspection,
  uninstallOwnedEditorExtension,
} from "./plugin-editor-extension-artifacts";
import { PLUGIN_EDITOR_VSCODE_VERSION } from "@savia/studio-shared/plugin-editor-extensions";
import { EditorVsixError } from "@savia/studio-shared/plugin-editor-vsix";

const openVsxInspectSchema = z
  .object({
    source: z.literal("open-vsx"),
    publisher: z.string().min(1).max(100),
    name: z.string().min(1).max(100),
    version: z.string().min(1).max(100),
  })
  .strict();
const installSchema = z.object({ inspectionId: z.string().uuid() }).strict();

function mapError(error: unknown): never {
  if (error instanceof EditorVsixError) return fail(error.message, 422);
  const status =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status: unknown }).status)
      : 502;
  if ([400, 401, 403, 404, 409, 413, 422, 429, 502].includes(status))
    return fail(
      error instanceof Error
        ? error.message
        : "Editor extension request failed.",
      status as 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 502,
    );
  return fail(
    error instanceof Error ? error.message : "Editor extension service failed.",
    502,
  );
}

async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes)
    return fail("VSIX exceeds the 20 MiB upload limit.", 413);
  if (!request.body) return fail("VSIX request body is required.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return fail("VSIX exceeds the 20 MiB upload limit.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function requireManager(c: Context<Env>, options: PluginStoreOptions) {
  const tenantId = c.get("tenant");
  const principalId = c.get("principalId");
  if (
    typeof tenantId !== "string" ||
    !tenantId ||
    typeof principalId !== "string" ||
    !principalId
  )
    return fail("Authentication is required.", 401);
  if (!options.canManageExtension)
    return fail("Extension administration is not available.", 403);
  let allowed = false;
  try {
    allowed = await options.canManageExtension({
      tenantId,
      principalId,
      extensionId: "plugin-editor-extensions",
    });
  } catch {
    allowed = false;
  }
  if (!allowed) return fail("Extension administration is required.", 403);
  return { tenantId, principalId };
}

export function registerPluginEditorExtensions(
  app: Hono<Env>,
  options: PluginStoreOptions,
): void {
  app.get("/api/plugin-editor-extensions/marketplace", async (c) => {
    await requireManager(c, options);
    const query = c.req.query("q") ?? "";
    const offsetText = c.req.query("offset") ?? "0";
    const offset = /^\d{1,9}$/.test(offsetText) ? Number(offsetText) : -1;
    if (query.length > 200 || !Number.isSafeInteger(offset) || offset < 0)
      return fail(
        "Marketplace query must be at most 200 characters and offset must be non-negative.",
        400,
      );
    try {
      return c.json(await searchOpenVsx(query, offset));
    } catch (error) {
      return mapError(error);
    }
  });

  app.get(
    "/api/plugin-editor-extensions/marketplace/:publisher/:name/:version",
    async (c) => {
      await requireManager(c, options);
      try {
        const item = await getOpenVsxVersion(
          c.req.param("publisher"),
          c.req.param("name"),
          c.req.param("version"),
        );
        const { downloadUrl: _downloadUrl, ...metadata } = item;
        return c.json(metadata);
      } catch (error) {
        return mapError(error);
      }
    },
  );

  app.post("/api/plugin-editor-extensions/inspect", async (c) => {
    const scope = await requireManager(c, options);
    await cleanupEditorExtensionObjects(c.env.DB, c.env.FILES, scope);
    await expireEditorExtensionInspections(c.env.DB, c.env.FILES, scope);
    const source = c.req.query("source");
    try {
      if (source === "vsix") {
        const fileName = c.req.query("fileName") ?? "";
        if (
          !fileName ||
          fileName.length > 255 ||
          /[\\/\x00-\x1f]/.test(fileName) ||
          !fileName.toLowerCase().endsWith(".vsix")
        )
          return fail("A valid .vsix fileName is required.", 400);
        const contentType = c.req
          .header("content-type")
          ?.split(";")[0]
          .trim()
          .toLowerCase();
        if (
          contentType !== "application/octet-stream" &&
          contentType !== "application/zip"
        )
          return fail(
            "VSIX upload must use application/octet-stream or application/zip.",
            400,
          );
        const bytes = await readBoundedBody(
          c.req.raw,
          EDITOR_EXTENSION_MAX_COMPRESSED_BYTES,
        );
        const inspection = await stageEditorExtensionInspection(
          c.env.DB,
          c.env.FILES,
          scope,
          {
            bytes,
            source: "vsix",
            runtimeVersion: PLUGIN_EDITOR_VSCODE_VERSION,
          },
        );
        return c.json(inspection, 201);
      }
      const parsed = openVsxInspectSchema.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!parsed.success)
        return fail(
          "Open VSX inspection requires publisher, name, and exact version.",
          400,
        );
      const metadata = await getOpenVsxVersion(
        parsed.data.publisher,
        parsed.data.name,
        parsed.data.version,
      );
      const bytes = await downloadOpenVsxVsix(metadata);
      const inspection = await stageEditorExtensionInspection(
        c.env.DB,
        c.env.FILES,
        scope,
        {
          bytes,
          source: "open-vsx",
          runtimeVersion: PLUGIN_EDITOR_VSCODE_VERSION,
        },
      );
      return c.json(inspection, 201);
    } catch (error) {
      return mapError(error);
    }
  });

  app.post("/api/plugin-editor-extensions/install", async (c) => {
    const scope = await requireManager(c, options);
    const parsed = installSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return fail("A valid inspectionId is required.", 400);
    try {
      return c.json(
        {
          installation: await installStagedEditorExtension(
            c.env.DB,
            c.env.FILES,
            scope,
            parsed.data.inspectionId,
          ),
        },
        201,
      );
    } catch (error) {
      return mapError(error);
    }
  });

  app.get("/api/plugin-editor-extensions/installed", async (c) => {
    const scope = await requireManager(c, options);
    await cleanupEditorExtensionObjects(c.env.DB, c.env.FILES, scope);
    await expireEditorExtensionInspections(c.env.DB, c.env.FILES, scope);
    return c.json({
      installations: await listOwnedEditorExtensions(c.env.DB, scope),
    });
  });

  app.get(
    "/api/plugin-editor-extensions/installed/:installationId/package",
    async (c) => {
      const scope = await requireManager(c, options);
      const installation = await findOwnedEditorExtension(c.env.DB, {
        ...scope,
        installationId: c.req.param("installationId"),
      });
      if (!installation) return fail("Installed extension not found.", 404);
      const object = await readOwnedEditorExtensionPackage(
        c.env.DB,
        c.env.FILES,
        { ...scope, installationId: installation.installationId },
      );
      if (!object) return fail("Installed extension package is missing.", 404);
      return c.body(object.body, 200, {
        "content-type": "application/zip",
        "content-length": String(object.size),
        "content-disposition": `attachment; filename="${installation.publisher}.${installation.name}-${installation.version}.vsix"`,
        "cache-control": "private, no-store",
        "x-content-sha256": installation.sha256,
        "x-content-type-options": "nosniff",
      });
    },
  );

  app.delete(
    "/api/plugin-editor-extensions/installed/:installationId",
    async (c) => {
      const scope = await requireManager(c, options);
      const result = await uninstallOwnedEditorExtension(
        c.env.DB,
        c.env.FILES,
        { ...scope, installationId: c.req.param("installationId") },
      );
      if (!result.removed && result.projectIds)
        return c.json(
          {
            error: "Extension is referenced by projects.",
            projectIds: result.projectIds,
          },
          409,
        );
      if (!result.removed) return fail("Installed extension not found.", 404);
      return c.body(null, 204);
    },
  );
}
