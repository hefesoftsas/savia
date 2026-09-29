import { afterEach, expect, it, vi } from "vitest";
import { dataProvider } from "../api";
import { setStudioRuntime } from "../runtime";
afterEach(() => setStudioRuntime({ embedded: false }));
const params = (page: number, q = "") => ({
  pagination: { page, perPage: 25 },
  sort: { field: "updated_at", order: "DESC" },
  filter: { q },
});
it("uses the server cursor for a subsequent page and isolates filters", async () => {
  const transport = vi.fn(async () =>
    Response.json({ data: [], total: 100, nextCursor: "next-position" }),
  );
  setStudioRuntime({ embedded: true, tenantId: 5, transport });
  await dataProvider.getList("items", params(1));
  await dataProvider.getList("items", params(2));
  expect(
    new URL(
      transport.mock.calls.at(-1)![0] as string,
      "http://localhost",
    ).searchParams.get("cursor"),
  ).toBe("next-position");
  await dataProvider.getList("items", params(2, "different"));
  expect(
    new URL(
      transport.mock.calls.at(-1)![0] as string,
      "http://localhost",
    ).searchParams.has("cursor"),
  ).toBe(false);
});
it("falls back to a numbered page if the server rejects an obsolete cursor", async () => {
  const transport = vi.fn(async (path: string) =>
    path.includes("cursor=")
      ? Response.json({ error: "expired" }, { status: 422 })
      : Response.json({ data: [], total: 100, nextCursor: "old-position" }),
  );
  setStudioRuntime({ embedded: true, tenantId: 6, transport });
  await dataProvider.getList("items", params(1));
  await expect(dataProvider.getList("items", params(2))).resolves.toMatchObject(
    { total: 100 },
  );
  expect(transport).toHaveBeenCalledTimes(3);
});

it.each(["savia:session-cleared", "savia:identity-changed"])(
  "clears navigation hints on %s",
  async (event) => {
    const transport = vi.fn(async (_path: string) =>
      Response.json({ data: [], total: 100, nextCursor: "old-session" }),
    );
    setStudioRuntime({ embedded: true, tenantId: 8, transport });
    await dataProvider.getList("items", params(1));
    window.dispatchEvent(new Event(event));
    await dataProvider.getList("items", params(2));
    expect(
      new URL(
        transport.mock.calls.at(-1)![0],
        "http://localhost",
      ).searchParams.has("cursor"),
    ).toBe(false);
  },
);
