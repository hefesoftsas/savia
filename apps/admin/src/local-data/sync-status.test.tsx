import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocalSyncStatus } from "./sync-status";
import type { LocalWorkspace } from "./workspaces";
afterEach(cleanup);
it("surfaces storage failure and prevents retrying a server-deleted record", async () => {
  const mutation = {
    mutationId: "m",
    collection: "people",
    id: "a",
    state: "conflict",
    error: "Version conflict",
  };
  const workspace = {
    store: {
      status: async () => ({
        pending: 0,
        conflicts: 1,
        errors: 0,
        syncError: "Storage is full",
      }),
      subscribe: () => () => {},
      db: {
        outbox: { toArray: async () => [mutation] },
        syncState: {
          toArray: async () => [{ collection: "people", hydrated: true }],
        },
        collections: {
          toArray: async () => [{ name: "people", capability: "read-write" }],
        },
        conflicts: {
          toArray: async () => [
            { mutationId: "m", master: { deleted_at: "2026-09-18" } },
          ],
        },
      },
    },
    requestSync: vi.fn(),
    syncNow: vi.fn(),
  } as unknown as LocalWorkspace;
  render(<LocalSyncStatus workspace={workspace} />);
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Storage is full"),
  );
  expect(
    screen.getByText("Conservar mis cambios").closest("button"),
  ).toBeDisabled();
  expect(
    screen.getByText("Usar versión del servidor").closest("button"),
  ).toBeEnabled();
});

