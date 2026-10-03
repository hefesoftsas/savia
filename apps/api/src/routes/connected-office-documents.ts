import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import type { Context } from "hono";
import { actorFromContext } from "../auth/middleware";
import { createPersonalIntegrationRepository } from "../personal-integrations/repository";
import type {
  PersonalIntegrationNangoClient,
  PersonalIntegrationProviderDefinition,
  PersonalIntegrationProviderId,
} from "../personal-integrations/contracts";
import {
  ConnectedOfficeDocumentsError,
  ConnectedOfficeDocumentsService,
} from "../connected-office-documents/service";
import { OFFICE_MAX_SIZE } from "@savia/studio-shared/office";

export type ConnectedOfficeDocumentDependencies = {
  providers: Record<
    PersonalIntegrationProviderId,
    PersonalIntegrationProviderDefinition
  >;
  nango?: PersonalIntegrationNangoClient;
};

const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
const providerSchema = z.object({
  provider: z.enum(["google_drive", "onedrive_personal", "onedrive_business"]),
  label: z.string(),
  accountLabel: z.string().nullable(),
});
const summarySchema = z.object({
  id: z.string(),
  name: z.string(),
  format: z.enum(["docx", "xlsx", "pptx"]),
  provider: z.enum(["google_drive", "onedrive_personal", "onedrive_business"]),
  url: z.string().url(),
  createdAt: z.string(),
});
const providerListRoute = createRoute({
  method: "get",
  path: "/v1/connected-office-documents/providers",
  tags: ["Connected office documents"],
  summary: "List connected office providers available to the caller",
  security: [{ oauth2: ["savia.api.read"] }],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ data: z.array(providerSchema) }),
        },
      },
      description: "Connected office providers",
    },
    403: {
      content: { "application/json": { schema: errorSchema } },
      description: "Office suite is disabled",
    },
    404: {
      content: { "application/json": { schema: errorSchema } },
      description: "Active tenant is unavailable",
    },
  },
});
const listRoute = createRoute({
  method: "get",
  path: "/v1/connected-office-documents",
  tags: ["Connected office documents"],
  summary: "List the caller's private connected office documents",
  security: [{ oauth2: ["savia.api.read"] }],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ data: z.array(summarySchema) }),
        },
      },
      description: "Private connected document links",
    },
    403: {
      content: { "application/json": { schema: errorSchema } },
      description: "Office suite is disabled",
    },
    404: {
      content: { "application/json": { schema: errorSchema } },
      description: "Active tenant is unavailable",
    },
  },
});
const createRouteDefinition = createRoute({
  method: "post",
  path: "/v1/connected-office-documents",
  tags: ["Connected office documents"],
  summary: "Create a document in the caller's connected drive",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: z.object({
            provider: z.string(),
            format: z.string(),
            name: z.string(),
            requestId: z.string().uuid(),
            file: z.any().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        "application/json": { schema: z.object({ data: summarySchema }) },
      },
      description: "Created connected document",
    },
    200: {
      content: {
        "application/json": { schema: z.object({ data: summarySchema }) },
      },
      description: "Idempotent replay of a completed request",
    },
    400: {
      content: { "application/json": { schema: errorSchema } },
      description: "Invalid request",
    },
    403: {
      content: { "application/json": { schema: errorSchema } },
      description: "Provider not connected or office suite disabled",
    },
    404: {
      content: { "application/json": { schema: errorSchema } },
      description: "Active tenant is unavailable",
    },
    409: {
      content: { "application/json": { schema: errorSchema } },
      description: "Conflicting or in-progress idempotency request",
    },
    413: {
      content: { "application/json": { schema: errorSchema } },
      description: "Upload exceeds 5 MB",
    },
    422: {
      content: { "application/json": { schema: errorSchema } },
      description: "Invalid Office template",
    },
    502: {
      content: { "application/json": { schema: errorSchema } },
      description: "Provider request failed or had an uncertain outcome",
    },
    503: {
      content: { "application/json": { schema: errorSchema } },
      description:
        "Provider service or private metadata storage is unavailable",
    },
  },
});

export function registerConnectedOfficeDocumentRoutes(
  app: OpenAPIHono,
  db: D1Database,
  dependencies: ConnectedOfficeDocumentDependencies,
) {
  const repo = createPersonalIntegrationRepository(db);
  const service = (c: Context) => {
    return new ConnectedOfficeDocumentsService(
      db,
      actorFromContext(c),
      dependencies.providers,
      repo,
      dependencies.nango,
    );
  };
  const run = async (operation: () => Promise<unknown>, status = 200) => {
    try {
      return Response.json(
        { data: await operation() },
        { status, headers: { "cache-control": "no-store" } },
      );
    } catch (failure) {
      if (failure instanceof ConnectedOfficeDocumentsError)
        return Response.json(
          { error: { code: failure.code, message: failure.message } },
          { status: failure.status, headers: { "cache-control": "no-store" } },
        );
      throw failure;
    }
  };
  const onLimit = () =>
    Response.json(
      {
        error: {
          code: "FILE_TOO_LARGE",
          message: "Office templates are limited to 5 MB",
        },
      },
      { status: 413, headers: { "cache-control": "no-store" } },
    );
  app.use(
    "/v1/connected-office-documents",
    bodyLimit({ maxSize: OFFICE_MAX_SIZE + 128 * 1024, onError: onLimit }),
  );
  app.use(
    "/v1/connected-office-documents/*",
    bodyLimit({ maxSize: OFFICE_MAX_SIZE + 128 * 1024, onError: onLimit }),
  );
  app.use("/v1/connected-office-documents", async (_c, next) => {
    await next();
    _c.header("cache-control", "no-store");
  });
  app.use("/v1/connected-office-documents/*", async (_c, next) => {
    await next();
    _c.header("cache-control", "no-store");
  });

  const register = (
    route: unknown,
    handler: (context: Context) => Promise<Response>,
  ) => app.openapi(route as never, handler as never);
  register(providerListRoute, (c) => run(() => service(c).listProviders()));
  register(listRoute, (c) => run(() => service(c).list()));
  register(createRouteDefinition, async (c) => {
    try {
      const form = await c.req.formData();
      const file = form.get("file");
      if (file !== null && !(file instanceof File))
        throw new ConnectedOfficeDocumentsError(
          400,
          "INVALID_FILE",
          "The Office template upload is invalid",
        );
      const result = await service(c).create({
        provider: String(form.get("provider") ?? ""),
        format: String(form.get("format") ?? ""),
        name: String(form.get("name") ?? ""),
        requestId: String(form.get("requestId") ?? ""),
        ...(file instanceof File ? { file } : {}),
      });
      return Response.json(
        { data: result.summary },
        {
          status: result.created ? 201 : 200,
          headers: { "cache-control": "no-store" },
        },
      );
    } catch (failure) {
      if (failure instanceof ConnectedOfficeDocumentsError)
        return Response.json(
          { error: { code: failure.code, message: failure.message } },
          { status: failure.status, headers: { "cache-control": "no-store" } },
        );
      throw failure;
    }
  });
}
