import { afterEach, expect, it, vi } from "vitest";
import { saveRelatedRecords } from "../save-related-records";
import { api } from "../api";
const { workspace } = vi.hoisted(() => ({
  workspace: {
    store: { db: { outbox: { count: vi.fn() } } },
    syncNow: vi.fn(),
    requestSync: vi.fn(),
  },
}));
vi.mock("../api", () => ({ api: vi.fn() }));
vi.mock("../runtime", () => ({
  getCrmRuntime: () => ({ localWorkspace: workspace }),
}));
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("pulls hydrated parent and child collections after a committed bundle", async () => {
  workspace.store.db.outbox.count.mockResolvedValue(0);
  workspace.syncNow.mockResolvedValue(undefined);
  vi.mocked(api).mockResolvedValue({ data: { id: "p", _version: 2 } });
  const result = await saveRelatedRecords(
    "parents",
    { name: "Changed" },
    { id: "p", _version: 1 },
    [],
    "stable-key",
  );
  expect(result._version).toBe(2);
  expect(api).toHaveBeenCalledWith(
    "/record-bundles/parents",
    "POST",
    {
      record: { data: { name: "Changed" }, id: "p", version: 1 },
      relations: [],
    },
    { headers: { "Idempotency-Key": "stable-key" } },
  );
  expect(workspace.syncNow).toHaveBeenCalledWith();
});
it("keeps a committed save successful if its subsequent pull fails", async () => {
  workspace.store.db.outbox.count.mockResolvedValue(0);
  workspace.syncNow.mockRejectedValue(new Error("offline"));
  vi.mocked(api).mockResolvedValue({ data: { id: "p", _version: 1 } });
  await expect(
    saveRelatedRecords("parents", {}, undefined, [], "key"),
  ).resolves.toMatchObject({ id: "p" });
  expect(workspace.requestSync).toHaveBeenCalledOnce();
});
it("blocks the atomic write when preceding local mutations cannot synchronize", async () => {
  workspace.store.db.outbox.count.mockResolvedValue(1);
  workspace.syncNow.mockResolvedValue(undefined);
  await expect(
    saveRelatedRecords("parents", {}, undefined, [], "key"),
  ).rejects.toThrow("cambios pendientes");
  expect(api).not.toHaveBeenCalled();
});
it("does not send an offline form", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  await expect(
    saveRelatedRecords("parents", {}, undefined, [], "key"),
  ).rejects.toThrow("borrador local");
  expect(api).not.toHaveBeenCalled();
});
