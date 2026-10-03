import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import type { Context } from "hono";
import { actorFromContext } from "../auth/middleware";
import { PagesError, PagesService } from "../pages/service";
import { exportPages, importPages } from "../pages/transfer";

const errorResponse = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
const idParam = z.object({ id: z.string().trim().min(1).max(128) });
const versionParam = idParam.extend({
  version: z.coerce.number().int().positive(),
});
const pageContentSchema = z.array(z.unknown());
const bindingSchema = z
  .object({
    domain: z.string().regex(/^\/v1\/studio\/(0|[1-9][0-9]*)$/),
    collection: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/),
    recordId: z.string().min(1).max(128),
  })
  .strict();
const pageSummarySchema = z.object({
  kind: z.enum(["page", "folder"]),
  id: z.string(),
  parentId: z.string().nullable(),
  rootId: z.string(),
  title: z.string(),
  version: z.number().int(),
  updatedAt: z.string(),
  ownerId: z.string(),
  role: z.enum(["owner", "editor", "reader"]),
  isShared: z.boolean(),
  binding: bindingSchema.nullable(),
  excerpt: z.string().max(360).optional(),
});
const pageDocumentSchema = pageSummarySchema.extend({
  content: z.array(z.record(z.string(), z.unknown())),
});
const pageRevisionSchema = z.object({
  id: z.string(),
  version: z.number().int(),
  title: z.string(),
  createdAt: z.string(),
});
const pageMemberSchema = z.object({
  principalId: z.string(),
  displayName: z.string(),
  email: z.string(),
});
const pageSharesSchema = z.object({
  rootId: z.string(),
  version: z.number().int(),
  shares: z.array(
    z.object({ principalId: z.string(), role: z.enum(["reader", "editor"]) }),
  ),
});
const pageFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
});
const transferPageSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  title: z.string(),
  kind: z.enum(["page", "folder"]),
  content: z.array(z.record(z.string(), z.unknown())),
});
const transferFileSchema = z.object({
  id: z.string(),
  pageId: z.string(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
  data: z.string(),
});
const archiveSchema = z.object({
  format: z.literal("savia-pages"),
  version: z.literal(1),
  exportedAt: z.string(),
  pages: z.array(transferPageSchema),
  files: z.array(transferFileSchema),
});
const importArchiveSchema = archiveSchema.strict();
const envelope = <T extends z.ZodType>(schema: T) => z.object({ data: schema });
const shareSchema = z.object({
  principalId: z.string().trim().min(1).max(128),
  role: z.enum(["reader", "editor"]),
});
const shareInputSchema = z
  .object({
    version: z.number().int().positive(),
    shares: z.array(shareSchema).max(200),
  })
  .strict();
const apiSecurity = [{ oauth2: ["savia.api.read"] }];
const writeSecurity = [{ oauth2: ["savia.api.write"] }];
const response = <T extends z.ZodType>(schema: T, description: string) => ({
  200: {
    content: { "application/json": { schema: envelope(schema) } },
    description,
  },
  400: {
    content: { "application/json": { schema: errorResponse } },
    description: "Invalid request",
  },
  404: {
    content: { "application/json": { schema: errorResponse } },
    description: "Page not found",
  },
  409: {
    content: { "application/json": { schema: errorResponse } },
    description: "Version conflict",
  },
});

const exportRoute = createRoute({
  method: "get",
  path: "/v1/pages/export",
  tags: ["Pages"],
  summary: "Export all pages owned by the caller with referenced attachments",
  security: apiSecurity,
  responses: {
    200: {
      content: { "application/json": { schema: envelope(archiveSchema) } },
      description: "Portable Pages archive",
    },
    409: {
      content: { "application/json": { schema: errorResponse } },
      description: "Export source changed or contains unavailable content",
    },
    413: {
      content: { "application/json": { schema: errorResponse } },
      description: "Archive exceeds the size limit",
    },
    503: {
      content: { "application/json": { schema: errorResponse } },
      description: "Attachment storage is unavailable",
    },
  },
});
const importRoute = createRoute({
  method: "post",
  path: "/v1/pages/import",
  tags: ["Pages"],
  summary: "Import a portable Pages archive as private copies",
  security: writeSecurity,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: importArchiveSchema } },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: envelope(
            z.object({
              pages: z.number().int(),
              folders: z.number().int(),
              files: z.number().int(),
            }),
          ),
        },
      },
      description: "Imported private copies",
    },
    400: {
      content: { "application/json": { schema: errorResponse } },
      description: "Archive is invalid",
    },
    413: {
      content: { "application/json": { schema: errorResponse } },
      description: "Archive exceeds the size limit",
    },
    503: {
      content: { "application/json": { schema: errorResponse } },
      description: "Attachment storage is unavailable",
    },
  },
});