for (const state of ["error", "conflict"] as const) {
  it(`resolves a ${state} as a complete form using fresh server state`, async () => {
    const resolveBundle = vi.fn().mockResolvedValue(undefined);
    const workspace = {
      store: {
        status: async () => ({
          pending: 0,
          conflicts: state === "conflict" ? 1 : 0,
          errors: state === "error" ? 1 : 0,
        }),
        subscribe: () => () => {},
        db: {
          outbox: {
            toArray: async () => [
              {
                mutationId: "bundle",
                action: "bundle",
                state,
                collection: "policies",
                id: "p",
                bundle: { members: [{}, {}, {}] },
              },
            ],
          },
          syncState: { toArray: async () => [] },
          collections: { toArray: async () => [] },
          conflicts: { toArray: async () => [] },
        },
        acceptMaster: vi.fn(),
        retryWithLocal: vi.fn(),
        discardMutation: vi.fn(),
        retryMutation: vi.fn(),
      },
      resolveBundle,
      requestSync: vi.fn(),
      syncNow: vi.fn(),
    } as unknown as LocalWorkspace;
    render(<LocalSyncStatus workspace={workspace} />);
    await screen.findByText(/Formulario completo \(3 registros\)/);
    expect(screen.queryByText("Descartar cambio")).not.toBeInTheDocument();
    expect(screen.queryByText("Reintentar")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Usar versión del servidor"));
    await waitFor(() =>
      expect(resolveBundle).toHaveBeenCalledWith("bundle", "server"),
    );
    await waitFor(() =>
      expect(screen.getByText("Conservar mis cambios")).toBeEnabled(),
    );
    fireEvent.click(screen.getByText("Conservar mis cambios"));
    await waitFor(() =>
      expect(resolveBundle).toHaveBeenCalledWith("bundle", "local"),
    );
    expect(workspace.store.acceptMaster).not.toHaveBeenCalled();
    expect(workspace.store.retryWithLocal).not.toHaveBeenCalled();
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    fireEvent(window, new Event("offline"));
    await waitFor(() =>
      expect(screen.getByText("Conservar mis cambios")).toBeDisabled(),
    );
    expect(screen.getByText("Usar versión del servidor")).toBeDisabled();
    vi.restoreAllMocks();
  });
}

it("hides quarantined bundles from recovery and exported changes", async () => {
  const hidden = {
    mutationId: "secret-bundle",
    action: "bundle",
    state: "conflict",
    collection: "revoked-policies",
    id: "secret-parent",
    quarantined: true,
    bundle: { members: [{ document: { confidential: "secret-child" } }] },
  };
  const visible = {
    mutationId: "visible",
    action: "update",
    state: "error",
    collection: "people",
    id: "public",
  };
  const workspace = {
    store: {
      status: async () => ({ pending: 0, conflicts: 1, errors: 1 }),
      subscribe: () => () => {},
      db: {
        outbox: { toArray: async () => [hidden, visible] },
        syncState: { toArray: async () => [] },
        collections: { toArray: async () => [] },
        conflicts: { toArray: async () => [] },
      },
    },
    resolveBundle: vi.fn(),
    requestSync: vi.fn(),
    syncNow: vi.fn(),
  } as unknown as LocalWorkspace;
  const originalBlob = Blob;
  let exported = "";
  vi.spyOn(globalThis, "Blob").mockImplementation(function (parts, options) {
    exported = String(parts?.[0]);
    return new originalBlob(parts, options);
  });
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:test");
      static revokeObjectURL = vi.fn();
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  try {
    render(<LocalSyncStatus workspace={workspace} />);
    await screen.findByText(/people: public/);
    expect(screen.queryByText(/secret-parent/)).not.toBeInTheDocument();
    expect(
      screen.queryByText("Usar versión del servidor"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Conservar mis cambios")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Descargar cambios pendientes"));
    expect(JSON.parse(exported)).toEqual([visible]);
    expect(exported).not.toContain("secret");
    expect(workspace.resolveBundle).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("keeps pending work visible offline and shows the last successful check", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const workspace = statusWorkspace({
    pending: 3,
    lastSyncedAt: 1789812000000,
  });
  try {
    render(<LocalSyncStatus workspace={workspace} />);
    await screen.findByText("3 cambios pendientes");
    expect(
      screen.getByRole("status", { name: /Sin conexión/ }),
    ).toHaveAttribute("title", expect.stringContaining("Sin conexión"));
    const lastCheck = screen.getByText(/Última comprobación/);
    expect(lastCheck).toHaveClass("sr-only");
    expect(lastCheck.parentElement).toHaveAttribute(
      "title",
      expect.stringContaining("Última comprobación"),
    );
    expect(screen.getByRole("button", { name: "Sincronizar" })).toBeDisabled();
  } finally {
    vi.restoreAllMocks();
  }
});
it("shows background activity and avoids starting a duplicate manual pass", async () => {
  render(<LocalSyncStatus workspace={statusWorkspace({ syncing: true })} />);
  await screen.findByRole("button", { name: "Sincronizando…" });
  expect(screen.getByRole("button", { name: "Sincronizando…" })).toBeDisabled();
});
it("retries a synchronization failure once without scheduling a second pass", async () => {
  const workspace = statusWorkspace({ syncError: "No se pudo conectar" });
  render(<LocalSyncStatus workspace={workspace} />);
  const retry = await screen.findByRole("button", {
    name: "Reintentar sincronización",
  });
  fireEvent.click(retry);
  await waitFor(() => expect(workspace.syncNow).toHaveBeenCalledOnce());
  expect(workspace.requestSync).not.toHaveBeenCalled();
});
it("renders a green icon-only status when local data is available", async () => {
  render(<LocalSyncStatus workspace={statusWorkspace({})} />);
  const status = await screen.findByRole("status", {
    name: "Datos locales disponibles",
  });
  expect(status.className).toContain("border-emerald-500/30");
  expect(status.getAttribute("title")).toBe("Datos locales disponibles");
  const sync = screen.getByRole("button", { name: "Sincronizar" });
  expect(sync.getAttribute("title")).toBe("Sincronizar");
  expect(sync.textContent).toBe("");
});
it("renders a red icon-only status on synchronization failure", async () => {
  render(<LocalSyncStatus workspace={statusWorkspace({ syncError: "x" })} />);
  const status = await screen.findByRole("status", {
    name: /Sincronización interrumpida/,
  });
  expect(status.className).toContain("border-red-500/30");
  expect(
    screen.getByRole("button", { name: "Reintentar sincronización" }),
  ).toBeEnabled();
});
function statusWorkspace(extra: Record<string, unknown>) {
  return {
    store: {
      status: async () => ({ pending: 0, errors: 0, conflicts: 0, ...extra }),
      subscribe: () => () => {},
      db: {
        outbox: { toArray: async () => [] },
        syncState: {
          toArray: async () => [{ collection: "people", hydrated: true }],
        },
        collections: {
          toArray: async () => [{ name: "people", capability: "read-write" }],
        },
        conflicts: { toArray: async () => [] },
      },
    },
    syncNow: vi.fn().mockResolvedValue(undefined),
    requestSync: vi.fn(),
  } as unknown as LocalWorkspace;
}

it("reports local status read failures instead of silently showing success", async () => {
  const workspace = statusWorkspace({});
  workspace.store.status = vi
    .fn()
    .mockRejectedValue(new Error("Storage unavailable"));
  render(<LocalSyncStatus workspace={workspace} />);
  await screen.findByText(/No se pudo leer el estado local/);
  expect(
    screen.queryByText("Datos locales disponibles"),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Reintentar sincronización" }),
  ).toBeEnabled();
});
