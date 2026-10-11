import { z } from "zod";
import type { PluginIdeTheme } from "./plugin-ide-theme";

export const editorStateSchema = z.object({
  type: z.literal("savia-editor-state"),
  files: z.record(z.string(), z.string()),
  activeFile: z.string(),
  acknowledgements: z
    .record(z.string(), z.number().int().nonnegative())
    .default({}),
  readOnly: z.boolean(),
  extensions: z
    .array(z.enum(["savia.formatter", "savia.react-snippets"]))
    .max(2),
  selection: z
    .object({
      lineNumber: z.number().int().positive(),
      column: z.number().int().positive(),
      endColumn: z.number().int().positive(),
    })
    .nullable(),
  selectionId: z.string(),
  theme: z.custom<PluginIdeTheme>(),
});
export type EditorState = z.infer<typeof editorStateSchema>;
export const editorEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("savia-editor-ready") }),
  z.object({ type: z.literal("savia-editor-search") }),
  z.object({
    type: z.literal("savia-editor-change"),
    path: z.string(),
    value: z.string(),
    sequence: z.number().int().positive().default(1),
  }),
  z.object({
    type: z.literal("savia-editor-error"),
    message: z.string().max(2000),
  }),
]);

export function projectFileUri(path: string) {
  if (
    !path ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    /[\\\0]/.test(path)
  )
    throw new Error("Invalid project file path");
  return `file:///workspace/${path.split("/").map(encodeURIComponent).join("/")}`;
}
