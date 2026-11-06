import { z } from "zod";

const MAX_FILE_BYTES = 100 * 1024;
const MAX_TOTAL_REQUEST_BYTES = 512 * 1024;

const authoringFileSchema = z
  .string()
  .max(MAX_FILE_BYTES)
  .refine(
    (value) => new TextEncoder().encode(value).byteLength <= MAX_FILE_BYTES,
    { message: "File exceeds the 100 KB authoring limit" },
  );

export const pluginAuthoringFilesSchema = z
  .object({
    "entry.tsx": authoringFileSchema,
    "savia-extension.json": authoringFileSchema,
    "store.json": authoringFileSchema,
    "preview.json": authoringFileSchema,
  })
  .strict();

export type PluginAuthoringFiles = z.infer<typeof pluginAuthoringFilesSchema>;

const reservedFixtureKeys = new Set(["__proto__", "prototype", "constructor"]);
const fixtureIdentifierSchema = z
  .string()
  .max(120)
  .refine((key) => !reservedFixtureKeys.has(key));

const previewFixtureSchema = z
  .object({
    collections: z.record(
      fixtureIdentifierSchema,
      z.array(z.record(fixtureIdentifierSchema, z.unknown())).max(200),
    ),
    settings: z.record(fixtureIdentifierSchema, z.unknown()),
  })
  .strict()
  .superRefine((fixture, context) => {
    const inspect = (value: unknown, path: (string | number)[]) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach((entry, index) => inspect(entry, [...path, index]));
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        if (reservedFixtureKeys.has(key)) {
          context.addIssue({
            code: "custom",
            path: [...path, key],
            message: "Preview fixtures cannot use prototype keys",
          });
        }
        inspect(child, [...path, key]);
      }
    };
    inspect(fixture, []);
  });

const historyEntrySchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(4_000),
  })
  .strict();

export const pluginAuthoringRequestSchema = z
  .object({
    tenantId: z.number().int().positive(),
    prompt: z.string().trim().min(1).max(8_000),
    files: pluginAuthoringFilesSchema,
    history: z.array(historyEntrySchema).max(10).optional(),
    diagnostics: z.string().max(12_000).optional(),
  })
  .strict()
  .superRefine((request, context) => {
    const totalBytes = new TextEncoder().encode(
      JSON.stringify({
        prompt: request.prompt,
        files: request.files,
        history: request.history,
        diagnostics: request.diagnostics,
      }),
    ).byteLength;
    if (totalBytes > MAX_TOTAL_REQUEST_BYTES) {
      context.addIssue({
        code: "custom",
        path: ["files"],
        message: "Authoring request is too large",
      });
    }
  });

export const pluginAuthoringResultSchema = z
  .object({
    message: z.string().trim().min(1).max(2_000),
    files: pluginAuthoringFilesSchema,
  })
  .strict();

/** The browser preview is inert JSON fixture data; generated code is never run here. */
export const pluginAuthoringPreviewSchema = previewFixtureSchema;
