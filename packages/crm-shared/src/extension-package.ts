import { z } from "zod";
import { identifier, supportedTypes } from "./metadata";
import {
  solutionIdSchema,
  solutionPackageSchema,
  type SolutionPackage,
} from "./solution-package";
import {
  validateExtensionRuntime,
  type ExtensionRuntimeContribution,
} from "./extension-runtime";

const semanticVersionSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
  .max(30);

export const extensionManifestSchema = z
  .object({
    format: z.literal("savia.extension"),
    formatVersion: z.literal(1),
    id: solutionIdSchema,
    version: semanticVersionSchema,
    label: z.string().trim().min(1).max(100),
    description: z.string().max(1000),
    requires: z.array(solutionIdSchema).max(30).default([]),
    apiVersion: z.literal(1),
  })
  .strict();

export type ExtensionManifest = z.infer<typeof extensionManifestSchema>;

export type TrustedExtension = {
  manifest: ExtensionManifest;
  builtIn?: boolean;
  runtime?: ExtensionRuntimeContribution;
};

export type ExtensionObjectRequirement = {
  id: string;
  object: SolutionPackage["objects"][number];
  requiredFields: Readonly<
    Record<
      string,
      {
        types: readonly string[];
        required?: boolean;
        optionValues?: readonly string[];
      }
    >
  >;
};

const extensionObjectRequirementSchema = z
  .object({
    id: solutionIdSchema,
    object: z.unknown(),
    requiredFields: z.record(
      identifier,
      z
        .object({
          types: z.array(z.enum(supportedTypes)).min(1),
          required: z.boolean().optional(),
          optionValues: z.array(z.string().trim().min(1).max(200)).optional(),
        })
        .strict(),
    ),
  })
  .strict();

export class ExtensionRegistry {
  #extensions: ReadonlyMap<string, TrustedExtension>;

  constructor(extensions: readonly TrustedExtension[]) {
    const entries = new Map<string, TrustedExtension>();
    for (const extension of extensions) {
      const parsed = extensionManifestSchema.parse(extension.manifest);
      if (entries.has(parsed.id))
        throw new Error(
          `El identificador de extensión ${parsed.id} está duplicado.`,
        );
      entries.set(parsed.id, {
        builtIn: extension.builtIn === true,
        manifest: parsed,
        runtime: validateExtensionRuntime(parsed.id, extension.runtime),
      });
    }
    for (const extension of entries.values())
      for (const dependency of extension.manifest.requires)
        if (!entries.has(dependency))
          throw new Error(
            `La dependencia ${dependency} de ${extension.manifest.id} no está incluida en el release.`,
          );
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string) => {
      if (visited.has(id)) return;
      if (visiting.has(id))
        throw new Error(`La extensión ${id} tiene una dependencia circular.`);
      visiting.add(id);
      for (const dependency of entries.get(id)!.manifest.requires)
        visit(dependency);
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of entries.keys()) visit(id);
    this.#extensions = entries;
  }

  get(id: string): TrustedExtension | undefined {
    return this.#extensions.get(id);
  }

  ids(): string[] {
    return [...this.#extensions.keys()].sort((left, right) =>
      left.localeCompare(right),
    );
  }

  isBuiltIn(id: string): boolean {
    return this.#extensions.get(id)?.builtIn === true;
  }
}

export function createExtensionRegistry(
  extensions: readonly TrustedExtension[],
): ExtensionRegistry {
  return new ExtensionRegistry(extensions);
}

export function createExtensionObjectRequirements(
  registry: ExtensionRegistry,
  requirements: readonly ExtensionObjectRequirement[],
): ReadonlyMap<string, ExtensionObjectRequirement> {
  const entries = new Map<string, ExtensionObjectRequirement>();
  for (const requirement of requirements) {
    const parsed = extensionObjectRequirementSchema.parse(requirement);
    const extension = registry.get(parsed.id);
    if (!extension)
      throw new Error(
        `La extensión ${parsed.id} no está incluida en el release.`,
      );
    if (extension.builtIn)
      throw new Error(
        `La extensión integrada ${parsed.id} no puede declarar una colección instalable.`,
      );
    if (entries.has(parsed.id))
      throw new Error(
        `El requisito de colección para ${parsed.id} está duplicado.`,
      );
    const object = solutionPackageSchema.parse({
      format: "savia.solution",
      formatVersion: 1,
      id: "extension.requirements",
      version: "1.0.0",
      label: "Extension requirements",
      description: "Trusted extension collection requirement.",
      requires: [],
      objects: [parsed.object],
    }).objects[0];
    entries.set(parsed.id, {
      id: parsed.id,
      object,
      requiredFields: parsed.requiredFields,
    });
  }
  return entries;
}