const listRoute = createRoute({
  method: "get",
  path: "/v1/pages",
  tags: ["Pages"],
  summary: "List pages accessible to the caller",
  security: apiSecurity,
  request: { query: z.object({ q: z.string().max(200).optional() }) },
  responses: response(z.array(pageSummarySchema), "Accessible page summaries"),
});
const createRouteDefinition = createRoute({
  method: "post",
  path: "/v1/pages",
  tags: ["Pages"],
  summary: "Create a private page or folder, optionally nested",
  security: writeSecurity,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              title: z.string().trim().min(1).max(200),
              kind: z.enum(["page", "folder"]).optional(),
              parentId: z.string().min(1).max(128).optional(),
              binding: bindingSchema.nullable().optional(),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    ...response(pageDocumentSchema, "Created page document"),
    201: {
      content: { "application/json": { schema: envelope(pageDocumentSchema) } },
      description: "Created page document",
    },
  },
});
const membersRoute = createRoute({
  method: "get",
  path: "/v1/pages/members",
  tags: ["Pages"],
  summary: "List active members of the caller's tenant",
  security: apiSecurity,
  request: { query: z.object({ q: z.string().max(200).optional() }) },
  responses: response(z.array(pageMemberSchema), "Safe member summaries"),
});
const getRoute = createRoute({
  method: "get",
  path: "/v1/pages/{id}",
  tags: ["Pages"],
  summary: "Get a page document",
  security: apiSecurity,
  request: { params: idParam },
  responses: response(pageDocumentSchema, "Page document"),
});
const saveRoute = createRoute({
  method: "put",
  path: "/v1/pages/{id}",
  tags: ["Pages"],
  summary: "Save a page document using version compare-and-swap",
  security: writeSecurity,
  request: {
    params: idParam,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              title: z.string().trim().min(1).max(200),
              content: pageContentSchema,
              version: z.number().int().positive(),
            })
            .strict(),
        },
      },
    },
  },
  responses: response(pageDocumentSchema, "Saved page document"),
});
const deleteRoute = createRoute({
  method: "delete",
  path: "/v1/pages/{id}",
  tags: ["Pages"],
  summary: "Delete a page with no children",
  security: writeSecurity,
  request: {
    params: idParam,
    query: z.object({ version: z.coerce.number().int().positive().optional() }),
  },
  responses: response(z.object({ deleted: z.boolean() }), "Page deleted"),
});
const revisionsRoute = createRoute({
  method: "get",
  path: "/v1/pages/{id}/revisions",
  tags: ["Pages"],
  summary: "List page revisions",
  security: apiSecurity,
  request: { params: idParam },
  responses: response(z.array(pageRevisionSchema), "Page revision summaries"),
});
const deleteRevisionRoute = createRoute({
  method: "delete",
  path: "/v1/pages/{id}/revisions",
  tags: ["Pages"],
  summary: "Delete historical page revisions",
  security: writeSecurity,
  request: {
    params: idParam,
    query: z.object({ version: z.coerce.number().int().positive() }),
  },
  responses: response(
    z.object({ deleted: z.boolean() }),
    "Historical revisions deleted",
  ),
});
const revisionRoute = createRoute({
  method: "get",
  path: "/v1/pages/{id}/revisions/{version}",
  tags: ["Pages"],
  summary: "Get a page revision",
  security: apiSecurity,
  request: { params: versionParam },
  responses: response(pageDocumentSchema, "Page revision document"),
});
const restoreRoute = createRoute({
  method: "post",
  path: "/v1/pages/{id}/restore",
  tags: ["Pages"],
  summary: "Restore a revision as a new page version",
  security: writeSecurity,
  request: {
    params: idParam,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              revision: z.number().int().positive(),
              version: z.number().int().positive(),
            })
            .strict(),
        },
      },
    },
  },
  responses: response(pageDocumentSchema, "Restored page document"),
});
const sharesRoute = createRoute({
  method: "get",
  path: "/v1/pages/{id}/shares",
  tags: ["Pages"],
  summary: "Get root page shares",
  security: apiSecurity,
  request: { params: idParam },
  responses: response(pageSharesSchema, "Root shares and share-set version"),
});
const updateSharesRoute = createRoute({
  method: "put",
  path: "/v1/pages/{id}/shares",
  tags: ["Pages"],
  summary: "Replace root page shares using version compare-and-swap",
  security: writeSecurity,
  request: {
    params: idParam,
    body: {
      required: true,
      content: { "application/json": { schema: shareInputSchema } },
    },
  },
  responses: response(pageSharesSchema, "Updated root shares"),
});
const uploadFileRoute = createRoute({
  method: "post",
  path: "/v1/pages/{id}/files",
  tags: ["Pages"],
  summary: "Upload a page attachment",
  security: writeSecurity,
  request: {
    params: idParam,
    body: {
      required: true,
      content: {
        "multipart/form-data": { schema: z.object({ file: z.any() }) },
      },
    },
  },
  responses: {
    ...response(pageFileSchema, "Uploaded attachment"),
    201: {
      content: { "application/json": { schema: envelope(pageFileSchema) } },
      description: "Uploaded attachment",
    },
  },
});
const getFileRoute = createRoute({
  method: "get",
  path: "/v1/pages/{id}/files/{fileId}",
  tags: ["Pages"],
  summary: "Download an authorized page attachment",
  security: apiSecurity,
  request: {
    params: z.object({
      id: z.string().min(1).max(128),
      fileId: z.string().min(1).max(128),
    }),
  },
  responses: {
    200: {
      content: {
        "application/octet-stream": {
          schema: z.string().openapi({ format: "binary" }),
        },
      },
      description: "Attachment bytes",
    },
    404: {
      content: { "application/json": { schema: errorResponse } },
      description: "File not found",
    },
  },
});

