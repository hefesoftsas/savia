import { z } from "zod";
import { PLUGIN_STORE_MAX_ENTRY_BYTES } from "./plugin-store";

const metadataFile = z
  .string()
  .max(100 * 1024)
  .refine((value) => new TextEncoder().encode(value).byteLength <= 100 * 1024, {
    message: "File exceeds the 100 KB authoring limit",
  });

const entryFile = z
  .string()
  .max(PLUGIN_STORE_MAX_ENTRY_BYTES)
  .refine(
    (value) =>
      new TextEncoder().encode(value).byteLength <=
      PLUGIN_STORE_MAX_ENTRY_BYTES,
    { message: "Compiled plugin entry exceeds the 2 MB limit" },
  );

export const PLUGIN_PROJECT_MAX_BYTES = 5 * 1024 * 1024;
export const PLUGIN_ORIGINAL_SOURCE_MAX_BYTES = 2 * 1024 * 1024;
export const PLUGIN_ORIGINAL_SOURCE_MAX_FILES = 256;

const originalSourcePathSchema = z.string().refine((path) => {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes(":")
  )
    return false;
  const segments = path.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        ["__proto__", "prototype", "constructor"].includes(
          segment.replace(/\.[^.]*$/, ""),
        ),
    )
  )
    return false;
  return /\.(?:ts|tsx|js|jsx|css|json)$/.test(path);
}, "Original source paths must be canonical workspace-relative source files");

export const pluginOriginalSourceMapSchema = z
  .record(originalSourcePathSchema, z.string())
  .superRefine((files, context) => {
    if (Object.keys(files).length > PLUGIN_ORIGINAL_SOURCE_MAX_FILES)
      context.addIssue({
        code: "custom",
        message: `Original source contains more than ${PLUGIN_ORIGINAL_SOURCE_MAX_FILES} files`,
      });
    const bytes = new TextEncoder().encode(JSON.stringify(files)).byteLength;
    if (bytes > PLUGIN_ORIGINAL_SOURCE_MAX_BYTES)
      context.addIssue({
        code: "custom",
        message: "Original source exceeds the 2 MB limit",
      });
  });

/** Schema for the parsed map serialized in `original-source.json`. */
export const pluginOriginalSourceFilesSchema = pluginOriginalSourceMapSchema;

export type PluginOriginalSourceMap = z.infer<
  typeof pluginOriginalSourceMapSchema
>;

/** Parse and validate the JSON archive of original workspace source files. */
export function parsePluginOriginalSourceFiles(
  text: string,
): PluginOriginalSourceMap {
  if (
    new TextEncoder().encode(text).byteLength > PLUGIN_ORIGINAL_SOURCE_MAX_BYTES
  )
    throw new Error("Original source exceeds the 2 MB limit");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Original source must contain a JSON object");
  }
  return pluginOriginalSourceMapSchema.parse(value);
}

const originalSourceFile = z
  .string()
  .max(PLUGIN_ORIGINAL_SOURCE_MAX_BYTES)
  .refine(
    (value) =>
      new TextEncoder().encode(value).byteLength <=
      PLUGIN_ORIGINAL_SOURCE_MAX_BYTES,
    { message: "Original source exceeds the 2 MB limit" },
  )
  .superRefine((value, context) => {
    try {
      parsePluginOriginalSourceFiles(value);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message:
          error instanceof Error ? error.message : "Invalid original source",
      });
    }
  });

/** Drafts preserve invalid/incomplete source so the editor can save work in progress. */
export const pluginProjectFilesSchema = z
  .object({
    "entry.tsx": entryFile,
    "savia-extension.json": metadataFile,
    "store.json": metadataFile,
    "preview.json": metadataFile,
    "original-source.json": originalSourceFile.optional(),
  })
  .strict();

export type PluginProjectFiles = z.infer<typeof pluginProjectFilesSchema>;

export const pluginProjectHistoryEntrySchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(4_000),
  })
  .strict();

export const pluginProjectHistorySchema = z
  .array(pluginProjectHistoryEntrySchema)
  .max(10);

export const pluginProjectSaveSchema = z
  .object({
    files: pluginProjectFilesSchema,
    history: pluginProjectHistorySchema,
    version: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      new TextEncoder().encode(JSON.stringify(request)).byteLength >
      PLUGIN_PROJECT_MAX_BYTES
    )
      context.addIssue({
        code: "custom",
        path: ["files"],
        message: "Project is too large",
      });
  });

export type PluginProjectSave = z.infer<typeof pluginProjectSaveSchema>;

export const pluginProjectIdSchema = z.string().uuid();

export const pluginStoreSourceFilesSchema = pluginProjectFilesSchema;
export type PluginStoreSourceFiles = PluginProjectFiles;
