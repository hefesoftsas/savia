import { afterEach, expect, it, vi } from "vitest";
import { saveRelatedRecords } from "../save-related-records";
import { api } from "../api";
const { workspace, runtime } = vi.hoisted(() => {
  const workspace = {
    store: { enqueueBundle: vi.fn() },
    syncNow: vi.fn(),
    requestSync: vi.fn(),
  };
  return {
    workspace,
    runtime: { localWorkspace: workspace as typeof workspace | undefined },
  };
});
vi.mock("../api", () => ({ api: vi.fn() }));
vi.mock("../runtime", () => ({ getStudioRuntime: () => runtime }));
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  runtime.localWorkspace = workspace;
});
it("commits the form offline without HTTP writes or waiting for synchronization", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  const definitions = [{ id: "relation" }];
  vi.mocked(api).mockResolvedValue({ data: definitions });
  workspace.store.enqueueBundle.mockResolvedValue({
    id: "p",
    _version: 2,
    _localPending: true,
  });
  workspace.syncNow.mockImplementation(() => new Promise(() => {}));
  const result = await saveRelatedRecords(
    "parents",
    { name: "Changed" },
    { id: "p", _version: 1 },
    [],
    "stable-key",
  );
  expect(result).toMatchObject({ id: "p", _localPending: true });
  expect(api).toHaveBeenCalledExactlyOnceWith("/collection-relations");
  expect(workspace.store.enqueueBundle).toHaveBeenCalledWith(
    "parents",
    {
      record: { data: { name: "Changed" }, id: "p", version: 1 },
      relations: [],
    },
    definitions,
    "stable-key",
  );
  expect(workspace.syncNow).not.toHaveBeenCalled();
  expect(workspace.requestSync).toHaveBeenCalledOnce();
});
it("waits for the local transaction and propagates overlap failures", async () => {
  vi.mocked(api).mockResolvedValue({ data: [] });
  let reject!: (error: Error) => void;
  workspace.store.enqueueBundle.mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const save = saveRelatedRecords("parents", {}, undefined, [], "key");
  await vi.waitFor(() =>
    expect(workspace.store.enqueueBundle).toHaveBeenCalledOnce(),
  );
  expect(workspace.requestSync).not.toHaveBeenCalled();
  reject(new Error("Resolve this record's pending form first"));
  await expect(save).rejects.toThrow("pending form");
  expect(workspace.requestSync).not.toHaveBeenCalled();
});
it("retains the online atomic endpoint outside local workspaces", async () => {
  runtime.localWorkspace = undefined;
  vi.mocked(api).mockResolvedValue({ data: { id: "p" } });
  await expect(
    saveRelatedRecords("parents", {}, undefined, [], "key"),
  ).resolves.toMatchObject({ id: "p" });
  expect(api).toHaveBeenCalledWith(
    "/record-bundles/parents",
    "POST",
    { record: { data: {} }, relations: [] },
    { headers: { "Idempotency-Key": "key" } },
  );
});
it("preserves the offline restriction outside local workspaces", async () => {
  runtime.localWorkspace = undefined;
  vi.stubGlobal("navigator", { onLine: false });
  await expect(
    saveRelatedRecords("parents", {}, undefined, [], "key"),
  ).rejects.toThrow("necesita conexión");
  expect(api).not.toHaveBeenCalled();
});
