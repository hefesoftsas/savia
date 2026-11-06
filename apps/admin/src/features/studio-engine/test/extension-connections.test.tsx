// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { render } from "./locale-test-render";
import userEvent from "@testing-library/user-event";
import { ExtensionConnections } from "../extension-connections";

const realtime = vi.hoisted(() => ({ refreshes: [] as Array<() => unknown> }));

vi.mock("@/realtime/use-realtime-refresh", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/realtime/use-realtime-refresh")>();
  return {
    ...actual,
    useRealtimeRefresh: ({ refresh }: { refresh: () => unknown }) => {
      realtime.refreshes.push(refresh);
      return { changed: false, reload: vi.fn() };
    },
  };
});

afterEach(() => {
  cleanup();
  realtime.refreshes = [];
});

it("saves a generic extension connection without rendering its secret later", async () => {
  const user = userEvent.setup();
  const client = {
    listConnections: vi.fn().mockResolvedValue([]),
    replaceConnection: vi.fn().mockResolvedValue(undefined),
    removeConnection: vi.fn().mockResolvedValue(undefined),
  };

  render(
    <ExtensionConnections
      extensionId="inventory.sync"
      client={client}
      connectors={[
        {
          connectorId: "warehouse",
          label: "Bodega principal",
          fields: [
            { name: "endpoint", label: "Endpoint" },
            { name: "apiKey", label: "API key", secret: true },
          ],
        },
      ]}
    />,
  );

  await user.type(await screen.findByLabelText("Identificador"), "warehouse");
  await user.type(screen.getByLabelText("Endpoint"), "https://warehouse.test");
  await user.type(screen.getByLabelText("API key"), "secret-value");
  await user.click(screen.getByRole("button", { name: "Guardar conexión" }));

  expect(client.replaceConnection).toHaveBeenCalledWith(
    "inventory.sync",
    "warehouse",
    {
      connectorId: "warehouse",
      values: { endpoint: "https://warehouse.test", apiKey: "secret-value" },
    },
  );
});

it("ignores a stale initial-load error after a newer refresh succeeds", async () => {
  let rejectInitial!: (reason: Error) => void;
  let requestCount = 0;
  const client = {
    listConnections: vi.fn(() => {
      requestCount += 1;
      if (requestCount === 1)
        return new Promise<never>((_resolve, reject) => {
          rejectInitial = reject;
        });
      return Promise.resolve([
        {
          connectionId: "current",
          connectorId: "warehouse",
          configured: true as const,
          updatedAt: "2026-10-09T00:00:00.000Z",
        },
      ]);
    }),
    replaceConnection: vi.fn().mockResolvedValue(undefined),
    removeConnection: vi.fn().mockResolvedValue(undefined),
  };

  render(
    <ExtensionConnections
      extensionId="inventory.sync"
      client={client}
      connectors={[{ connectorId: "warehouse", label: "Bodega", fields: [] }]}
    />,
  );
  await waitFor(() => expect(rejectInitial).toBeTypeOf("function"));

  await act(async () => {
    await realtime.refreshes.at(-1)?.();
  });

  await act(async () => {
    rejectInitial(new Error("Obsolete initial failure"));
  });

  expect(await screen.findByText("current")).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("removes protected connection details after a denied background read", async () => {
  const denied = Object.assign(new Error("Access revoked"), { status: 403 });
  let denyReads = false;
  const client = {
    listConnections: vi.fn(() =>
      denyReads
        ? Promise.reject(denied)
        : Promise.resolve([
            {
              connectionId: "current",
              connectorId: "warehouse",
              configured: true as const,
              updatedAt: "2026-10-09T00:00:00.000Z",
            },
          ]),
    ),
    replaceConnection: vi.fn().mockResolvedValue(undefined),
    removeConnection: vi.fn().mockResolvedValue(undefined),
  };

  render(
    <ExtensionConnections
      extensionId="inventory.sync"
      client={client}
      connectors={[{ connectorId: "warehouse", label: "Bodega", fields: [] }]}
    />,
  );
  expect(await screen.findByText("current")).toBeVisible();
  denyReads = true;

  await act(async () => {
    await expect(realtime.refreshes.at(-1)?.()).rejects.toBe(denied);
  });

  expect(screen.queryByText("current")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Access revoked");
});
