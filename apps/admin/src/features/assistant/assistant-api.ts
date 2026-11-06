type AssistantActionOperation = "confirm" | "cancel";

type RequestAssistantActionOptions = {
  apiUrl: string;
  actionId: string;
  operation: AssistantActionOperation;
  accessToken: string;
  fetcher?: typeof fetch;
};

function assistantActionUrl(
  apiUrl: string,
  actionId: string,
  operation: AssistantActionOperation,
): string {
  return new URL(
    `/api/assistant/actions/${encodeURIComponent(actionId)}/${operation}`,
    apiUrl,
  ).toString();
}

function errorMessage(payload: unknown): string {
  if (typeof payload === "object" && payload !== null) {
    const value = payload as { error?: unknown; message?: unknown };
    if (typeof value.error === "string") return value.error;
    if (
      typeof value.error === "object" &&
      value.error !== null &&
      typeof (value.error as { message?: unknown }).message === "string"
    ) {
      return (value.error as { message: string }).message;
    }
    if (typeof value.message === "string") return value.message;
  }

  return "No fue posible completar la acción solicitada.";
}

export async function requestAssistantAction({
  apiUrl,
  actionId,
  operation,
  accessToken,
  fetcher = fetch,
}: RequestAssistantActionOptions): Promise<unknown> {
  const response = await fetcher(
    assistantActionUrl(apiUrl, actionId, operation),
    {
      method: "POST",
      credentials: "include",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    throw new Error(errorMessage(payload));
  }

  return payload;
}
