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
