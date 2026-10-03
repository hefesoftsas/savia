import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import type { Context } from "hono";
import { actorFromContext } from "../auth/middleware";
import {
  OfficeDocumentsError,
  OfficeDocumentsService,
} from "../office-documents/service";
import { OFFICE_MAX_SIZE } from "@savia/studio-shared/office";

const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
const envelope = <T extends z.ZodType>(schema: T) => z.object({ data: schema });
const idParam = z.object({ id: z.string().trim().min(1).max(128) });
const versionParam = idParam.extend({
  version: z.coerce.number().int().positive(),
});
const summarySchema = z.object({
  id: z.string(),
  name: z.string(),
  mime: z.string(),
  size: z.number().int(),
  version: z.number().int(),
  updatedAt: z.string(),
  role: z.enum(["owner", "reader", "editor"]),
  ownerName: z.string(),
});
const officeSchema = summarySchema.extend({
  field: z.null(),
  object: z.null(),
  recordId: z.null(),
  readOnly: z.boolean(),
  maxSize: z.number().int(),
});
const revisionSchema = z.object({
  version: z.number().int(),
  size: z.number().int(),
  created_at: z.string(),
  created_by: z.string().nullable(),
});
const multipartBody = {
  required: true,
  content: { "multipart/form-data": { schema: z.object({ file: z.any() }) } },
};
const security = [{ oauth2: ["savia.api.read"] }];
const writeSecurity = [{ oauth2: ["savia.api.write"] }];
const disabledResponse = {
  403: {
    content: { "application/json": { schema: errorSchema } },
    description: "The office suite is disabled for this tenant",
  },
};
const jsonResponse = (schema: z.ZodType, description: string) => ({
  200: {
    content: { "application/json": { schema: envelope(schema) } },
    description,
  },
  400: {
    content: { "application/json": { schema: errorSchema } },
    description: "Invalid request",
  },
  404: {
    content: { "application/json": { schema: errorSchema } },
    description: "Document not found",
  },
  ...disabledResponse,
});

