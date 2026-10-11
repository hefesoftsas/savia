import { z } from "@hono/zod-openapi";
import {
  installedEditorExtensionSchema,
  editorExtensionMetadataSchema,
  projectEditorExtensionReferencesSchema,
} from "@savia/studio-shared/plugin-editor-extensions";

// The tenant OpenAPI endpoint renders these schemas at request time.
export function pluginEditorOpenApiPaths() {
  const json = (schema: unknown) => ({ "application/json": { schema } });
  const object = (properties: Record<string, unknown>) => ({
    type: "object",
    properties,
    required: Object.keys(properties),
  });
  const installation = z.toJSONSchema(installedEditorExtensionSchema);
  const metadata = z.toJSONSchema(editorExtensionMetadataSchema);
  const coordinate = { type: "string", minLength: 1, maxLength: 100 };
  const path = (name: string) => ({
    name,
    in: "path",
    required: true,
    schema: coordinate,
  });
  const item = object({
    publisher: coordinate,
    name: coordinate,
    version: coordinate,
    displayName: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    license: { type: ["string", "null"] },
  });
  const operation = (
    operationId: string,
    summary: string,
    schema: unknown,
    status = 200,
  ) => ({
    operationId,
    tags: ["Plugin editor extensions"],
    summary,
    responses: {
      [status]: { description: "Success", content: json(schema) },
      ...Object.fromEntries(
        [400, 401, 403, 404, 409, 413, 422, 502].map((code) => [
          code,
          {
            description:
              "Extension administration, package validation, registry, or version conflict error",
          },
        ]),
      ),
    },
  });
  return {
    "/plugin-editor-extensions/marketplace": {
      get: {
        ...operation(
          "plugin_editor_marketplace_search",
          "Search Open VSX",
          object({
            results: { type: "array", maxItems: 20, items: item },
            offset: { type: "integer", minimum: 0 },
            totalSize: { type: "integer", minimum: 0 },
            nextOffset: { type: ["integer", "null"] },
          }),
        ),
        parameters: [
          {
            name: "q",
            in: "query",
            required: true,
            schema: { type: "string", minLength: 1, maxLength: 200 },
          },
          {
            name: "offset",
            in: "query",
            schema: { type: "integer", minimum: 0 },
          },
        ],
      },
    },
    "/plugin-editor-extensions/marketplace/{publisher}/{name}/{version}": {
      get: {
        ...operation(
          "plugin_editor_marketplace_version",
          "Get an exact Open VSX version",
          item,
        ),
        parameters: [path("publisher"), path("name"), path("version")],
      },
    },
    "/plugin-editor-extensions/inspect": {
      post: {
        ...operation(
          "plugin_editor_inspect",
          "Inspect an Open VSX package or uploaded VSIX",
          object({
            inspectionId: { type: "string", format: "uuid" },
            metadata,
            manifestSummary: { type: "object" },
          }),
          201,
        ),
        parameters: [
          { name: "source", in: "query", schema: { const: "vsix" } },
          {
            name: "fileName",
            in: "query",
            schema: { type: "string", maxLength: 255 },
          },
        ],
        requestBody: {
          required: true,
          content: {
            ...json(
              object({
                source: { const: "open-vsx" },
                publisher: coordinate,
                name: coordinate,
                version: coordinate,
              }),
            ),
            "application/octet-stream": {
              schema: {
                type: "string",
                format: "binary",
                description:
                  "VSIX bytes; maximum 20 MiB. Requires source=vsix and fileName query parameters.",
              },
            },
          },
        },
      },
    },
    "/plugin-editor-extensions/install": {
      post: {
        ...operation(
          "plugin_editor_install",
          "Install an inspected compatible package",
          object({ installation }),
          201,
        ),
        requestBody: {
          required: true,
          content: json(
            object({ inspectionId: { type: "string", format: "uuid" } }),
          ),
        },
      },
    },
    "/plugin-editor-extensions/installed": {
      get: operation(
        "plugin_editor_installed",
        "List caller-owned installations",
        object({ installations: { type: "array", items: installation } }),
      ),
    },
    "/plugin-editor-extensions/installed/{installationId}/package": {
      get: {
        ...operation(
          "plugin_editor_package",
          "Download caller-owned immutable VSIX bytes",
          {},
        ),
        parameters: [path("installationId")],
        responses: {
          200: {
            description:
              "Immutable package with X-Content-SHA256 digest header",
            content: {
              "application/zip": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
          404: { description: "Installation or package not found" },
        },
      },
    },
    "/plugin-editor-extensions/installed/{installationId}": {
      delete: {
        ...operation(
          "plugin_editor_uninstall",
          "Remove an unreferenced installation",
          {},
          204,
        ),
        parameters: [path("installationId")],
        responses: {
          204: { description: "Removed" },
          409: {
            description: "Installation is referenced by a project",
            content: json(
              object({
                error: { type: "string" },
                projectIds: {
                  type: "array",
                  items: { type: "string", format: "uuid" },
                },
              }),
            ),
          },
        },
      },
    },
  };
}

export const pluginEditorProjectReferencesOpenApiSchema = () =>
  z.toJSONSchema(projectEditorExtensionReferencesSchema);
