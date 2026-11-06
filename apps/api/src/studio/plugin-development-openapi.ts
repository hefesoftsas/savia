import { z } from "@hono/zod-openapi";
import {
  pluginDevelopmentCapabilitiesSchema,
  pluginCatalogSchema,
  pluginCheckoutSchema,
  pluginPublicationReceiptSchema,
  pluginPublicationRequestSchema,
  pluginVersionSchema,
} from "@savia/studio-shared/plugin-development";
export function pluginDevelopmentOpenApiPaths() {
  const json = (schema: unknown) => ({ "application/json": { schema } });
  const operation = (id: string, scope: string, schema: unknown) => ({
    operationId: id,
    tags: ["Plugin development"],
    summary: `Native plugin authoring (${scope})`,
    responses: {
      200: {
        description: "Success or explicit partial shared publication",
        content: json(schema),
      },
      ...Object.fromEntries(
        [400, 401, 403, 404, 409, 413, 422, 502].map((status) => [
          status,
          {
            description: "Scope, current ACL, package, source or head conflict",
          },
        ]),
      ),
    },
  });
  const id = {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string" },
  };
  return {
    "/plugin-development/capabilities": {
      get: operation(
        "plugin_development_capabilities",
        "plugins:read or plugins:publish",
        z.toJSONSchema(pluginDevelopmentCapabilitiesSchema),
      ),
    },
    "/plugin-development/catalog": {
      get: operation(
        "plugin_development_catalog",
        "plugins:read",
        z.toJSONSchema(pluginCatalogSchema),
      ),
    },
    "/plugin-development/{id}/checkout": {
      get: {
        ...operation(
          "plugin_development_checkout",
          "plugins:read",
          z.toJSONSchema(pluginCheckoutSchema),
        ),
        parameters: [
          id,
          {
            name: "version",
            in: "query",
            required: true,
            schema: z.toJSONSchema(pluginVersionSchema),
          },
        ],
      },
    },
    "/plugin-development/{id}/publish": {
      post: {
        ...operation(
          "plugin_development_publish",
          "plugins:publish",
          z.toJSONSchema(pluginPublicationReceiptSchema),
        ),
        parameters: [id],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["metadata", "file"],
                properties: {
                  metadata: {
                    type: "string",
                    description: "JSON publication metadata",
                    contentMediaType: "application/json",
                    contentSchema: z.toJSONSchema(
                      pluginPublicationRequestSchema,
                    ),
                  },
                  file: {
                    type: "string",
                    format: "binary",
                    description: "Immutable plugin ZIP (maximum 6 MiB)",
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