const listRoute = createRoute({
  method: "get",
  path: "/v1/office-documents",
  tags: ["Office documents"],
  summary: "List the caller's private office documents",
  security,
  responses: {
    ...disabledResponse,
    200: {
      content: {
        "application/json": { schema: envelope(z.array(summarySchema)) },
      },
      description: "Private document summaries",
    },
  },
});
const createDocumentRoute = createRoute({
  method: "post",
  path: "/v1/office-documents",
  tags: ["Office documents"],
  summary: "Create a private office document",
  security: writeSecurity,
  request: { body: multipartBody },
  responses: {
    ...disabledResponse,
    201: {
      content: { "application/json": { schema: envelope(summarySchema) } },
      description: "Created private document",
    },
    400: {
      content: { "application/json": { schema: errorSchema } },
      description: "Invalid upload",
    },
    413: {
      content: { "application/json": { schema: errorSchema } },
      description: "Upload exceeds size limit",
    },
    422: {
      content: { "application/json": { schema: errorSchema } },
      description: "Unsupported Office document",
    },
  },
});
const officeRoute = createRoute({
  method: "get",
  path: "/v1/office-documents/api/file/{id}/office",
  tags: ["Office documents"],
  summary: "Get Office editor metadata",
  security,
  request: { params: idParam },
  responses: jsonResponse(officeSchema, "Editor metadata"),
});
const revisionsRoute = createRoute({
  method: "get",
  path: "/v1/office-documents/api/file/{id}/revisions",
  tags: ["Office documents"],
  summary: "List document revisions",
  security,
  request: { params: idParam },
  responses: jsonResponse(z.array(revisionSchema), "Revision history"),
});
const downloadRoute = createRoute({
  method: "get",
  path: "/v1/office-documents/api/file/{id}/revisions/{version}/download",
  tags: ["Office documents"],
  summary: "Download a document revision",
  security,
  request: { params: versionParam },
  responses: {
    ...disabledResponse,
    200: {
      description: "Office document bytes",
      content: {
        "application/octet-stream": {
          schema: z.string().openapi({ format: "binary" }),
        },
      },
    },
    404: {
      content: { "application/json": { schema: errorSchema } },
      description: "Revision not found",
    },
  },
});
const saveRoute = createRoute({
  method: "post",
  path: "/v1/office-documents/api/file/{id}/revisions",
  tags: ["Office documents"],
  summary: "Save a new document revision",
  security: writeSecurity,
  request: {
    params: idParam,
    body: {
      ...multipartBody,
      content: {
        "multipart/form-data": {
          schema: z.object({
            file: z.any(),
            version: z.coerce.number().int().positive(),
          }),
        },
      },
    },
  },
  responses: {
    ...disabledResponse,
    201: {
      content: { "application/json": { schema: envelope(summarySchema) } },
      description: "Saved revision",
    },
    409: {
      content: { "application/json": { schema: errorSchema } },
      description: "Document version conflict",
    },
    413: {
      content: { "application/json": { schema: errorSchema } },
      description: "Upload exceeds size limit",
    },
    422: {
      content: { "application/json": { schema: errorSchema } },
      description: "Unsupported Office document",
    },
  },
});
const deleteRoute = createRoute({
  method: "delete",
  path: "/v1/office-documents/{id}",
  tags: ["Office documents"],
  summary: "Delete a private office document and its revisions",
  security: writeSecurity,
  request: {
    params: idParam,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ version: z.number().int().positive() }),
        },
      },
    },
  },
  responses: {
    204: { description: "Document and revisions deleted" },
    400: {
      content: { "application/json": { schema: errorSchema } },
      description: "Invalid request",
    },
    404: {
      content: { "application/json": { schema: errorSchema } },
      description: "Document not found",
    },
    409: {
      content: { "application/json": { schema: errorSchema } },
      description: "Document version conflict",
    },
    ...disabledResponse,
  },
});
const memberSchema = z.object({
  principalId: z.string(),
  displayName: z.string(),
  email: z.string(),
});
const membersRoute = createRoute({
  method: "get",
  path: "/v1/office-documents/members",
  tags: ["Office documents"],
  summary: "Find active members in the current tenant",
  security,
  request: {
    query: z.object({ q: z.string().max(200).optional().default("") }),
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: envelope(z.array(memberSchema)) },
      },
      description: "Tenant members",
    },
    ...disabledResponse,
  },
});
const shareSchema = z.object({
  principalId: z.string(),
  role: z.enum(["reader", "editor"]),
  displayName: z.string(),
  email: z.string(),
});
const sharesRoute = createRoute({
  method: "get",
  path: "/v1/office-documents/{id}/shares",
  tags: ["Office documents"],
  summary: "List document access grants",
  security,
  request: { params: idParam },
  responses: jsonResponse(
    z.object({ version: z.number().int(), shares: z.array(shareSchema) }),
    "Document shares",
  ),
});
const setSharesRoute = createRoute({
  method: "put",
  path: "/v1/office-documents/{id}/shares",
  tags: ["Office documents"],
  summary: "Replace document access grants",
  security: writeSecurity,
  request: {
    params: idParam,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            version: z.number().int().positive(),
            shares: z
              .array(
                z.object({
                  principalId: z.string().min(1),
                  role: z.enum(["reader", "editor"]),
                }),
              )
              .max(200),
          }),
        },
      },
    },
  },
  responses: {
    ...jsonResponse(
      z.object({ version: z.number().int(), shares: z.array(shareSchema) }),
      "Updated document shares",
    ),
    409: {
      content: { "application/json": { schema: errorSchema } },
      description: "Shares changed",
    },
  },
});

