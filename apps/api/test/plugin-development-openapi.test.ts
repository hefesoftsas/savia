import { expect, it } from "vitest";
import { pluginDevelopmentOpenApiPaths } from "../src/studio/plugin-development-openapi";
it("describes narrow scopes, explicit versions and guarded multipart publication", () => {
  const paths = pluginDevelopmentOpenApiPaths();
  expect(Object.keys(paths)).toEqual([
    "/plugin-development/capabilities",
    "/plugin-development/catalog",
    "/plugin-development/{id}/checkout",
    "/plugin-development/{id}/publish",
  ]);
  expect(
    paths["/plugin-development/{id}/checkout"].get.parameters,
  ).toContainEqual(
    expect.objectContaining({ in: "query", name: "version", required: true }),
  );
  const publish = paths["/plugin-development/{id}/publish"].post;
  expect(
    publish.requestBody.content["multipart/form-data"].schema,
  ).toMatchObject({
    required: ["metadata", "file"],
    properties: {
      metadata: { type: "string" },
      file: { type: "string", format: "binary" },
    },
  });
  expect(publish.responses[409]).toBeDefined();
  expect(
    publish.responses[200].content["application/json"].schema,
  ).toMatchObject({
    properties: {
      state: { enum: ["published", "shared-pending", "shared-conflict"] },
    },
  });
});
