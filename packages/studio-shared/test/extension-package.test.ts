import { describe, expect, it } from "vitest";
import {
  createExtensionObjectRequirements,
  createExtensionRegistry,
  type TrustedExtension,
} from "../src/extension-package";

function extension(
  id: string,
  requires: string[] = [],
  options: Pick<TrustedExtension, "builtIn"> = {},
): TrustedExtension {
  return {
    ...options,
    manifest: {
      format: "savia.extension",
      formatVersion: 1,
      id,
      version: "1.0.0",
      label: id,
      description: "Test extension",
      requires,
      apiVersion: 1,
    },
  };
}

describe("trusted extension manifest registry", () => {
  it("retains a release built-in extension", () => {
    const registry = createExtensionRegistry([
      extension("example.built-in", [], { builtIn: true }),
    ]);

    expect(registry.ids()).toEqual(["example.built-in"]);
    expect(registry.get("example.built-in")?.manifest.label).toBe(
      "example.built-in",
    );
    expect(registry.isBuiltIn("example.built-in")).toBe(true);
  });

  it("rejects a dependency cycle before an extension can be activated", () => {
    expect(() =>
      createExtensionRegistry([
        extension("example.a", ["example.b"]),
        extension("example.b", ["example.a"]),
      ]),
    ).toThrow("dependencia circular");
  });

  it("rejects a dependency not included in the release", () => {
    expect(() =>
      createExtensionRegistry([extension("example.a", ["example.missing"])]),
    ).toThrow("no está incluida");
  });

  it("rejects duplicate extension IDs", () => {
    expect(() =>
      createExtensionRegistry([
        extension("example.analytics"),
        extension("example.analytics"),
      ]),
    ).toThrow("duplicado");
  });

  it("accepts one collection requirement for an installable release extension", () => {
    const registry = createExtensionRegistry([extension("example.portfolio")]);

    const requirements = createExtensionObjectRequirements(registry, [
      {
        id: "example.portfolio",
        object: {
          name: "polizas",
          label: "Pólizas",
          description: "Vigencias.",
          config: {
            version: 2,
            fields: {
              name: {
                type: "Textbox",
                label: "Póliza",
                labels: {},
                required: true,
              },
            },
            fieldOrder: ["name"],
          },
        },
        requiredFields: {
          name: { types: ["Textbox"], required: true },
        },
      },
    ]);

    expect(requirements.get("example.portfolio")?.object.name).toBe("polizas");
  });

  it("rejects duplicate and unregistered collection requirements", () => {
    const registry = createExtensionRegistry([extension("example.portfolio")]);
    const requirement = {
      id: "example.portfolio",
      object: {
        name: "polizas",
        label: "Pólizas",
        description: "Vigencias.",
        config: {
          version: 2,
          fields: {
            name: {
              type: "Textbox",
              label: "Póliza",
              labels: {},
              required: true,
            },
          },
          fieldOrder: ["name"],
        },
      },
      requiredFields: {},
    };

    expect(() =>
      createExtensionObjectRequirements(registry, [requirement, requirement]),
    ).toThrow("duplicado");
    expect(() =>
      createExtensionObjectRequirements(registry, [
        { ...requirement, id: "example.unknown" },
      ]),
    ).toThrow("no está incluida");
  });

  it("rejects a collection requirement for a built-in extension", () => {
    const registry = createExtensionRegistry([
      extension("example.built-in", [], { builtIn: true }),
    ]);

    expect(() =>
      createExtensionObjectRequirements(registry, [
        {
          id: "example.built-in",
          object: {
            name: "polizas",
            label: "Pólizas",
            description: "Vigencias.",
            config: { version: 2, fields: {}, fieldOrder: [] },
          },
          requiredFields: {},
        },
      ]),
    ).toThrow("integrada");
  });
});
