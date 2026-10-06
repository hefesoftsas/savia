import { z } from "zod";

const MAX_CONTEXT_CHARS = 8_000;
const MAX_COMPLETION_CHARS = 2_000;

const contextSchema = z.string().max(MAX_CONTEXT_CHARS);

export const pluginCompletionRequestSchema = z
  .object({
    tenantId: z.number().int().positive(),
    filename: z.string().trim().min(1).max(64).optional(),
    prefix: contextSchema,
    suffix: contextSchema,
  })
  .strict();

export type PluginCompletionRequest = z.infer<
  typeof pluginCompletionRequestSchema
>;

export const pluginCompletionResultSchema = z
  .object({
    completion: z.string().max(MAX_COMPLETION_CHARS),
  })
  .strict();

export type PluginCompletionResult = z.infer<
  typeof pluginCompletionResultSchema
>;
