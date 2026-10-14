import { expect, it } from "vitest";
import { ConnectionManager } from "../src/connection";
const capabilities = {
  schemaVersion: 1,
  compilerVersion: 1,
  tenantId: 12,
  principalId: "author",
  workspaceLabel: "Workspace",
  read: true,
  destinations: ["tenant"],
};
function secrets() {
  const values = new Map<string, string>();
  return {
    values,
    async get(k: string) {
      return values.get(k);
    },
    async store(k: string, v: string) {
      values.set(k, v);
    },
    async delete(k: string) {
      values.delete(k);
    },
  };
}
it("isolates credentials by exact origin, tenant and verified principal and deletes on disconnect", async () => {
  const storage = secrets();
  const manager = new ConnectionManager(storage, async () =>
    Response.json(capabilities),
  );
  const connection = await manager.connect(
    "https://savia.test",
    12,
    "first-secret",
  );
  expect(JSON.stringify(connection.profile)).not.toContain("first-secret");
  expect(storage.values.size).toBe(1);
  const second = await manager.connect(
    "https://other.test",
    12,
    "second-secret",
  );
  expect(second.profile.id).not.toBe(connection.profile.id);
  expect(storage.values.size).toBe(2);
  await manager.disconnect();
  expect(manager.current).toBeUndefined();
  expect([...storage.values.values()]).toEqual(["first-secret"]);
});
it("keeps the new connection when an older connection request completes later", async () => {
  const storage = secrets();
  let finish!: (response: Response) => void;
  const manager = new ConnectionManager(storage, async (url) =>
    new URL(String(url)).hostname === "old.test"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Response.json(capabilities),
  );
  const old = manager.connect("https://old.test", 12, "old-secret");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const latest = await manager.connect("https://new.test", 12, "new-secret");
  finish(Response.json(capabilities));
  await expect(old).rejects.toThrow("connection");
  expect(manager.current?.profile).toEqual(latest.profile);
  expect([...storage.values.values()]).toEqual(["new-secret"]);
});
it("does not store a token when the capability identity does not match the selected workspace", async () => {
  const storage = secrets();
  const manager = new ConnectionManager(storage, async () =>
    Response.json({ ...capabilities, tenantId: 13 }),
  );
  await expect(
    manager.connect("https://savia.test", 12, "secret"),
  ).rejects.toThrow("identity");
  expect(storage.values.size).toBe(0);
});

it("verifies a saved principal before storing any replacement credential", async () => {
  const storage = secrets();
  let stores = 0;
  const savedStore = storage.store.bind(storage);
  storage.store = async (key, value) => {
    stores++;
    await savedStore(key, value);
  };
  let principal = "author";
  const manager = new ConnectionManager(storage, async () =>
    Response.json({ ...capabilities, principalId: principal }),
  );
  const original = await manager.connect("https://savia.test", 12, "secret");
  manager.dispose();
  principal = "other";
  await expect(manager.reconnect(original.profile)).rejects.toThrow("identity");
  expect(stores).toBe(1);
  expect([...storage.values.values()]).toEqual(["secret"]);
});
