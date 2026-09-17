import { describe, expect, it } from "vitest";
import { createPluginApi } from "../src/plugin-api";

type Policy = {
  id: string;
  _version: number;
  name: string;
};

const policyObject = {
  name: "polizas",
  label: "Pólizas",
  description: "Vigencias de seguros.",
  config: {
    version: 2,
    fields: {
      name: { type: "Textbox", label: "Póliza", labels: {} },
    },
    fieldOrder: ["name"],
  },
};

describe("plugin collection API", () => {
  it("lists action runs only through the owning extension", async () => {
    const requests: Array<{ path: string; method?: string }> = [];
    const savia = createPluginApi({
      extensionId: "inventory.sync",
      request: async (path, method) => {
        requests.push({ path, method });
        return { data: [] };
      },
    });

    await expect(savia.actions.list()).resolves.toEqual([]);
    expect(requests).toEqual([
      {
        path: "/extensions/inventory.sync/actions/runs?limit=20",
        method: "GET",
      },
    ]);
  });

  it("normalizes an invalid action-run history limit", async () => {
    const paths: string[] = [];
    const savia = createPluginApi({
      extensionId: "inventory.sync",
      request: async (path) => {
        paths.push(path);
        return { data: [] };
      },
    });

    await savia.actions.list({ limit: Number.NaN });
    await savia.actions.list({ limit: 101 });
    await savia.actions.list({ limit: 0 });

    expect(paths).toEqual([
      "/extensions/inventory.sync/actions/runs?limit=20",
      "/extensions/inventory.sync/actions/runs?limit=100",
      "/extensions/inventory.sync/actions/runs?limit=1",
    ]);
  });

  it("scopes settings, connections and actions to the extension that owns the screen", async () => {
    const requests: Array<{ path: string; method?: string; data?: unknown }> =
      [];
    const savia = createPluginApi({
      extensionId: "inventory.sync",
      request: async (path, method, data) => {
        requests.push({ path, method, data });
        if (path === "/extensions/inventory.sync/settings" && method === "GET")
          return {
            data: { value: { enabled: true }, version: 3, updatedAt: null },
          };
        if (path === "/extensions/inventory.sync/settings" && method === "PUT")
          return {
            data: {
              value: { enabled: false },
              version: 4,
              updatedAt: "2026-09-16T00:00:00.000Z",
            },
          };
        if (
          path === "/extensions/inventory.sync/connections" &&
          method === "GET"
        )
          return { data: [] };
        if (
          path === "/extensions/inventory.sync/connections/warehouse" &&
          ["PUT", "DELETE"].includes(method ?? "")
        )
          return undefined;
        if (
          path === "/extensions/inventory.sync/actions/pull" &&
          method === "POST"
        )
          return {
            data: {
              run: { runId: "run-1", status: "succeeded" },
              output: { records: 3 },
            },
          };
        throw new Error(`Unexpected request: ${method} ${path}`);
      },
    });

    await savia.settings.get();
    await savia.settings.replace({ enabled: false }, 3);
    await savia.connections.list();
    await savia.connections.replace("warehouse", {
      connectorId: "warehouse",
      values: { apiKey: "secret" },
    });
    await savia.connections.remove("warehouse");
    await expect(
      savia.actions.execute("pull", {
        connectionId: "warehouse",
        input: { since: "2026-09-16T00:00:00.000Z" },
      }),
    ).resolves.toEqual({
      run: { runId: "run-1", status: "succeeded" },
      output: { records: 3 },
    });

    expect(requests).toEqual([
      {
        path: "/extensions/inventory.sync/settings",
        method: "GET",
        data: undefined,
      },
      {
        path: "/extensions/inventory.sync/settings",
        method: "PUT",
        data: { value: { enabled: false }, version: 3 },
      },
      {
        path: "/extensions/inventory.sync/connections",
        method: "GET",
        data: undefined,
      },
      {
        path: "/extensions/inventory.sync/connections/warehouse",
        method: "PUT",
        data: {
          connectorId: "warehouse",
          values: { apiKey: "secret" },
        },
      },
      {
        path: "/extensions/inventory.sync/connections/warehouse",
        method: "DELETE",
        data: undefined,
      },
      {
        path: "/extensions/inventory.sync/actions/pull",
        method: "POST",
        data: {
          connectionId: "warehouse",
          input: { since: "2026-09-16T00:00:00.000Z" },
        },
      },
    ]);
  });

  it("discovers the collections and schema exposed to the current tenant", async () => {
    const savia = createPluginApi({
      extensionId: "insurance.portfolio-dashboard",
      request: async (path) => {
        expect(path).toBe("/objects");
        return { data: [policyObject] };
      },
    });

    expect(await savia.collections.list()).toEqual([policyObject]);
    expect(await savia.collections.collection("polizas").describe()).toEqual(
      policyObject,
    );
  });

  it("translates collection CRUD to the host while preserving record versions", async () => {
    const requests: Array<{ path: string; method?: string; data?: unknown }> =
      [];
    const savia = createPluginApi({
      extensionId: "insurance.portfolio-dashboard",
      request: async (path, method, data) => {
        requests.push({ path, method, data });
        if (path.startsWith("/records/polizas?") && method === "GET")
          return {
            data: [{ id: "policy-1", _version: 7, name: "Anual" }],
            total: 1,
            page: 2,
            perPage: 10,
          };
        if (path === "/records/polizas" && method === "POST")
          return { data: { id: "policy-2", _version: 1, ...data } };
        if (path === "/records/polizas/policy-1" && method === "PATCH")
          return { data: { id: "policy-1", ...data, _version: 8 } };
        if (
          path === "/records/polizas/policy-1?version=8" &&
          method === "DELETE"
        )
          return { data: { id: "policy-1" } };
        throw new Error(`Unexpected request: ${method} ${path}`);
      },
    });
    const polizas = savia.collections.collection<Policy>("polizas");

    expect(await polizas.list({ page: 2, perPage: 10 })).toEqual({
      data: [{ id: "policy-1", _version: 7, name: "Anual" }],
      total: 1,
      page: 2,
      perPage: 10,
    });
    expect(await polizas.create({ name: "Nueva" })).toEqual({
      id: "policy-2",
      _version: 1,
      name: "Nueva",
    });
    expect(
      await polizas.update("policy-1", { name: "Renovada" }, { version: 7 }),
    ).toEqual({ id: "policy-1", _version: 8, name: "Renovada" });
    await polizas.remove("policy-1", { version: 8 });

    expect(requests).toEqual([
      {
        path: "/records/polizas?page=2&perPage=10&sort=updated_at&order=DESC",
        method: "GET",
        data: undefined,
      },
      { path: "/records/polizas", method: "POST", data: { name: "Nueva" } },
      {
        path: "/records/polizas/policy-1",
        method: "PATCH",
        data: { name: "Renovada", _version: 7 },
      },
      {
        path: "/records/polizas/policy-1?version=8",
        method: "DELETE",
        data: undefined,
      },
    ]);
  });

  it("scopes extension services to the plugin that owns the screen", async () => {
    const savia = createPluginApi({
      extensionId: "insurance.portfolio-dashboard",
      request: async (path) => {
        expect(path).toBe("/extensions/insurance.portfolio-dashboard/summary");
        return { data: { total: 3 } };
      },
    });

    await expect(savia.services.get("summary")).resolves.toEqual({ total: 3 });
  });
});
