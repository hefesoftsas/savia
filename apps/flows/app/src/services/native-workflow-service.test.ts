import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/config/api", () => ({
  getApiBaseUrl: () => "/__savia_flows_api",
}));

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => vi.unstubAllGlobals());

import {
  nativeWebhookCacheKey,
  nativeWebhookDestinationsCacheKey,
  publishNativeWorkflow,
  webhookCurlExample,
} from "./native-workflow-service";

describe("native webhook UI helpers", () => {
  it("scopes endpoint and destination cache keys to the organization", () => {
    expect(nativeWebhookCacheKey("org-a", "flow-7")).toBe(
      "/savia/native/org-a/workflows/flow-7/webhook",
    );
    expect(nativeWebhookDestinationsCacheKey("org-a")).toBe(
      "/savia/native/org-a/workflow-webhook-destinations",
    );
    expect(nativeWebhookCacheKey("org-b", "flow-7")).not.toBe(
      nativeWebhookCacheKey("org-a", "flow-7"),
    );
    expect(nativeWebhookDestinationsCacheKey("org-b")).not.toBe(
      nativeWebhookDestinationsCacheKey("org-a"),
    );
  });

  it("returns a clean copyable curl command without patch markers", () => {
    const example = webhookCurlExample("https://savia.example/hook");
    expect(example).toBe(
      [
        "curl -X POST 'https://savia.example/hook' \\",
        "  -H 'Content-Type: application/json' \\",
        "  -H 'Authorization: Bearer YOUR_SECRET' \\",
        "  -H 'Idempotency-Key: unique-event-id' \\",
        `  -d '{"name":"Example"}'`,
      ].join("\n"),
    );
    expect(example).not.toMatch(/^\+ /m);
  });
});

describe("publishNativeWorkflow", () => {
  beforeEach(() => fetchMock.mockReset());

  it("publishes the selected saved revision through the tenant-scoped native route", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "flow-7", revision: 4 } }), {
        status: 200,
      }),
    );

    await publishNativeWorkflow("tenant:101", "flow-7", 4);

    expect(fetchMock).toHaveBeenCalledWith(
      "/__savia_flows_api/tenant:101/savia/native/workflows/flow-7/publish",
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: 4 }),
      },
    );
  });

  it("preserves validation and revision-conflict details from the host API", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "REVISION_CONFLICT",
            message: "Draft changed. Reload before saving.",
          },
        }),
        { status: 409 },
      ),
    );

    await expect(
      publishNativeWorkflow("tenant:101", "flow-7", 4),
    ).rejects.toMatchObject({
      message: "Draft changed. Reload before saving.",
      status: 409,
      code: "REVISION_CONFLICT",
    });
  });
});
