import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "@/api/api-client";
import {
  createSaviaFlowsHostBridge,
  isSafeFlowsPath,
  saviaFlowsGateState,
} from "./bridge";
import { saviaFlowsFrameKey } from "./savia-flows-page";

function setup(fetcher: typeof fetch = vi.fn(async () => new Response("ok"))) {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const api = new ApiClient({
    baseUrl: window.location.origin,
    tokenSource: { getAccessToken: async () => "secret" },
    fetcher,
  });
  const host = createSaviaFlowsHostBridge({
    frame,
    api,
    tenantId: 7,
    origin: window.location.origin,
  });
  host.start();
  return { frame, host, channel: host.channel };
}

function message(
  frame: HTMLIFrameElement,
  data: unknown,
  overrides: { origin?: string; source?: MessageEventSource | null } = {},
) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      origin: overrides.origin ?? window.location.origin,
      source: overrides.source ?? frame.contentWindow,
    }),
  );
}

afterEach(() => document.body.replaceChildren());

describe("Savia Flows host bridge", () => {
  it("accepts only same-origin messages from its iframe and preserves tenant binding", async () => {
    let request: Request | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      request = new Request(input, init);
      return new Response("ok");
    };
    const { frame, host, channel } = setup(fetcher);
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    message(
      frame,
      {
        namespace: "savia-flows",
        channel,
        id: "a",
        type: "request",
        path: "/types",
      },
      { origin: "https://evil.test" },
    );
    message(
      frame,
      {
        namespace: "savia-flows",
        channel,
        id: "b",
        type: "request",
        path: "/types",
      },
      { source: window },
    );
    expect(request).toBeUndefined();
    message(frame, {
      namespace: "savia-flows",
      channel,
      id: "c",
      type: "request",
      path: "/types",
    });
    await vi.waitFor(() => expect(request).toBeDefined());
    expect(request?.url).toBe(
      `${window.location.origin}/v1/savia-flows/types?tenant=tenant%3A7`,
    );
    expect(request?.headers.get("authorization")).toBe("Bearer secret");
    expect(post).toHaveBeenCalled();
    host.dispose();
  });

  it("rejects traversal, encoded traversal and external URLs", () => {
    for (const path of [
      "https://evil.test",
      "//evil.test/x",
      "/../x",
      "/%2e%2e/x",
      "/%252e%252e/x",
      "/a\\b",
      "/x#hash",
      "/types?tenant=tenant%3A8",
    ])
      expect(isSafeFlowsPath(path)).toBe(false);
    expect(isSafeFlowsPath("/tenant:7/workflows?limit=20")).toBe(true);
  });

  it("shows authorization denial before the tenant-loading state", () => {
    expect(
      saviaFlowsGateState({
        isPending: false,
        canAccess: false,
        loading: true,
      }),
    ).toBe("denied");
    expect(
      saviaFlowsGateState({ isPending: true, canAccess: false, loading: true }),
    ).toBe("loading");
    expect(
      saviaFlowsGateState({
        isPending: false,
        canAccess: true,
        loading: false,
      }),
    ).toBe("ready");
  });

  it("aborts in-flight requests when the iframe is disposed", async () => {
    let signal: AbortSignal | undefined;
    const fetcher: typeof fetch = (_input, init) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => undefined);
    };
    const { frame, host, channel } = setup(fetcher);
    message(frame, {
      namespace: "savia-flows",
      channel,
      id: "pending",
      type: "request",
      path: "/types",
    });
    await vi.waitFor(() => expect(signal).toBeDefined());
    host.dispose();
    expect(signal?.aborted).toBe(true);
  });

  it("pushes the latest host theme to the iframe", () => {
    const { frame, host } = setup();
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    host.setTheme({
      mode: "dark",
      colorTheme: "emerald",
      variables: { "--background": "oklch(0 0 0)" },
    });
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "theme",
        theme: expect.objectContaining({ mode: "dark" }),
      }),
      window.location.origin,
      [],
    );
    host.dispose();
  });

  it("forwards object bytes without converting or corrupting binary payloads", async () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    const { frame, host, channel } = setup(
      async () =>
        new Response(bytes, {
          headers: { "content-type": "image/png" },
        }),
    );
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    message(frame, {
      namespace: "savia-flows",
      channel,
      id: "binary",
      type: "request",
      path: "/tenant:7/objects?id=image&mimeType=image%2Fpng",
    });
    await vi.waitFor(() =>
      expect(
        post.mock.calls.some(
          ([data]) => (data as { type?: string }).type === "response",
        ),
      ).toBe(true),
    );
    const response = post.mock.calls
      .map(([data]) => data as { type?: string; body?: ArrayBuffer })
      .find((data) => data.type === "response");
    expect([...new Uint8Array(response!.body!)]).toEqual([...bytes]);
    host.dispose();
  });

  it("uses the host ticket endpoint for editable workflow sockets", async () => {
    let request: Request | undefined;
    const { frame, host, channel } = setup(async (input, init) => {
      request = new Request(input, init);
      return Response.json({
        url: "wss://savia.test/api/public/savia-flows/ws?ticket=short",
      });
    });
    message(frame, {
      namespace: "savia-flows",
      channel,
      id: "socket",
      type: "socket-ticket",
      path: "/tenant:7/ws/workflow_1",
    });
    await vi.waitFor(() => expect(request).toBeDefined());
    expect(request?.url).toBe(
      `${window.location.origin}/v1/savia-flows/ws-ticket?tenant=tenant%3A7`,
    );
    expect(await request?.json()).toEqual({ path: "/tenant:7/ws/workflow_1" });
    host.dispose();
  });

  it("gives a newly selected tenant a fresh iframe and isolated message channel", () => {
    const first = setup();
    const second = setup();
    expect(saviaFlowsFrameKey(7)).not.toBe(saviaFlowsFrameKey(8));
    expect(first.channel).not.toBe(second.channel);
    first.host.dispose();
    second.host.dispose();
  });
});
