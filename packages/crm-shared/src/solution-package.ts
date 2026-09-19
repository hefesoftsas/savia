import { z } from "zod";
import { objectSchema } from "./metadata";

export const solutionIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/)
  .max(100);
export const solutionPackageSchema = z
  .object({
    format: z.literal("savia.solution"),
    formatVersion: z.literal(1),
    id: solutionIdSchema,
    version: z
      .string()
      .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
      .max(30),
    label: z.string().trim().min(1).max(100),
    description: z.string().max(1000),
    requires: z.array(solutionIdSchema).max(30).default([]),
    objects: z.array(objectSchema).max(100),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const names = new Set<string>();
    for (const [index, object] of manifest.objects.entries()) {
      if (names.has(object.name))
        ctx.addIssue({
          code: "custom",
          path: ["objects", index, "name"],
          message: "Identificador de objeto duplicado.",
        });
      names.add(object.name);
      for (const field of Object.values(object.config.fields))
        if (field.config?.formHtml?.script?.trim())
          ctx.addIssue({
            code: "custom",
            path: ["objects", index, "config"],
            message:
              "Los paquetes declarativos no admiten scripts ejecutables.",
          });
      if (
        object.config.studio?.collection ||
        object.config.studio?.capabilities ||
        object.config.studio?.business
      )
        ctx.addIssue({
          code: "custom",
          path: ["objects", index, "config"],
          message:
            "Un paquete declarativo no puede conceder capacidades ni conectar datos internos.",
        });
    }
  });
export type SolutionPackage = z.infer<typeof solutionPackageSchema>;

export function canonicalJson(value: unknown): string {
  const normalize = (input: unknown): unknown =>
    Array.isArray(input)
      ? input.map(normalize)
      : input && typeof input === "object"
        ? Object.fromEntries(
            Object.entries(input)
              .filter(([, v]) => v !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, normalize(v)]),
          )
        : input;
  return JSON.stringify(normalize(value));
}

export function compareSolutionVersions(a: string, b: string): number {
  const left = a.split(".").map(Number),
    right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  return 0;
}
