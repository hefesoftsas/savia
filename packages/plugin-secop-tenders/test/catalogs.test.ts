import { describe, expect, it } from "vitest";
import type { PluginApi } from "@savia/plugin-sdk";
import { loadSecopCatalog } from "../catalogs";

function apiFor(output: unknown, calls: unknown[] = []) {
  return {
    actions: {
      execute: async (id: string, request: unknown) => {
        calls.push([id, request]);
        return { output };
      },
    },
  } as unknown as PluginApi;
}

describe("SECOP complete catalogs", () => {
  it("uses a fixed catalog action independent of tender search and accepts more than 10000 entities", async () => {
    const calls: unknown[] = [];
    const values = Array.from({ length: 11881 }, (_, i) => `Entity ${i}`);
    const result = await loadSecopCatalog(
      apiFor(
        { data: [{ id: "entidad", complete: true, count: 11881, values }] },
        calls,
      ),
      "entidad",
    );
    expect(result).toHaveLength(11881);
    expect(result).toContain("Entity 11880");
    expect(calls).toEqual([["catalog-entidad", { input: {} }]]);
  });

  it.each([
    {
      data: [
        { id: "departamento", complete: false, count: 1, values: ["Caldas"] },
      ],
    },
    {
      data: [
        { id: "departamento", complete: true, count: 2, values: ["Caldas"] },
      ],
    },
    { data: [{ id: "entidad", complete: true, count: 1, values: ["Caldas"] }] },
    { data: [{ id: "departamento", complete: true, count: 1, values: [42] }] },
    { data: [] },
  ])(
    "rejects incomplete or malformed catalogs instead of claiming that they are complete",
    async (output) => {
      await expect(
        loadSecopCatalog(apiFor(output), "departamento"),
      ).rejects.toThrow();
    },
  );
});
