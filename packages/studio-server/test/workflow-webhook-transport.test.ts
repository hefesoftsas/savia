import { it, expect } from "vitest";
import { sendWorkflowWebhook } from "../src/workflows/webhook-transport";
const input = {
  url: "https://hooks.hefesoft.com/events",
  authType: "bearer" as const,
  secret: "private-token",
  payload: '{"x":1}',
  key: "stable-key",
  executionId: "run",
  nodeId: "send",
};
function transport(
  response: () => Response,
  requests: Request[] = [],
  address = "93.184.216.34",
): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).includes("cloudflare-dns.com"))
      return Response.json({ Status: 0, Answer: [{ type: 1, data: address }] });
    requests.push(new Request(url, init));
    return response();
  }) as typeof fetch;
}
it("sends reserved headers and sanitizes response secrets", async () => {
  const requests: Request[] = [];
  const result = await sendWorkflowWebhook(input, {
    fetcher: transport(
      () => Response.json({ token: "abc", ok: "private-token" }),
      requests,
    ),
  });
  expect(result.status).toBe(200);
  expect(JSON.stringify(result)).not.toContain("private-token");
  expect(JSON.stringify(result)).not.toContain("abc");
  expect(requests[0].headers.get("idempotency-key")).toBe("stable-key");
  expect(requests[0].redirect).toBe("error");
});
it("classifies retries, clamps Retry-After and bounds streamed responses", async () => {
  const retry = await sendWorkflowWebhook(input, {
    fetcher: transport(
      () =>
        new Response("later", {
          status: 503,
          headers: { "retry-after": "999999" },
        }),
    ),
  });
  expect(retry.retryable).toBe(true);
  expect(retry.retryAfterMs).toBe(300000);
  const bad = await sendWorkflowWebhook(input, {
    fetcher: transport(() => new Response("bad", { status: 400 })),
  });
  expect(bad.retryable).toBe(false);
  const huge = await sendWorkflowWebhook(input, {
    fetcher: transport(() => new Response("a".repeat(40000))),
  });
  expect(huge.truncated).toBe(true);
  expect(JSON.stringify(huge).length).toBeLessThan(33500);
});
it("blocks private DNS and redirects", async () => {
  const requests: Request[] = [];
  expect(
    await sendWorkflowWebhook(input, {
      fetcher: transport(() => new Response("ok"), requests, "127.0.0.1"),
    }),
  ).toMatchObject({ retryable: false, status: null });
  expect(requests).toHaveLength(0);
  const redirect = await sendWorkflowWebhook(input, {
    fetcher: transport(() => new Response(null, { status: 302 })),
  });
  expect(redirect.retryable).toBe(false);
});
it("redacts the credential even when it occurs in a sensitive response key", async () => {
  const result = await sendWorkflowWebhook(input, {
    fetcher: transport(() => Response.json({ "private-token": "echo" })),
  });
  expect(JSON.stringify(result)).not.toContain("private-token");
});
it("returns retryable DNS outages instead of bypassing delivery checkpoints", async () => {
  const fetcher = (async () =>
    new Response("unavailable", { status: 503 })) as typeof fetch;
  const result = await sendWorkflowWebhook(input, { fetcher });
  expect(result.retryable).toBe(true);
  expect(result.status).toBeNull();
  expect(result.error).toBeTruthy();
});