export function registerOfficeDocumentRoutes(
  app: OpenAPIHono,
  db: D1Database,
  bucket?: R2Bucket,
) {
  const service = (c: Context) => {
    if (!bucket)
      throw new OfficeDocumentsError(
        503,
        "FILE_STORAGE_UNAVAILABLE",
        "Office document storage is not configured",
      );
    return new OfficeDocumentsService(db, actorFromContext(c), bucket);
  };
  const run = async (operation: () => Promise<unknown>, status = 200) => {
    try {
      return Response.json(
        { data: await operation() },
        { status, headers: { "cache-control": "no-store" } },
      );
    } catch (failure) {
      if (failure instanceof OfficeDocumentsError)
        return Response.json(
          { error: { code: failure.code, message: failure.message } },
          { status: failure.status, headers: { "cache-control": "no-store" } },
        );
      throw failure;
    }
  };
  app.use(
    "/v1/office-documents",
    bodyLimit({
      maxSize: OFFICE_MAX_SIZE + 128 * 1024,
      onError: () =>
        Response.json(
          {
            error: {
              code: "FILE_TOO_LARGE",
              message: "Office documents are limited to 5 MB",
            },
          },
          { status: 413 },
        ),
    }),
  );
  app.use(
    "/v1/office-documents/*",
    bodyLimit({
      maxSize: OFFICE_MAX_SIZE + 128 * 1024,
      onError: () =>
        Response.json(
          {
            error: {
              code: "FILE_TOO_LARGE",
              message: "Office documents are limited to 5 MB",
            },
          },
          { status: 413 },
        ),
    }),
  );
  app.use("/v1/office-documents", async (c, next) => {
    await next();
    c.header("cache-control", "no-store");
  });
  app.use("/v1/office-documents/*", async (c, next) => {
    await next();
    c.header("cache-control", "no-store");
  });

  const register = (
    route: unknown,
    handler: (context: Context) => Promise<Response>,
  ) => app.openapi(route as never, handler as never);
  register(listRoute, (c) => run(() => service(c).list()));
  register(membersRoute, (c) =>
    run(() => service(c).members(c.req.query("q") ?? "")),
  );
  register(sharesRoute, (c) =>
    run(() => service(c).shares(c.req.param("id")!)),
  );
  register(setSharesRoute, async (c) => {
    try {
      const body = await c.req.json<{
        version: number;
        shares: Array<{ principalId: string; role: "reader" | "editor" }>;
      }>();
      return await run(() => service(c).setShares(c.req.param("id")!, body));
    } catch (failure) {
      if (failure instanceof OfficeDocumentsError)
        return Response.json(
          { error: { code: failure.code, message: failure.message } },
          { status: failure.status, headers: { "cache-control": "no-store" } },
        );
      throw failure;
    }
  });
  register(createDocumentRoute, async (c) => {
    try {
      const file = (await c.req.formData()).get("file");
      if (!(file instanceof File))
        throw new OfficeDocumentsError(
          400,
          "INVALID_FILE",
          "A file is required",
        );
      return await run(() => service(c).create(file), 201);
    } catch (failure) {
      if (failure instanceof OfficeDocumentsError)
        return Response.json(
          { error: { code: failure.code, message: failure.message } },
          { status: failure.status, headers: { "cache-control": "no-store" } },
        );
      throw failure;
    }
  });
  register(officeRoute, (c) =>
    run(() => service(c).officeMetadata(c.req.param("id")!)),
  );
  register(revisionsRoute, (c) =>
    run(() => service(c).revisions(c.req.param("id")!)),
  );
  register(downloadRoute, async (c) => {
    try {
      return await service(c).download(
        c.req.param("id")!,
        Number(c.req.param("version")),
      );
    } catch (failure) {
      if (failure instanceof OfficeDocumentsError)
        return Response.json(
          { error: { code: failure.code, message: failure.message } },
          { status: failure.status, headers: { "cache-control": "no-store" } },
        );
      throw failure;
    }
  });
  register(saveRoute, async (c) => {
    try {
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File))
        throw new OfficeDocumentsError(
          400,
          "INVALID_FILE",
          "A file is required",
        );
      const version = Number(form.get("version"));
      if (!Number.isInteger(version) || version < 1)
        throw new OfficeDocumentsError(
          400,
          "INVALID_VERSION",
          "A positive document version is required",
        );
      return await run(
        () => service(c).revise(c.req.param("id")!, version, file),
        201,
      );
    } catch (failure) {
      if (failure instanceof OfficeDocumentsError)
        return Response.json(
          { error: { code: failure.code, message: failure.message } },
          { status: failure.status, headers: { "cache-control": "no-store" } },
        );
      throw failure;
    }
  });
  register(deleteRoute, async (c) => {
    try {
      const { version } = await c.req.json<{ version: number }>();
      await service(c).remove(c.req.param("id")!, version);
      return new Response(null, {
        status: 204,
        headers: { "cache-control": "no-store" },
      });
    } catch (failure) {
      if (failure instanceof OfficeDocumentsError)
        return Response.json(
          { error: { code: failure.code, message: failure.message } },
          { status: failure.status, headers: { "cache-control": "no-store" } },
        );
      throw failure;
    }
  });
}
