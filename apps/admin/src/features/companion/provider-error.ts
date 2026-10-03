import { ApiClientError } from "@/api/api-client";
import type { MessageParams } from "@/i18n/core";
import { companionMessages } from "@/i18n/locales/companion";

export type ProviderOperation = "transcription" | "summary" | "question";
export type ProviderFailure = Readonly<{
  operation: ProviderOperation;
  status: number;
}>;
export type ProcessingFailure = Readonly<{ kind: "processing-failed" }>;
export const processingFailure: ProcessingFailure = {
  kind: "processing-failed",
};
type CompanionMessageKey = keyof typeof companionMessages & string;
type Translate = (key: CompanionMessageKey, params?: MessageParams) => string;

export function readProviderFailure(error: unknown): ProviderFailure | null {
  if (!(error instanceof ApiClientError) || !error.details) return null;
  const details = error.details as {
    error?: { providerOperation?: unknown; upstreamStatus?: unknown };
  };
  const operation = details.error?.providerOperation,
    status = details.error?.upstreamStatus;
  if (
    (operation !== "transcription" &&
      operation !== "summary" &&
      operation !== "question") ||
    typeof status !== "number" ||
    !Number.isInteger(status) ||
    status < 100 ||
    status > 599
  )
    return null;

  return { operation, status };
}

export function providerFailureMessage(
  failure: ProviderFailure,
  t: Translate,
): string {
  const message: Record<ProviderOperation, CompanionMessageKey> = {
    transcription: "Transcription provider returned HTTP %{status}.",
    summary: "Summary provider returned HTTP %{status}.",
    question: "Question provider returned HTTP %{status}.",
  };
  return t(message[failure.operation], { status: failure.status });
}
