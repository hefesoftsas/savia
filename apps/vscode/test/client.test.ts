import { expect, it, vi } from "vitest";
import { PluginDevelopmentClient, PluginDevelopmentError } from "../src/client";
const profile = {
  id: "profile",
  origin: "https://savia.test",
  tenantId: 12,
  principalId: "author",
};
const capabilities = {
  schemaVersion: 1,
  compilerVersion: 1,
  tenantId: 12,
  principalId: "author",
  workspaceLabel: "Workspace",
  read: true,
  destinations: ["tenant"],
};
it("sends credentials only to the selected profile origin and refuses redirects", async () => {
  let called: URL | undefined;
  const client = new PluginDevelopmentClient(
    profile,
    async () => "secret",
    async (url, init) => {
      called = new URL(String(url));
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer secret",
      );
      return Response.json(capabilities);
    },
  );
  expect(await client.capabilities()).toEqual(capabilities);
  expect(called?.href).toBe(
    "https://savia.test/v1/studio/12/api/plugin-development/capabilities",
  );
});
it("rejects unsafe profiles, unexpected capability identity and redirected replies", async () => {
  for (const origin of [
    "http://external.test",
    "https://user:pass@savia.test",
    "https://savia.test/path",
  ])
    expect(
      () =>
        new PluginDevelopmentClient(
          { ...profile, origin },
          async () => "secret",
          fetch,
        ),
    ).toThrow();
  const other = new PluginDevelopmentClient(
    profile,
    async () => "secret",
    async () => Response.json({ ...capabilities, tenantId: 13 }),
  );
  await expect(other.capabilities()).rejects.toThrow("identity");
  const redirect = new PluginDevelopmentClient(
    profile,
    async () => "secret",
    async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://attacker.test" },
      }),
  );
  await expect(redirect.capabilities()).rejects.toThrow();
});
it("bounds streamed responses and sanitizes credential errors", async () => {
  const oversized = new PluginDevelopmentClient(
    profile,
    async () => "private-key",
    async () => new Response("x".repeat(128 * 1024 + 1)),
  );
  await expect(oversized.capabilities()).rejects.toThrow("limit");
  const denied = new PluginDevelopmentClient(
    profile,
    async () => "private-key",
    async () =>
      Response.json(
        { error: { message: "private-key reflected" } },
        { status: 401 },
      ),
  );
  try {
    await denied.capabilities();
    throw new Error("Expected auth rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(PluginDevelopmentError);
    expect(String(error)).not.toContain("private-key");
    expect((error as PluginDevelopmentError).status).toBe(401);
  }
});
it("cancels late responses and never updates a disposed connection", async () => {
  let reply!: (response: Response) => void;
  const client = new PluginDevelopmentClient(
    profile,
    async () => "secret",
    async () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );
  const pending = client.capabilities();
  await new Promise((resolve) => setTimeout(resolve, 0));
  client.dispose();
  reply(Response.json(capabilities));
  await expect(pending).rejects.toThrow("connection");
});

it("sanitizes malformed credentials before constructing authorization headers", async () => {
  const token = "private-key\nreflected-secret";
  const client = new PluginDevelopmentClient(
    profile,
    async () => token,
    async () => Response.json(capabilities),
  );
  try {
    await client.capabilities();
    throw new Error("Expected auth rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(PluginDevelopmentError);
    expect(String(error)).not.toContain("private-key");
  }
});
it("cancels a response body that stalls after headers", async () => {
  let bodyCancelled = false;
  const controller = new AbortController();
  const client = new PluginDevelopmentClient(
    profile,
    async () => "secret",
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            bodyCancelled = true;
          },
        }),
      ),
  );
  const pending = client.capabilities(controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  const outcome = await Promise.race([
    pending.then(
      () => "resolved",
      () => "cancelled",
    ),
    new Promise((resolve) => setTimeout(() => resolve("stalled"), 100)),
  ]);
  expect(outcome).toBe("cancelled");
  expect(bodyCancelled).toBe(true);
  client.dispose();
});

it("rejects a checkout returned for a different requested coordinate", async () => {
  const response = {
    pluginId: "custom.other",
    sourceVersion: "1.0.0",
    sourceSha256: "a".repeat(64),
    head: { version: "1.0.0", sha256: "b".repeat(64) },
    sharedHead: null,
    authoringKind: "authored",
    entryPath: "entry.tsx",
    files: {
      "entry.tsx": "export function render() {}",
      "savia-extension.json": "{}",
      "store.json": "{}",
      "preview.json": "{}",
    },
  };
  const client = new PluginDevelopmentClient(
    profile,
    async () => "secret",
    async () => Response.json(response),
  );
  await expect(client.checkout("custom.example", "1.0.0")).rejects.toThrow(
    "coordinate",
  );
});
it("preserves a valid partial receipt and refuses another publication's receipt", async () => {
  const bytes = new Uint8Array([80, 75]);
  const { createHash } = await import("node:crypto");
  const input = {
    mode: "create" as const,
    destination: "shared" as const,
    pluginId: "custom.example",
    version: "1.1.0",
    sourceVersion: "1.0.0",
    sourceSha256: "a".repeat(64),
    expectedHead: { version: "1.0.0", sha256: "b".repeat(64) },
  };
  const receipt = {
    state: "shared-pending",
    destination: "shared",
    local: {
      pluginId: input.pluginId,
      version: input.version,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    head: {
      version: "1.1.0",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    sharedHead: null,
    issues: [
      { code: "REGISTRY_UNAVAILABLE", message: "Retry the retained ZIP." },
    ],
  };
  let reply = receipt;
  const client = new PluginDevelopmentClient(
    profile,
    async () => "secret",
    async () => Response.json(reply),
  );
  expect(await client.publish(input, bytes)).toEqual(receipt);
  reply = { ...receipt, local: { ...receipt.local, pluginId: "custom.other" } };
  await expect(client.publish(input, bytes)).rejects.toThrow("coordinate");
});

it("distinguishes request timeout from explicit cancellation for actionable recovery", async () => {
  vi.useFakeTimers();
  const client = new PluginDevelopmentClient(
    profile,
    async () => "secret",
    async (_url, init) =>
      new Promise((_resolve, reject) =>
        init!.signal!.addEventListener("abort", () =>
          reject(new Error("aborted")),
        ),
      ),
  );
  try {
    const pending = client.capabilities().catch((error) => error);
    await vi.advanceTimersByTimeAsync(30000);
    expect(await pending).toMatchObject({ code: "REQUEST_TIMEOUT", status: 0 });
  } finally {
    client.dispose();
    vi.useRealTimers();
  }
});
