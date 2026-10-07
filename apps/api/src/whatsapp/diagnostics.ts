/** Operational metadata only: never pass prompts, payloads, contact numbers or errors. */
export type WhatsappDiagnosticContext = {
  message_id?: string;
  action_id?: string;
  generation?: string;
  selection_revision?: number;
};

type Fields = {
  stage?: string;
  operation?: string;
  outcome?: string;
  duration_ms?: number;
  error_code?: string;
  http_status?: number;
  call_id?: string;
  reset_applied?: boolean;
  attempt?: number;
  input_tokens?: number;
  output_tokens?: number;
  queue_wait_ms?: number;
  event_count?: number;
};

export function logWhatsappDiagnostic(
  event: string,
  context: WhatsappDiagnosticContext,
  fields: Fields,
) {
  try {
    const metadata: Record<string, unknown> = { event };
    for (const key of [
      "message_id",
      "action_id",
      "generation",
      "selection_revision",
    ] as const)
      if (context[key] !== undefined) metadata[key] = context[key];
    for (const key of [
      "stage",
      "operation",
      "outcome",
      "duration_ms",
      "error_code",
      "http_status",
      "call_id",
      "reset_applied",
      "attempt",
      "input_tokens",
      "output_tokens",
      "queue_wait_ms",
      "event_count",
    ] as const)
      if (fields[key] !== undefined) metadata[key] = fields[key];
    console.info(JSON.stringify(metadata));
  } catch {
    // Observability must not affect delivery or action execution.
  }
}

export function diagnosticHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("statusCode" in error))
    return undefined;
  const status = error.statusCode;
  return typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 599
    ? status
    : undefined;
}

export function diagnosticErrorCode(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError") return "timeout";
    if (error.name === "AbortError") return "aborted";
    if (
      [
        "CHANNEL_ACCESS_REVOKED",
        "CHANNEL_COLLECTION_REVOKED",
        "CHANNEL_ACTION_REVOKED",
        "CHANNEL_PRINCIPAL_REVOKED",
        "CHANNEL_MEMBERSHIP_REVOKED",
        "CHANNEL_CAPABILITY_UNAVAILABLE",
      ].includes(error.message)
    )
      return "access_revoked";
  }
  return diagnosticHttpStatus(error) ? "http_error" : "operation_failed";
}

export async function traceWhatsappOperation<T>(
  context: WhatsappDiagnosticContext,
  operation: string,
  work: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  const call_id = crypto.randomUUID();
  logWhatsappDiagnostic("whatsapp_operation", context, {
    operation,
    call_id,
    outcome: "started",
  });
  try {
    const result = await work();
    const response = result instanceof Response ? result : undefined;
    const rejected =
      result !== null &&
      typeof result === "object" &&
      "isError" in result &&
      result.isError === true;
    logWhatsappDiagnostic("whatsapp_operation", context, {
      operation,
      call_id,
      outcome:
        response && !response.ok
          ? "failed"
          : rejected
            ? "rejected"
            : "completed",
      duration_ms: Math.max(0, Date.now() - started),
      ...(response
        ? {
            http_status: response.status,
            ...(!response.ok ? { error_code: "http_error" } : {}),
          }
        : {}),
    });
    return result;
  } catch (error) {
    logWhatsappDiagnostic("whatsapp_operation", context, {
      operation,
      call_id,
      outcome: "failed",
      duration_ms: Math.max(0, Date.now() - started),
      error_code: diagnosticErrorCode(error),
      http_status: diagnosticHttpStatus(error),
    });
    throw error;
  }
}
