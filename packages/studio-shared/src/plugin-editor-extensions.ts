import { z } from "zod";

/** VS Code product.version from the pinned CodinGame product.js (not its npm package version). */
export const PLUGIN_EDITOR_VSCODE_VERSION = "1.138.0";

export const EDITOR_EXTENSION_LIMITS = {
  compressedBytes: 20 * 1024 * 1024,
  expandedBytes: 64 * 1024 * 1024,
  files: 10_000,
  fileBytes: 8 * 1024 * 1024,
  tenantInstalledBytes: 128 * 1024 * 1024,
  projectReferences: 32,
} as const;

export const EDITOR_EXTENSION_COMPATIBILITY_REASONS = [
  "incompatible-engine",
  "invalid-engine-range",
  "desktop-only",
  "missing-browser-resource",
  "invalid-browser-resource",
  "unsupported-contributions",
  "unsupported-api",
] as const;

const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const publisherPattern = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const extensionNamePattern = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const extensionIdPattern = new RegExp(
  `^${publisherPattern.source.slice(1, -1)}\\.${extensionNamePattern.source.slice(1, -1)}$`,
);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const editorExtensionCompatibilitySchema = z
  .object({
    supported: z.boolean(),
    reason: z.enum(EDITOR_EXTENSION_COMPATIBILITY_REASONS).nullable(),
  })
  .strict()
  .superRefine((compatibility, context) => {
    if (compatibility.supported && compatibility.reason !== null) {
      context.addIssue({
        code: "custom",
        message: "Supported extensions cannot have a compatibility reason.",
      });
    }
    if (!compatibility.supported && compatibility.reason === null) {
      context.addIssue({
        code: "custom",
        message: "Unsupported extensions must have a compatibility reason.",
      });
    }
  });

export const editorExtensionMetadataSchema = z
  .object({
    id: z.string().regex(extensionIdPattern),
    publisher: z.string().regex(publisherPattern),
    name: z.string().regex(extensionNamePattern),
    version: z.string().regex(semverPattern),
    sha256: digestSchema,
    license: z.string().min(1).max(200).nullable(),
    compressedBytes: z
      .number()
      .int()
      .nonnegative()
      .max(EDITOR_EXTENSION_LIMITS.compressedBytes),
    expandedBytes: z
      .number()
      .int()
      .nonnegative()
      .max(EDITOR_EXTENSION_LIMITS.expandedBytes),
    dependencies: z.array(z.string().regex(extensionIdPattern)).max(100),
    compatibility: editorExtensionCompatibilitySchema,
  })
  .strict()
  .superRefine((metadata, context) => {
    if (
      metadata.id.toLowerCase() !==
      `${metadata.publisher}.${metadata.name}`.toLowerCase()
    ) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "The extension id must match publisher and name.",
      });
    }
    if (
      new Set(
        metadata.dependencies.map((dependency) => dependency.toLowerCase()),
      ).size !== metadata.dependencies.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["dependencies"],
        message: "Dependencies must be unique.",
      });
    }
  });

export const installedEditorExtensionSchema = editorExtensionMetadataSchema
  .extend({
    installationId: z.uuid(),
    source: z.enum(["open-vsx", "vsix"]),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const projectEditorExtensionReferenceSchema = z
  .object({
    installationId: z.uuid(),
    sha256: digestSchema,
  })
  .strict();

export const projectEditorExtensionReferencesSchema = z
  .array(projectEditorExtensionReferenceSchema)
  .max(EDITOR_EXTENSION_LIMITS.projectReferences)
  .superRefine((references, context) => {
    const ids = new Set<string>();
    references.forEach((reference, index) => {
      if (ids.has(reference.installationId)) {
        context.addIssue({
          code: "custom",
          path: [index, "installationId"],
          message: "Project references must be unique.",
        });
      }
      ids.add(reference.installationId);
    });
  });

export type EditorExtensionMetadata = z.infer<
  typeof editorExtensionMetadataSchema
>;
export type InstalledEditorExtension = z.infer<
  typeof installedEditorExtensionSchema
>;
export type ProjectEditorExtensionReference = z.infer<
  typeof projectEditorExtensionReferenceSchema
>;
