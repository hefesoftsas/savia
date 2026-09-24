import { expect, it, vi } from "vitest";
import type { PluginApi } from "@savia/studio-shared/plugin-api";
import { previewRenewals, executeRenewals } from "../src/backfill";
const policy = {
  id: "p1",
  _version: 1,
  name: "P1",
  cliente: "c1",
  fin: "2027-09-01",
  prima: 100,
  estado: "Vigente",
};
function api(existing: Record<string, unknown>[] = [], current = policy) {
  const create = vi.fn().mockResolvedValue({ id: "r1" });
  const data: Record<string, Record<string, unknown>[]> = {
    polizas: [policy],
    clientes: [{ id: "c1", name: "Client" }],
    insurance_renewals: existing,
  };
  const savia = {
    collections: {
      collection: (name: string) => ({
        describe: async () => ({
          config: { fields: { term_key: { config: { unique: true } } } },
        }),
        list: async () => ({
          data: data[name],
          total: data[name].length,
          page: 1,
          perPage: 100,
        }),
        get: async () => current,
        create,
      }),
    },
  } as unknown as PluginApi;
  return { savia, create };
}
it("skips prior terms only when their term matches, including legacy manual cases", async () => {
  const same = api([
    {
      id: "r1",
      source_policy_id: "p1",
      expiry_date: "2027-09-01",
      notes: "Manual",
    },
  ]);
  expect((await previewRenewals(same.savia, 30)).candidates).toHaveLength(0);
  const older = api([
    { id: "r1", source_policy_id: "p1", expiry_date: "2026-09-01" },
  ]);
  expect((await previewRenewals(older.savia, 30)).candidates).toHaveLength(1);
  expect(older.create).not.toHaveBeenCalled();
});
it("refuses a source changed after preview before creating anything", async () => {
  const { savia, create } = api([], { ...policy, _version: 2 });
  const preview = await previewRenewals(savia, 30);
  await expect(executeRenewals(savia, preview.candidates)).rejects.toThrow(
    "cambió",
  );
  expect(create).not.toHaveBeenCalled();
});
it("creates only reviewed candidates using the server scoped collection", async () => {
  const { savia, create } = api();
  const preview = await previewRenewals(savia, 30);
  expect(await executeRenewals(savia, preview.candidates)).toBe(1);
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      term_key: "p1:2027-09-01",
      next_follow_up: "2027-08-02",
    }),
  );
});
