import { publicUrl, validatePublicDns } from "../integrations";
import { fail } from "../context";
import { redactSecrets } from "./webhook-transport";
import type { WebhookDependencies } from "./webhook-destinations";

export type HttpRequestResult = {
  status: number | null;
  output: { status: number; body: unknown; truncated: boolean } | null;
  error: string | null;
  retryable: boolean;
};

/**
 * Generic HTTPS client for the http workflow step. Same transport bounds as
 * outgoing webhooks (public 443-only URLs, DNS preflight, no redirects,
 * 10s budget, 32 KiB response cap with truncation marker), but stateless:
 * no delivery rows, so it stays loop-safe. Retries are left to the workflow
 * executor; only the outcome classification is reported here.
 */
export async function sendWorkflowHttpRequest(
  input: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    url: string;
    headers: Record<string, string>;
    query: Record<string, string>;
    body?: string;
    authType: "none" | "bearer" | "api-key";
    authHeader?: string;
    secret?: string;
  },
  dependencies: WebhookDependencies = {},
): Promise<HttpRequestResult> {
  const url = publicUrl(input.url);
  for (const [name, value] of Object.entries(input.query))
    url.searchParams.set(name, value);
  if (input.body !== undefined) {
    if (
      input.method !== "POST" &&
      input.method !== "PUT" &&
      input.method !== "PATCH"
    )
      fail("GET and DELETE requests cannot carry a JSON body", 422);
    if (new TextEncoder().encode(input.body).length > 32768)
      fail("HTTP payload exceeds 32 KiB", 413);
  }
  const signal = AbortSignal.timeout(10000),
    fetcher = dependencies.fetcher ?? fetch;
  const boundedFetch: typeof fetch = (resource, init) =>
    fetcher(resource, { ...init, signal });
  const headers = new Headers();
  for (const [name, value] of Object.entries(input.headers))
    headers.set(name, value);
  if (input.body !== undefined) headers.set("content-type", "application/json");
  if (input.authType === "bearer")
    headers.set("authorization", `Bearer ${input.secret}`);
  if (input.authType === "api-key")
    headers.set(input.authHeader!, input.secret!);
  try {
    await validatePublicDns(url, boundedFetch);
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error
        ? Number(error.status)
        : 0;
    if (status === 502) throw new Error("Public DNS check failed; retrying");
    throw error;
  }
  let response: Response;
  try {
    response = await boundedFetch(url, {
      method: input.method,
      headers,
      body: input.body,
      redirect: "error",
    });
  } catch {
    throw new Error("HTTP network failure or timeout");
  }
  let size = 0,
    truncated = false;
  const parts: Uint8Array[] = [];
  try {
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
  } catch {
    throw new Error("HTTP network failure or timeout");
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  const text = new TextDecoder().decode(bytes);
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* Plain or truncated response. */
  }
  const output = {
    status: response.status,
    body: truncated
      ? "[response truncated]"
      : redactSecrets(body, [input.secret]),
    truncated,
  };
  const retryable =
    [408, 429].includes(response.status) || response.status >= 500;
  return {
    status: response.status,
    output,
    error: response.ok ? null : `HTTP request returned ${response.status}`,
    retryable,
  };
}
