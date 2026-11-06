import { z } from "@hono/zod-openapi";

const displayCellSchema = z.union([
  z.string().max(160),
  z.number().finite(),
  z.null(),
]);

const tableVisualizationSchema = z
  .object({
    kind: z.literal("table"),
    columns: z.array(z.string().trim().min(1).max(80)).min(1).max(6),
    rows: z.array(z.array(displayCellSchema).min(1).max(6)).min(1).max(24),
  })
  .refine(
    ({ columns, rows }) => rows.every((row) => row.length === columns.length),
    {
      message: "Every table row must have one value per column",
    },
  );

const chartVisualizationSchema = z.object({
  kind: z.enum(["bar", "line"]),
  valueLabel: z.string().trim().min(1).max(80),
  series: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(80),
        value: z.number().finite(),
      }),
    )
    .min(1)
    .max(12),
});

export const presentationInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(240).optional(),
  visualization: z.union([tableVisualizationSchema, chartVisualizationSchema]),
});

export type AssistantPresentationInput = z.infer<
  typeof presentationInputSchema
>;
