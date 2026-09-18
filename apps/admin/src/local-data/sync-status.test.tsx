import { render, screen, cleanup, waitFor } from "@testing-library/react";
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
