import { z } from "zod";
import { pluginStoreManifestSchema } from "./plugin-store";
import {
  pluginProjectFilesSchema,
  PLUGIN_PROJECT_MAX_BYTES,
} from "./plugin-projects";

export const pluginVersionSchema = pluginStoreManifestSchema.shape.version;
export const pluginDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const pluginHeadSchema = z
  .object({ version: pluginVersionSchema, sha256: pluginDigestSchema })
  .strict();
export type PluginHead = z.infer<typeof pluginHeadSchema>;
export const pluginDevelopmentDestinationSchema = z.enum(["tenant", "shared"]);
/** Exact origins only: never send a saved credential to a project-supplied URL. */
export const pluginDevelopmentOriginSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        value === url.origin &&
        !url.username &&
        !url.password &&
        (url.protocol === "https:" ||
          (url.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
      );
    } catch {
      return false;
    }
  }, "Use an HTTPS origin or an explicit loopback HTTP origin");
export const pluginDevelopmentPathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (path) =>
      !/[\\:\x00-\x1f]/.test(path) &&
      path
        .split("/")
        .every(
          (part) =>
            part &&
            part !== "." &&
            part !== ".." &&
            !["__proto__", "prototype", "constructor", ".savia"].includes(part),
        ),
    "Use a relative source path",
  );
export const pluginDevelopmentCapabilitiesSchema = z
  .object({
    schemaVersion: z.literal(1),
    compilerVersion: z.literal(1),
    tenantId: z.number().int().nonnegative(),
    principalId: z.string().min(1).max(200),
    workspaceLabel: z.string().min(1).max(200),
    read: z.boolean(),
    destinations: z.array(pluginDevelopmentDestinationSchema).max(2),
  })
  .strict();
export type PluginDevelopmentCapabilities = z.infer<
  typeof pluginDevelopmentCapabilitiesSchema
>;
export const pluginCatalogEntrySchema = z
  .object({
    pluginId: pluginStoreManifestSchema.shape.id,
    label: z.string().max(100),
    versions: z
      .array(
        z
          .object({
            ...pluginHeadSchema.shape,
            createdAt: z.string().max(100),
            authored: z.boolean(),
          })
          .strict(),
      )
      .max(100),
    head: pluginHeadSchema,
    installedVersion: pluginVersionSchema.nullable(),
  })
  .strict();
export type PluginCatalogEntry = z.infer<typeof pluginCatalogEntrySchema>;
export const pluginCatalogSchema = z.array(pluginCatalogEntrySchema).max(1000);
export const pluginCheckoutSchema = z
  .object({
    pluginId: pluginStoreManifestSchema.shape.id,
    sourceVersion: pluginVersionSchema,
    sourceSha256: pluginDigestSchema,
    head: pluginHeadSchema,
    sharedHead: pluginHeadSchema.nullable(),
    authoringKind: z.enum(["authored", "compiled-only"]),
    files: pluginProjectFilesSchema,
    entryPath: pluginDevelopmentPathSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new TextEncoder().encode(JSON.stringify(value.files)).byteLength >
      PLUGIN_PROJECT_MAX_BYTES
    )
      ctx.addIssue({
        code: "custom",
        path: ["files"],
        message: "Project exceeds the 5 MB limit",
      });
  });
export type PluginCheckout = z.infer<typeof pluginCheckoutSchema>;
export const localPluginDescriptorSchema = z
  .object({
    schemaVersion: z.literal(1),
    origin: pluginDevelopmentOriginSchema,
    tenantId: z.number().int().nonnegative(),
    pluginId: pluginStoreManifestSchema.shape.id,
    sourceVersion: pluginVersionSchema,
    sourceSha256: pluginDigestSchema,
    expectedHead: pluginHeadSchema,
    entryPath: pluginDevelopmentPathSchema,
  })
  .strict();
export type LocalPluginDescriptor = z.infer<typeof localPluginDescriptorSchema>;
export const pluginPublicationRequestSchema = z
  .object({
    mode: z.enum(["create", "retry-shared"]),
    destination: pluginDevelopmentDestinationSchema,
    pluginId: pluginStoreManifestSchema.shape.id,
    version: pluginVersionSchema,
    sourceVersion: pluginVersionSchema,
    sourceSha256: pluginDigestSchema,
    expectedHead: pluginHeadSchema,
  })
  .strict()
  .refine(
    (value) => value.mode !== "retry-shared" || value.destination === "shared",
    "Shared retry requires the shared destination",
  );
export type PluginPublicationRequest = z.infer<
  typeof pluginPublicationRequestSchema
>;
export const pluginReleaseIdentitySchema = z
  .object({
    pluginId: pluginStoreManifestSchema.shape.id,
    ...pluginHeadSchema.shape,
  })
  .strict();
export const pluginPublicationReceiptSchema = z
  .object({
    state: z.enum(["published", "shared-pending", "shared-conflict"]),
    destination: pluginDevelopmentDestinationSchema,
    local: pluginReleaseIdentitySchema,
    shared: pluginReleaseIdentitySchema.optional(),
    head: pluginHeadSchema,
    sharedHead: pluginHeadSchema.nullable(),
    issues: z
      .array(
        z
          .object({
            code: z.string().regex(/^[A-Z_]{1,80}$/),
            message: z.string().max(500),
          })
          .strict(),
      )
      .max(10),
  })
  .strict()
  .refine(
    (value) =>
      value.destination === "shared"
        ? value.state !== "published" || !!value.shared
        : value.state === "published" && !value.shared,
    "A successful shared publication requires a shared receipt",
  );
export type PluginPublicationReceipt = z.infer<
  typeof pluginPublicationReceiptSchema
>;
