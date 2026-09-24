import { publicUrl, validatePublicDns } from "../integrations";
import { fail } from "../context";
import type { WebhookDependencies } from "./webhook-destinations";
export type WebhookTransportResult = {
  status: number | null;
  retryable: boolean;
  retryAfterMs: number | null;
  output: unknown;
  error: string | null;
  truncated: boolean;
};
export async function sendWorkflowWebhook(
  input: {
    url: string;
    authType: "none" | "bearer" | "api-key";
    authHeader?: string;
    secret?: string;
    payload: string;
    key: string;
    executionId: string;
    nodeId: string;
  },
  dependencies: WebhookDependencies = {},
): Promise<WebhookTransportResult> {
  const url = publicUrl(input.url);
  if (new TextEncoder().encode(input.payload).length > 32768)
    fail("Webhook payload exceeds 32 KiB", 413);
  const signal = AbortSignal.timeout(10000),
    fetcher = dependencies.fetcher ?? fetch;
  const boundedFetch: typeof fetch = (resource, init) =>
    fetcher(resource, { ...init, signal });
  const headers = new Headers({
    "content-type": "application/json",
    "idempotency-key": input.key,
    "x-savia-execution-id": input.executionId,
    "x-savia-node-id": input.nodeId,
  });
  if (input.authType === "bearer")
    headers.set("authorization", `Bearer ${input.secret}`);
  if (input.authType === "api-key")
    headers.set(input.authHeader!, input.secret!);
  const redact = (v: unknown, depth = 0): unknown => {
    if (depth > 50) return "[redacted]";
    if (typeof v === "string")
      return input.secret ? v.split(input.secret).join("[redacted]") : v;
    if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [
          String(redact(k)),
          /authorization|password|secret|token|api[-_]?key|cookie/i.test(k)
            ? "[redacted]"
            : redact(x, depth + 1),
        ]),
      );
    return v;
  };
  try {
    await validatePublicDns(url, boundedFetch);
    const response = await boundedFetch(url, {
      method: "POST",
      headers,
      body: input.payload,
      redirect: "error",
    });
    let size = 0,
      truncated = false;
    const parts: Uint8Array[] = [];
    const reader = response.body?.getReader();
    if (reader)
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const remaining = 32768 - size;
          parts.push(value.subarray(0, remaining));
          size += Math.min(remaining, value.length);
          if (value.length > remaining) {
            truncated = true;
            await reader.cancel();
            break;
          }
        }
      } finally {
        reader.releaseLock();
      }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const p of parts) {
      bytes.set(p, offset);
      offset += p.length;
    }
    const text = new TextDecoder().decode(bytes);
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* Plain or truncated response. */
    }
    // A truncated response may cut through a credential; do not retain partial text.
    const output = {
      status: response.status,
      body: truncated ? "[response truncated]" : redact(body),
      truncated,
    };
    const header = response.headers.get("retry-after");
    const delay = header
      ? /^\d+$/.test(header)
        ? Number(header) * 1000
        : Date.parse(header) - (dependencies.now?.() ?? Date.now())
      : NaN;
    return {
      status: response.status,
      retryable: [408, 429].includes(response.status) || response.status >= 500,
      retryAfterMs: Number.isFinite(delay)
        ? Math.min(300000, Math.max(0, delay))
        : null,
      output,
      error: response.ok ? null : `Webhook returned HTTP ${response.status}`,
      truncated,
    };
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error
        ? Number(error.status)
        : 0;
    const retryable = !status || status >= 500;
    return {
      status: null,
      retryable,
      retryAfterMs: null,
      output: null,
      error: retryable
        ? "Webhook network or DNS failure or timeout"
        : "Webhook destination rejected by public DNS validation",
      truncated: false,
    };
  }
}
