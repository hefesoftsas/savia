import { z } from "zod";

const safeArgumentName = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/)
  .refine(
    (name) =>
      !name
        .split(".")
        .some((part) =>
          ["__proto__", "prototype", "constructor"].includes(part),
        ),
  );

const jsonPointerSchema = z
  .string()
  .max(300)
  .refine(
    (pointer) =>
      pointer === "" ||
      (pointer.startsWith("/") &&
        !/~(?![01])/.test(pointer) &&
        !pointer
          .split("/")
          .some((part) =>
            ["__proto__", "prototype", "constructor"].includes(
              part.replace(/~1/g, "/").replace(/~0/g, "~"),
            ),
          )),
  );

export const mcpMappingSchema = z
  .object({
    arguments: z.record(safeArgumentName, z.unknown()).default({}),
    itemsPointer: jsonPointerSchema.default(""),
    idField: z
      .string()
      .min(1)
      .max(100)
      .refine((field) => !/[\u0000-\u001f\u007f]/.test(field))
      .refine(
        (field) => !["__proto__", "constructor", "prototype"].includes(field),
      ),
    pagination: z
      .object({
        limitArgument: safeArgumentName,
        offsetArgument: safeArgumentName,
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((mapping, context) => {
    if (
      mapping.pagination &&
      mapping.pagination.limitArgument === mapping.pagination.offsetArgument
    )
      context.addIssue({
        code: "custom",
        path: ["pagination", "offsetArgument"],
        message: "Limit and offset arguments must be different.",
      });
  });

export type McpMapping = z.infer<typeof mcpMappingSchema>;

export type McpFieldType = "Textbox" | "Textarea" | "Number" | "Toggle";

export type McpSourceField = {
  type: McpFieldType;
  label: string;
  readOnly: true;
};
