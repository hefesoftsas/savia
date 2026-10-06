import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  pluginCompletionRequestSchema,
  pluginCompletionResultSchema,
} from "@savia/studio-shared/plugin-completion";
import { APICallError, generateText } from "ai";
import type { AssistantConfigurationRepository } from "./configuration";

export type PluginCompletionInput = {
  principalId: string;
  isPlatformAdministrator?: boolean;
  tenantId: number;
  filename?: string;
  prefix: string;
  suffix: string;
  signal?: AbortSignal;
};

export class PluginCompletionError extends Error {
  constructor(
    readonly status: 400 | 403 | 502 | 503 | 504,
    readonly code:
      | "VALIDATION_ERROR"
      | "AUTHORIZATION_FORBIDDEN"
      | "PLUGIN_COMPLETION_NOT_CONFIGURED"
      | "PLUGIN_COMPLETION_TIMEOUT"
      | "PLUGIN_COMPLETION_CANCELLED"
      | "PLUGIN_COMPLETION_UNAVAILABLE",
    message: string,
  ) {
    super(message);
  }
}

type GenerateText = typeof generateText;
type PluginCompletionConfiguration = Pick<
  AssistantConfigurationRepository,
  | "assertTenantAdministrator"
  | "effectiveConfigurationForTenant"
  | "effectiveConfigurationForPlatformTenant"
>;

const completionSystem = `You are an inline code completion engine inside the Savia plugin IDE. The file being edited is a Savia plugin entry source: a single self-contained TSX module that exports render(element, savia) and may use the injected React and createRoot globals. It must contain no import declarations of any kind.

Return ONLY the code that continues exactly at the cursor. No explanations, no markdown fences, no surrounding quotes. Keep the completion short (a few lines at most) and consistent with the surrounding code. Never emit import/export-from statements, network calls, browser storage access, eval, or new Function. An empty string is an acceptable answer when no continuation fits.`;

const forbiddenLine = /^\s*(import\b|export\s+[^;]*\bfrom\s*["'])/;

function sanitizeCompletion(text: string): string {
  return text
    .split("\n")
    .filter((line) => !forbiddenLine.test(line) && line.trim() !== "```")
    .join("\n")
    .trim()
    .slice(0, 2000);
}

const defaultCompletionTimeoutMs = 12_000;

export function createPluginCompletionService(
  configuration: PluginCompletionConfiguration,
  dependencies: {
    generateText?: GenerateText;
    timeoutMs?: number;
  } = {},
) {
  const generate = dependencies.generateText ?? generateText;

  return {
    async complete(
      input: PluginCompletionInput,
    ): Promise<{ completion: string }> {
      const { principalId, isPlatformAdministrator, signal, ...wireInput } =
        input;
      const parsed = pluginCompletionRequestSchema.safeParse(wireInput);
      if (!parsed.success) {
        throw new PluginCompletionError(
          400,
          "VALIDATION_ERROR",
          "Invalid plugin completion request",
        );
      }
      const deadlineSignal = AbortSignal.timeout(
        dependencies.timeoutMs ?? defaultCompletionTimeoutMs,
      );
      const operationSignal = signal
        ? AbortSignal.any([signal, deadlineSignal])
        : deadlineSignal;

      let effective;
      if (isPlatformAdministrator) {
        effective = await configuration.effectiveConfigurationForPlatformTenant(
          input.tenantId,
        );
      } else {
        await configuration.assertTenantAdministrator(
          principalId,
          input.tenantId,
        );
        effective = await configuration.effectiveConfigurationForTenant(
          principalId,
          input.tenantId,
        );
      }
      if (!effective.apiKey) {
        throw new PluginCompletionError(
          503,
          "PLUGIN_COMPLETION_NOT_CONFIGURED",
          "AI completions are not configured for this workspace.",
        );
      }

      const openrouter = createOpenRouter({ apiKey: effective.apiKey });
      try {
        const result = await generate({
          model: openrouter(effective.model),
          system: completionSystem,
          prompt: `<prefix>${parsed.data.prefix}</prefix><cursor/><suffix>${parsed.data.suffix}</suffix>`,
          maxOutputTokens: 256,
          temperature: 0.1,
          abortSignal: operationSignal,
          maxRetries: 0,
        });
        return pluginCompletionResultSchema.parse({
          completion: sanitizeCompletion(result.text),
        });
      } catch (error) {
        if (error instanceof PluginCompletionError) throw error;
        if (operationSignal.aborted) {
          if (deadlineSignal.aborted) {
            throw new PluginCompletionError(
              504,
              "PLUGIN_COMPLETION_TIMEOUT",
              "The completion took too long.",
            );
          }
          throw new PluginCompletionError(
            503,
            "PLUGIN_COMPLETION_CANCELLED",
            "The completion was cancelled.",
          );
        }
        if (APICallError.isInstance(error)) {
          if (
            error.statusCode === 408 ||
            error.statusCode === 504 ||
            error.statusCode === 529
          ) {
            throw new PluginCompletionError(
              504,
              "PLUGIN_COMPLETION_TIMEOUT",
              "The AI provider took too long to respond.",
            );
          }
        }
        throw new PluginCompletionError(
          503,
          "PLUGIN_COMPLETION_UNAVAILABLE",
          "AI completions are temporarily unavailable.",
        );
      }
    },
  };
}
