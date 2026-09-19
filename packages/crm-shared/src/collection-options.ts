import { z } from "zod";
const path = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)*$/)
  .max(200);
export const collectionOptionsSchema = z
  .object({
    domain: z.string().regex(/^[a-z][a-z0-9-]*$/),
    collection: z.string().regex(/^[a-z][a-z0-9-]*$/),
    valueField: path,
    labelField: path,
  })
  .strict();
export type CollectionOptionsSource = z.infer<typeof collectionOptionsSchema>;
export function optionPath(record: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value &&
        typeof value === "object" &&
        Object.prototype.hasOwnProperty.call(value, key)
          ? (value as Record<string, unknown>)[key]
          : undefined,
      record,
    );
}
