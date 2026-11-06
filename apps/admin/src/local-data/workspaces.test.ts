import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, expect, it, vi } from "vitest";
import { createWorkspaceManager } from "./workspaces";
import type { AuthSession } from "@/auth/auth-session";
import type { ApiClient } from "@/api/api-client";
afterEach(async () => {
  await Dexie.delete("savia-offline");
  Reflect.deleteProperty(navigator, "locks");
});
it("preserves pending work in the retired outbox when clearing a workspace", async () => {
  const legacy = new Dexie("savia-offline");
  legacy.version(1).stores({ outbox: "++id,status" });
  await legacy
    .table("outbox")
    .add({ status: "pending", payload: { name: "Unsent" } });
  legacy.close();
  const session = {
    getIdentity: vi.fn().mockResolvedValue({ id: "user" }),
  } as unknown as AuthSession;
  await createWorkspaceManager(session, {} as ApiClient, "test").clear();
  expect(await Dexie.exists("savia-offline")).toBe(true);
  const reopened = new Dexie("savia-offline");
  await reopened.open();
  expect(await reopened.table("outbox").count()).toBe(1);
  reopened.close();
});

it("unlocks revoked workspaces only after an authenticated tenant manifest succeeds", async () => {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        _name: string,
        _options: unknown,
        callback: () => Promise<void>,
      ) => callback(),
    },
  });
  const { openLocalStore } = await import("./store");
  const permissions = {
    canReadDocuments: true,
    canExecuteCommands: true,
    canManageIdentity: false,
    memberships: [],
  };
  const session = {
    getIdentity: vi.fn().mockResolvedValue({ id: "user" }),
    getPermissions: vi.fn().mockResolvedValue(permissions),
  } as unknown as AuthSession;
  const environment = "authorization-test";
  const prefix = "/embedded";
  const scope = JSON.stringify([
    JSON.stringify([environment, "user"]),
    prefix,
    permissions,
  ]);
  const seed = await openLocalStore(scope);
  await seed.blockAuthorization("Revoked");
  seed.close();
  let authorized = false;
  let principalId = "other-user";
  const client = {
    requestResponse: vi.fn(async () =>
      authorized
        ? Response.json({ collections: [], principalId })
        : Response.json({ error: "Denied" }, { status: 401 }),
    ),
  } as unknown as ApiClient;
  const manager = createWorkspaceManager(session, client, environment);
  const workspace = await manager.open(prefix);
  await expect(workspace.syncNow()).rejects.toThrow();
  expect(await workspace.store.authorizationError()).toBe("Revoked");
  authorized = true;
  await expect(workspace.syncNow()).rejects.toThrow("La sesión cambió.");
  expect(await workspace.store.authorizationError()).toBe("Revoked");
  principalId = "user";
  await workspace.syncNow();
  expect(await workspace.store.authorizationError()).toBeUndefined();
  workspace.close();
  await manager.clear();
});
