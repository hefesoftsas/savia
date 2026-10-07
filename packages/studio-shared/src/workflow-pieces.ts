import { z } from "zod";
import { workflowValueSchema, type WorkflowValue } from "./workflows";

const safePart = (part: string) =>
  !["__proto__", "constructor", "prototype"].includes(part);
const key = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,47}$/)
  .refine(safePart);

export const pieceFieldSchema = z
  .object({
    key,
    label: z.string().trim().min(1).max(100),
    type: z.enum(["text", "number", "boolean", "select"]),
    options: z.array(z.string().min(1).max(100)).min(1).max(20).optional(),
    required: z.boolean().optional(),
    hint: z.string().trim().max(200).optional(),
  })
  .strict()
  .superRefine((field, ctx) => {
    if ((field.type === "select") !== (field.options !== undefined))
      ctx.addIssue({
        code: "custom",
        message: "Only select fields declare options",
      });
  });
export type PieceField = z.infer<typeof pieceFieldSchema>;

export const workflowPieceSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,63}$/)
      .refine(safePart),
    version: z.number().int().positive(),
    label: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional(),
    inputs: z.array(pieceFieldSchema).max(20).default([]),
    outputs: z.array(key).max(20).default([]),
    retryable: z.boolean().optional(),
  })
  .strict();
export type WorkflowPiece = z.infer<typeof workflowPieceSchema>;

function literalKind(value: WorkflowValue): string {
  if (value === null) return "null";
  if (typeof value !== "object") return typeof value;
  if ("ref" in value) return "ref";
  return "expression";
}

/**
 * Static config check. References always pass here and are type-checked at
 * execution; literals must already match the declared field type.
 */
export function validatePieceConfig(
  piece: WorkflowPiece,
  config: Record<string, WorkflowValue>,
): string[] {
  const errors: string[] = [];
  const fields = new Map(piece.inputs.map((field) => [field.key, field]));
  for (const name of Object.keys(config))
    if (!fields.has(name)) errors.push(`Unknown piece input: ${name}`);
  for (const field of piece.inputs) {
    const value = config[field.key];
    if (value === undefined || value === null) {
      if (field.required) errors.push(`Piece input is required: ${field.key}`);
      continue;
    }
    const kind = literalKind(value);
    if (kind === "ref" || kind === "expression") continue;
    const ok =
      field.type === "text"
        ? kind === "string"
        : field.type === "number"
          ? kind === "number"
          : field.type === "boolean"
            ? kind === "boolean"
            : kind === "string" &&
              (typeof value === "string"
                ? (field.options ?? []).includes(value)
                : false);
    if (!ok) errors.push(`Piece input has the wrong type: ${field.key}`);
  }
  return errors;
}

export function checkPieceValue(
  piece: WorkflowPiece,
  name: string,
  value: unknown,
): string | null {
  const field = piece.inputs.find((entry) => entry.key === name);
  if (!field) return `Unknown piece input: ${name}`;
  if (value === null || value === undefined)
    return field.required ? `Piece input is required: ${name}` : null;
  const ok =
    field.type === "text"
      ? typeof value === "string"
      : field.type === "number"
        ? typeof value === "number" && Number.isFinite(value)
        : field.type === "boolean"
          ? typeof value === "boolean"
          : typeof value === "string" && (field.options ?? []).includes(value);
  return ok ? null : `Piece input has the wrong type: ${name}`;
}
