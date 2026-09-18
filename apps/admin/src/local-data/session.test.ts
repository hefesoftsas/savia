import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalSession, clearSessionCache } from "./session";
import type { AuthSession } from "@/auth/auth-session";
const permissions = {
  canReadDocuments: true,
  canExecuteCommands: true,
  canManageIdentity: false,
  memberships: [{ agencyId: 1, role: "operator" }],
};
function remote() {
  return {
    getIdentity: vi.fn().mockResolvedValue({ id: "a", fullName: "A" }),
    getPermissions: vi.fn().mockResolvedValue(permissions),
    checkSession: vi.fn().mockResolvedValue(undefined),
    clearSession: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    getAuthorizeUrl: () => "/login",
    getAccessToken: vi.fn(),
    handleCallback: vi.fn(),
  } as unknown as AuthSession;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await clearSessionCache("test");
});
describe("offline workspace session lease", () => {
  it("restores provisioned identity offline without persisting tokens", async () => {
    const session = createLocalSession(remote(), "test");
    await session.checkSession();
    const next = remote();
    vi.mocked(next.checkSession).mockRejectedValue(
      new TypeError("Failed to fetch"),
    );
    vi.mocked(next.getIdentity).mockRejectedValue(
      new TypeError("Failed to fetch"),
    );
    vi.mocked(next.getPermissions).mockRejectedValue(
      new TypeError("Failed to fetch"),
    );
    const restored = createLocalSession(next, "test");
    await expect(restored.checkSession()).resolves.toBeUndefined();
    expect((await restored.getIdentity()).id).toBe("a");
    expect(await restored.getPermissions()).toEqual(permissions);
  });
  it("does not turn a rejected server session into offline access", async () => {
    await createLocalSession(remote(), "test").checkSession();
    const next = remote();
    vi.mocked(next.checkSession).mockRejectedValue({ status: 401 });
    await expect(
      createLocalSession(next, "test").checkSession(),
    ).rejects.toEqual({ status: 401 });
    vi.mocked(next.checkSession).mockRejectedValue(
      new TypeError("Failed to fetch"),
    );
    await expect(
      createLocalSession(next, "test").checkSession(),
    ).rejects.toBeDefined();
  });
  it("explicit logout invalidates offline access", async () => {
    const session = createLocalSession(remote(), "test");
    await session.checkSession();
    await session.clearSession();
    const next = remote();
    vi.mocked(next.checkSession).mockRejectedValue(
      new TypeError("Failed to fetch"),
    );
    await expect(
      createLocalSession(next, "test").checkSession(),
    ).rejects.toBeDefined();
  });
});

it("keeps authenticated online sessions working when IndexedDB writes fail", async () => {
  const api = remote();
  const failure = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementation(() => {
      throw new DOMException("Disk full", "QuotaExceededError");
    });
  const session = createLocalSession(api, "test");
  await expect(session.checkSession()).resolves.toBeUndefined();
  await expect(session.handleCallback()).resolves.toBeUndefined();
  expect(api.clearSession).not.toHaveBeenCalled();
  failure.mockRestore();
});
it("still clears the remote session when IndexedDB deletion fails", async () => {
  const api = remote();
  const session = createLocalSession(api, "test");
  await session.checkSession();
  const failure = vi
    .spyOn(IDBObjectStore.prototype, "delete")
    .mockImplementation(() => {
      throw new DOMException("Unavailable", "UnknownError");
    });
  await expect(session.clearSession()).resolves.toBeUndefined();
  expect(api.clearSession).toHaveBeenCalled();
  failure.mockRestore();
});

it("does not renew or bypass an expired lease when remote checkSession silently uses cached credentials", async () => {
  const api = remote();
  const proof = vi.fn().mockResolvedValue(undefined);
  const session = createLocalSession(api, "test", proof);
  await session.checkSession();
  proof.mockRejectedValue(new TypeError("Failed to fetch"));
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60 * 60 * 1000);
  await expect(session.checkSession()).resolves.toBeUndefined();
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2 * 60 * 60 * 1000);
  await expect(session.checkSession()).rejects.toThrow(
    "Conecta para verificar",
  );
  await expect(session.getIdentity()).rejects.toThrow("Conecta para verificar");
  await expect(session.getPermissions()).rejects.toThrow(
    "Conecta para verificar",
  );
});

it("observes another tab clearing the persisted lease instead of trusting its in-memory copy", async () => {
  const api = remote();
  const session = createLocalSession(api, "test");
  await session.checkSession();
  await clearSessionCache("test");
  vi.mocked(api.checkSession).mockRejectedValue(
    new TypeError("Failed to fetch"),
  );
  await expect(session.checkSession()).rejects.toThrow(
    "Conecta para verificar",
  );
});
