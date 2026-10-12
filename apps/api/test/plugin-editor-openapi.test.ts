import { describe, expect, it } from "vitest";
import {
  pluginEditorOpenApiPaths,
  pluginEditorProjectReferencesOpenApiSchema,
} from "../src/studio/plugin-editor-openapi";

describe("generated editor extension OpenAPI contract", () => {
  it("renders shared installation metadata and both inspection encodings", () => {
    const paths = pluginEditorOpenApiPaths();
    expect(Object.keys(paths)).toHaveLength(7);
    const inspect = paths["/plugin-editor-extensions/inspect"].post;
    expect(
      inspect.requestBody.content["application/octet-stream"].schema.format,
    ).toBe("binary");
    expect(
      inspect.requestBody.content["application/json"].schema,
    ).toMatchObject({ properties: { source: { const: "open-vsx" } } });
    const installed =
      paths["/plugin-editor-extensions/installed"].get.responses[200].content[
        "application/json"
      ].schema;
    expect(installed).toMatchObject({
      properties: {
        installations: {
          items: {
            properties: {
              installationId: { type: "string", format: "uuid" },
              sha256: { type: "string" },
            },
          },
        },
      },
    });
    expect(pluginEditorProjectReferencesOpenApiSchema()).toMatchObject({
      type: "array",
      maxItems: 32,
    });
  });
});
