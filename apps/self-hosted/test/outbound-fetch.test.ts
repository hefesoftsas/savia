import { afterEach, expect, it, vi } from "vitest";
import { createNativeCollectionFetch } from "../src/outbound-fetch";
import { executeJsonApi } from "../../api/src/crm/jsonapi-adapter";
const close: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of close.splice(0)) await fn();
});
function adapter(options: Parameters<typeof createNativeCollectionFetch>[0]) {
  const result = createNativeCollectionFetch(options);
  close.push(result.close);
  return result;
}
const dns = (type = "A") =>
  `https://cloudflare-dns.com/dns-query?name=provider.example.com&type=${type}`;
it("answers exact DNS validation locally for both record families", async () => {
  const lookup = vi.fn(async () => [
    { address: "1.1.1.1", family: 4 },
    { address: "2606:4700:4700::1111", family: 6 },
  ]);
  const transport = vi.fn();
  const client = adapter({ lookup, transport });
  expect(await (await client.fetch(dns())).json()).toEqual({
    Status: 0,
    Answer: [{ type: 1, data: "1.1.1.1" }],
  });
  expect(await (await client.fetch(dns("AAAA"))).json()).toEqual({
    Status: 0,
    Answer: [{ type: 28, data: "2606:4700:4700::1111" }],
  });
  expect(lookup).toHaveBeenCalledWith("provider.example.com");
  expect(transport).not.toHaveBeenCalled();
});
it("reports DNS lookup failures and rejects malformed validation requests", async () => {
  const client = adapter({
    lookup: async () => {
      throw new Error("ENOTFOUND");
    },
  });
  expect(await (await client.fetch(dns())).json()).toMatchObject({ Status: 3 });
  expect((await client.fetch(dns("TXT"))).status).toBe(400);
  expect(
    (
      await client.fetch(
        "https://cloudflare-dns.com/dns-query?name=%5Binvalid&type=A",
      )
    ).status,
  ).toBe(400);
  expect((await client.fetch(dns() + "&name=another.example.com")).status).toBe(
    400,
  );
});
it("does not intercept lookalike domains or other DNS endpoint paths", async () => {
  const transport = vi.fn(async () => new Response("normal"));
  const client = adapter({ lookup: async () => [], transport });
  expect(
    await (
      await client.fetch(
        "https://cloudflare-dns.com.evil.com/dns-query?name=x&type=A",
      )
    ).text(),
  ).toBe("normal");
  expect(
    await (await client.fetch("https://cloudflare-dns.com/other")).text(),
  ).toBe("normal");
  expect(transport).toHaveBeenCalledTimes(2);
});
it("rejects non-public preflight addresses through the unchanged JSONAPI adapter", async () => {
  const transport = vi.fn();
  const client = adapter({
    lookup: async () => [{ address: "10.0.0.1", family: 4 }],
    transport,
  });
  await expect(
    executeJsonApi(
      {
        source: { baseUrl: "https://provider.example.com" },
        resource: "people",
        operation: "list",
      },
      client.fetch,
    ),
  ).rejects.toMatchObject({ code: "JSONAPI_INVALID_URL" });
  expect(transport).not.toHaveBeenCalled();
});
it("blocks DNS rebinding using the actual undici connection lookup", async () => {
  let count = 0;
  const lookup = vi.fn(async () => [
    { address: ++count <= 2 ? "1.1.1.1" : "127.0.0.1", family: 4 },
  ]);
  const client = adapter({ lookup });
  await client.fetch(dns());
  await client.fetch(dns("AAAA"));
  await expect(
    client.fetch("https://provider.example.com/data"),
  ).rejects.toMatchObject({
    cause: { message: expect.stringMatching(/public/i) },
  });
  expect(lookup).toHaveBeenCalledTimes(3);
});
it("rejects every mixed/private address set, even if the first answer is public", async () => {
  const client = adapter({
    lookup: async () => [
      { address: "1.1.1.1", family: 4 },
      { address: "::1", family: 6 },
    ],
  });
  await expect(
    client.fetch("https://provider.example.com/data"),
  ).rejects.toMatchObject({
    cause: { message: expect.stringMatching(/public/i) },
  });
});
it("rejects cleartext, custom ports, credentials, and IP literals before transport", async () => {
  const transport = vi.fn();
  const client = adapter({ transport });
  for (const url of [
    "http://provider.example.com",
    "https://provider.example.com:8443",
    "https://u:p@provider.example.com",
    "https://127.0.0.1",
    "https://[::1]",
  ])
    await expect(client.fetch(url)).rejects.toThrow(/HTTPS|public/i);
  expect(transport).not.toHaveBeenCalled();
});
it("keeps redirects manual and streams requests and responses without buffering", async () => {
  let sent: RequestInit | undefined;
  const transport = vi.fn(async (_url: unknown, init: RequestInit) => {
    sent = init;
    return new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("first"));
        },
        pull(c) {
          c.enqueue(new TextEncoder().encode("second"));
          c.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "text/plain" } },
    );
  });
  const client = adapter({ transport });
  const controller = new AbortController();
  const response = await client.fetch("https://provider.example.com/data", {
    method: "POST",
    body: "payload",
    signal: controller.signal,
    redirect: "follow",
  });
  expect(sent?.redirect).toBe("manual");
  expect(sent?.signal).toBeDefined();
  expect(sent?.body).toBeDefined();
  expect(response.headers.get("content-type")).toBe("text/plain");
  expect(await response.text()).toBe("firstsecond");
});
it("honors abort while resolving validation DNS and closes outstanding bodies", async () => {
  const client = adapter({ lookup: () => new Promise(() => {}) });
  const controller = new AbortController();
  const pending = client.fetch(dns(), { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await client.close();
  await expect(client.fetch(dns())).rejects.toThrow(/closed/i);
});
