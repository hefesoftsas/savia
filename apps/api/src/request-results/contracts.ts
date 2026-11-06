import { z } from "@hono/zod-openapi";
const text = z.string().nullable();
export const requestResultSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    type: z.string(),
    status: z.enum(["success", "partial", "no_result", "error", "pending"]),
    data: z.unknown(),
    errors: z.array(
      z.object({ code: z.string(), message: z.string(), field: text }),
    ),
    warnings: z.array(
      z.object({ code: z.string(), message: z.string(), field: text }),
    ),
    metadata: z.object({
      provider: text,
      flowId: text,
      runId: text,
      versionId: text,
      createdAt: text,
      simulated: z.boolean().nullable(),
      adapter: text,
      providerFields: z.record(z.string(), z.unknown()),
    }),
  })
  .openapi("RequestResult");
export type RequestResult = z.infer<typeof requestResultSchema>;
