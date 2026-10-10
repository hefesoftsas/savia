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

/** Drafts preserve invalid/incomplete source so the editor can save work in progress. */
export const pluginProjectFilesSchema = z
  .object({
    "entry.tsx": entryFile,
    "savia-extension.json": metadataFile,
    "store.json": metadataFile,
    "preview.json": metadataFile,
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
