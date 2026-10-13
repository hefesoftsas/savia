import { getApiBaseUrl } from "@/config/api";
import type { NativeDefinition } from "@/features/native-flows/native-graph";

export type NativeWorkflow = {
  id: string;
  name: string;
  revision: number;
  definition: NativeDefinition;
  enabled: number;
  published_version?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type NativeRun = {
  id: string;
  status: string;
  wake_at?: number;
  version_id: string;
  node_id: string | null;
  error?: string;
  created_at: string;
  deliveries?: {
    node_id: string;
    sequence: number;
    status: number | null;
    error: string | null;
    finished_at: number | null;
  }[];
  jobs?: { node_id: string; type: string; output: unknown; attempts: number }[];
};

export const nativeWebhookCacheKey = (
  organizationId: string,
  workflowId: string,
) => `/savia/native/${organizationId}/workflows/${workflowId}/webhook`;

export const nativeWebhookDestinationsCacheKey = (organizationId: string) =>
  `/savia/native/${organizationId}/workflow-webhook-destinations`;

export function webhookCurlExample(url: string): string {
  return `curl -X POST '${url}' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer YOUR_SECRET' \\
  -H 'Idempotency-Key: unique-event-id' \\
  -d '{"name":"Example"}'`;
}

export function nativeWorkflowRequest<T>(
  organizationId: string,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  return fetch(`${getApiBaseUrl()}/${organizationId}/savia/native${path}`, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).then(async (response) => {
    if (response.status === 204 || response.status === 205)
      return undefined as T;
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message =
        typeof payload?.error === "string"
          ? payload.error
          : typeof payload?.error?.message === "string"
            ? payload.error.message
            : typeof payload?.message === "string"
              ? payload.message
              : `Request failed with status ${response.status}`;
      throw Object.assign(new Error(message), {
        status: response.status,
        code: payload?.error?.code ?? payload?.code,
        detail: payload,
      });
    }
    return payload as T;
  });
}

export function publishNativeWorkflow(
  organizationId: string,
  workflowId: string,
  revision: number,
): Promise<{ data: NativeWorkflow }> {
  return nativeWorkflowRequest(
    organizationId,
    `/workflows/${workflowId}/publish`,
    "POST",
    { revision },
  );
}
