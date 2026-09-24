import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  createExtensionRegistry,
  createExtensionObjectRequirements,
} from "@savia/studio-shared/extension-package";
import { manifest } from "../src/manifest";
import { requirement } from "../src/object";
it("ships a matching manifest and valid independently installable collection", () => {
  expect(
    JSON.parse(
      readFileSync(new URL("../savia-extension.json", import.meta.url), "utf8"),
    ),
  ).toEqual(manifest);
  const registry = createExtensionRegistry([{ manifest }]);
  expect(
    createExtensionObjectRequirements(registry, [requirement]).get(manifest.id)
      ?.object.name,
  ).toBe(requirement.object.name);
  expect(registry.isBuiltIn(manifest.id)).toBe(false);
});