const json = (data: unknown, status = 200) =>
  Response.json({ data }, { status, headers: { "cache-control": "no-store" } });
const error = (failure: PagesError) =>
  Response.json(
    { error: { code: failure.code, message: failure.message } },
    { status: failure.status, headers: { "cache-control": "no-store" } },
  );
const requiredParam = (c: Context, name: string) => {
  const value = c.req.param(name);
  if (!value) throw new PagesError(404, "PAGE_NOT_FOUND", "Page not found");
  return value;
};

async function run<T>(
  operation: () => Promise<T>,
  status = 200,
): Promise<Response> {
  try {
    return json(await operation(), status);
  } catch (failure) {
    if (failure instanceof PagesError) return error(failure);
    throw failure;
  }
}

async function requestBody<T>(context: {
  req: { json(): Promise<unknown> };
}): Promise<T> {
  const value = await context.req.json().catch(() => undefined);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PagesError(
      400,
      "INVALID_JSON",
      "Request body must be a JSON object",
    );
  return value as T;
}

async function withBody<T>(
  c: Context,
  operation: (input: T) => Promise<Response>,
): Promise<Response> {
  try {
    return await operation(await requestBody<T>(c));
  } catch (failure) {
    if (failure instanceof PagesError) return error(failure);
    throw failure;
  }
}

