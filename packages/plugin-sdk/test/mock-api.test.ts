import { describe, expect, it } from "vitest";
import { createMockPluginApi } from "../src/testing";

const apiWithOneTask = (
  overrides: Parameters<typeof createMockPluginApi>[0] = {},
) =>
  createMockPluginApi({
    collections: [
      {
        definition: {
          name: "tasks",
          label: "Tasks",
          description: "Work items",
          config: { version: 1, fields: {} } as never,
        },
        records: [{ id: "one", title: "First", _version: 2 }],
      },
    ],
    ...overrides,
  });

describe("createMockPluginApi", () => {
  it("supports collection reads and versioned writes", async () => {
    const api = apiWithOneTask();
    const tasks = api.collections.collection<{
      id: string;
      title: string;
      _version: number;
    }>("tasks");

    expect(
      (await tasks.list({ q: "fir", searchFields: ["title"] })).total,
    ).toBe(1);
    const updated = await tasks.update(
      "one",
      { title: "Second", id: "changed", _version: 999 },
      { version: 2 },
    );
    expect(updated).toMatchObject({ title: "Second", id: "one", _version: 3 });
    await expect(
      tasks.update("one", { title: "Stale" }, { version: 2 }),
    ).rejects.toMatchObject({ code: "version_conflict", status: 409 });
  });

  it("protects system fields and avoids generated IDs that are already seeded", async () => {
    const api = createMockPluginApi({
      collections: [
        {
          definition: {
            name: "tasks",
            label: "Tasks",
            description: "",
            config: { version: 1, fields: {} } as never,
          },
          records: [{ id: "mock-1", title: "Seed", _version: 5 }],
        },
      ],
    });
    const tasks = api.collections.collection<{
      id: string;
      title: string;
      _version: number;
    }>("tasks");
    const created = await tasks.create({
      id: "caller-id",
      title: "New",
      _version: 99,
    });
    expect(created).toMatchObject({ id: "mock-2", title: "New", _version: 1 });
    const updated = await tasks.update(
      "mock-1",
      { id: "forged", title: "Changed", _version: 99 },
      { version: 5 },
    );
    expect(updated).toMatchObject({
      id: "mock-1",
      title: "Changed",
      _version: 6,
    });
  });

  it("simulates permission and offline failures", async () => {
    const forbidden = apiWithOneTask({ deny: ["tasks:read"] });
    await expect(
      forbidden.collections.collection("tasks").get("one"),
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });

    const offline = apiWithOneTask({ offline: true });
    await expect(offline.collections.list()).rejects.toMatchObject({
      code: "network_error",
    });
  });

  it("throws a clear error for unsupported API methods", async () => {
    await expect(apiWithOneTask().settings.get()).rejects.toThrow(
      "does not support settings.get",
    );
  });
});
