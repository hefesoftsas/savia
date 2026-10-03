import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "@/api/api-client";
import { PagesClient, type PageDocument } from "./client";

const page: PageDocument = {
  id: "notes",
  rootId: "notes",
  parentId: null,
  ownerId: "owner",
  title: "Notes",
  kind: "page",
  version: 1,
  updatedAt: "2026-10-01T10:00:00Z",
  isShared: false,
  role: "owner",
  content: [],
};
function setup() {
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (init?.method === "PUT")
        return Response.json({
          data: { ...page, ...JSON.parse(String(init.body)), version: 2 },
        });
      return Response.json({
        data: url.pathname === "/v1/pages" ? [page] : page,
      });
    },
  );
  const api = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => null },
    fetcher,
  });
  return { api, fetcher, client: new PagesClient(api) };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("shares concurrent and repeated reads between sidebar and workspace clients", async () => {
  const { api, fetcher, client } = setup();
  await Promise.all([client.list(), new PagesClient(api).list()]);
  await new PagesClient(api).list();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("opens a previously read document offline without a network request", async () => {
  const { client, fetcher } = setup();
  await client.get("notes");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  fetcher.mockRejectedValue(new TypeError("offline"));
  expect(await client.get("notes")).toEqual(page);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("reuses saved content on the next visit and updates the cached index", async () => {
  const { client, fetcher } = setup();
  await client.list();
  await client.get("notes");
  await client.save("notes", { title: "Renamed", content: [], version: 1 });
  expect((await client.get("notes")).title).toBe("Renamed");
  expect((await client.list())[0].title).toBe("Renamed");
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("bounds a stalled document read, including a stalled token lookup", async () => {
  vi.useFakeTimers();
  const api = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: () => new Promise(() => {}) },
  });
  const result = new PagesClient(api).get("notes");
  const assertion = expect(result).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(15_000);
  await assertion;
});
it.each(["savia:session-cleared", "savia:identity-changed"])(
  "discards retained documents on %s",
  async (event) => {
    const { client, fetcher } = setup();
    await client.get("notes");
    window.dispatchEvent(new Event(event));
    fetcher.mockResolvedValue(
      Response.json({ data: { ...page, title: "Other session" } }),
    );
    expect((await client.get("notes")).title).toBe("Other session");
    expect(fetcher).toHaveBeenCalledTimes(2);
  },
);

it("does not let a delayed document read overwrite a successful save", async () => {
  const { client, fetcher } = setup();
  let release!: (response: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = client.get("notes");
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await client.save("notes", { title: "New title", content: [], version: 1 });
  release(Response.json({ data: page }));
  expect((await pending).title).toBe("New title");
  expect((await client.get("notes")).version).toBe(2);
});
it("does not retain a response from a cleared session", async () => {
  const { client, fetcher } = setup();
  let release!: (response: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = client.get("notes");
  const assertion = expect(pending).rejects.toThrow("session changed");
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  window.dispatchEvent(new Event("savia:session-cleared"));
  release(Response.json({ data: page }));
  await assertion;
  expect(client.cachedDocument("notes")).toBeUndefined();
});
it("does not share private document snapshots between API clients", async () => {
  const first = setup();
  const second = setup();
  await first.client.get("notes");
  second.fetcher.mockResolvedValue(
    Response.json({ data: { ...page, title: "Another user" } }),
  );
  expect((await second.client.get("notes")).title).toBe("Another user");
});
it("isolates cached content from mutations by the editor", async () => {
  const { client } = setup();
  const document = await client.get("notes");
  document.content.push({ type: "p", children: [{ text: "Unsaved edit" }] });
  expect((await client.get("notes")).content).toEqual([]);
});
it("expires online snapshots and honors an explicit reload", async () => {
  vi.useFakeTimers();
  const { client, fetcher } = setup();
  await client.get("notes");
  await client.get("notes", true);
  expect(fetcher).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(60_000);
  await client.get("notes");
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("evicts denied documents instead of falling back to a cached copy", async () => {
  const { client, fetcher } = setup();
  await client.get("notes");
  fetcher.mockResolvedValue(
    Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
  );
  await expect(client.get("notes", true)).rejects.toThrow();
  expect(client.cachedDocument("notes")).toBeUndefined();
});
it("removes a deleted document from retained reads and the index", async () => {
  const { client } = setup();
  await client.list();
  await client.get("notes");
  await client.remove("notes", 1);
  expect(client.cachedDocument("notes")).toBeUndefined();
  expect(await client.list()).toEqual([]);
});

it("does not populate the next session with a late save response", async () => {
  const { client, fetcher } = setup();
  let release!: (response: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = client.save("notes", {
    title: "Private",
    content: [],
    version: 1,
  });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  window.dispatchEvent(new Event("savia:session-cleared"));
  release(Response.json({ data: { ...page, title: "Private" } }));
  await pending.catch(() => undefined);
  expect(client.cachedDocument("notes")).toBeUndefined();
});