export function registerPagesRoutes(
  app: OpenAPIHono,
  db: D1Database,
  documents?: R2Bucket,
) {
  const service = (context: Context) =>
    new PagesService(db, actorFromContext(context));
  app.use(
    "/v1/pages/import",
    bodyLimit({
      maxSize: 50 * 1024 * 1024,
      onError: () =>
        error(
          new PagesError(
            413,
            "ARCHIVE_TOO_LARGE",
            "The Pages archive exceeds the 50 MB limit",
          ),
        ),
    }),
  );
  const noStore = async (c: Context, next: () => Promise<void>) => {
    await next();
    c.header("cache-control", "no-store");
  };
  app.use("/v1/pages", noStore);
  app.use("/v1/pages/*", noStore);

  const register = (
    route: unknown,
    handler: (context: Context) => Promise<Response>,
  ) => app.openapi(route as never, handler as never);
  register(exportRoute, (c) =>
    run(() => exportPages(db, actorFromContext(c), documents)),
  );
  register(importRoute, (c) =>
    withBody<unknown>(c, (input) =>
      run(() => importPages(db, actorFromContext(c), documents, input)),
    ),
  );
  register(listRoute, (c) =>
    run(() => service(c).list(c.req.query("q") ?? "")),
  );
  register(createRouteDefinition, (c) =>
    withBody<{
      title: string;
      kind?: "page" | "folder";
      parentId?: string;
      binding?: unknown;
    }>(c, (input) => run(() => service(c).create(input), 201)),
  );
  register(membersRoute, (c) =>
    run(() => service(c).members(c.req.query("q") ?? "")),
  );
  register(getRoute, (c) => run(() => service(c).get(requiredParam(c, "id"))));
  register(saveRoute, (c) =>
    withBody<{ title: string; content: unknown; version: number }>(c, (input) =>
      run(() => service(c).save(requiredParam(c, "id"), input)),
    ),
  );
  register(deleteRoute, (c) =>
    run(async () => {
      const rawVersion = c.req.query("version");
      const fileKeys = await service(c).remove(
        requiredParam(c, "id"),
        rawVersion === undefined ? undefined : Number(rawVersion),
      );
      const fileBucket = documents;
      if (fileBucket)
        await Promise.allSettled(fileKeys.map((key) => fileBucket.delete(key)));
      return { deleted: true };
    }),
  );
  register(revisionsRoute, (c) =>
    run(() => service(c).revisions(requiredParam(c, "id"))),
  );
  register(deleteRevisionRoute, (c) =>
    run(() =>
      service(c).clearHistory(
        requiredParam(c, "id"),
        Number(c.req.query("version")),
      ),
    ),
  );
  register(revisionRoute, (c) =>
    run(() =>
      service(c).revision(
        requiredParam(c, "id"),
        Number(requiredParam(c, "version")),
      ),
    ),
  );
  register(restoreRoute, (c) =>
    withBody<{ revision: number; version: number }>(c, (input) =>
      run(() => service(c).restore(requiredParam(c, "id"), input)),
    ),
  );
  register(sharesRoute, (c) =>
    run(() => service(c).shares(requiredParam(c, "id"))),
  );
  register(updateSharesRoute, (c) =>
    withBody<{
      shares: Array<{ principalId: string; role: "reader" | "editor" }>;
      version: number;
    }>(c, (input) =>
      run(() => service(c).setShares(requiredParam(c, "id"), input)),
    ),
  );
  register(uploadFileRoute, async (c) => {
    const fileBucket = documents;
    if (!fileBucket)
      return error(
        new PagesError(
          503,
          "FILE_STORAGE_UNAVAILABLE",
          "Page file storage is not configured",
        ),
      );
    try {
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File))
        throw new PagesError(400, "INVALID_FILE", "A file is required");
      if (file.size < 1 || file.size > 10 * 1024 * 1024)
        throw new PagesError(
          400,
          "FILE_TOO_LARGE",
          "Page files are limited to 10 MB",
        );
      const mimeType = file.type || "application/octet-stream";
      if (
        !/^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/.test(
          mimeType,
        )
      )
        throw new PagesError(
          400,
          "INVALID_FILE_TYPE",
          "This file type is not supported",
        );
      const current = service(c);
      const pageId = requiredParam(c, "id");
      const page = await current.get(pageId);
      if (page.role === "reader")
        throw new PagesError(404, "PAGE_NOT_FOUND", "Page not found");
      const fileId = crypto.randomUUID();
      const storageKey = `pages/${fileId}`;
      await fileBucket.put(storageKey, file.stream(), {
        httpMetadata: { contentType: mimeType },
        customMetadata: { pageId },
      });
      let saved;
      try {
        saved = await current.saveFile(pageId, {
          id: fileId,
          storageKey,
          name: file.name.slice(0, 200),
          mimeType,
          size: file.size,
        });
      } catch (failure) {
        await fileBucket.delete(storageKey);
        throw failure;
      }
      return json(saved, 201);
    } catch (failure) {
      if (failure instanceof PagesError) return error(failure);
      throw failure;
    }
  });
  register(getFileRoute, async (c) => {
    const fileBucket = documents;
    if (!fileBucket)
      return error(
        new PagesError(
          503,
          "FILE_STORAGE_UNAVAILABLE",
          "Page file storage is not configured",
        ),
      );
    try {
      const pageId = requiredParam(c, "id");
      const fileId = requiredParam(c, "fileId");
      const file = await service(c).file(pageId, fileId);
      const object = await fileBucket.get(file.storage_key);
      if (!object)
        throw new PagesError(404, "FILE_NOT_FOUND", "File not found");
      return new Response(object.body, {
        headers: {
          "content-type": file.mime_type,
          "content-length": String(file.size),
          "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    } catch (failure) {
      if (failure instanceof PagesError) return error(failure);
      throw failure;
    }
  });
}
