import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppServicesProvider } from "@/features/assistant/assistant-context";
import type { OutboxOp, OutboxTable } from "./outbox";
import { useOutbox } from "./use-outbox";

function stubTable(): OutboxTable & { rows: Map<number, OutboxOp> } {
  const rows = new Map<number, OutboxOp>();
  let nextId = 1;
  return {
    rows,
    get: async (id: number) => rows.get(id),
    add: async (op: OutboxOp) => {
      const id = nextId++;
      rows.set(id, { ...op, id });
      return id;
    },
    put: async (op: OutboxOp) => {
      if (op.id !== undefined) rows.set(op.id, op);
    },
    delete: async (id: number) => {
      rows.delete(id);
    },
    where: (index: string) => ({
      equals: (value: unknown) => ({
        toArray: async () =>
          [...rows.values()].filter(
            (row) =>
              (row as unknown as Record<string, unknown>)[index] === value,
          ),
      }),
    }),
  };
}

function HookProbe({
  table,
  direct,
  onReady,
}: {
  table: OutboxTable;
  direct: () => Promise<unknown>;
  onReady: (api: {
    ops: OutboxOp[];
    saveOrQueue: (
      resource: string,
      action: string,
      payload: unknown,
      direct: () => Promise<unknown>,
    ) => Promise<void>;
  }) => void;
}) {
  const { ops, saveOrQueue } = useOutbox(table);
  onReady({ ops, saveOrQueue });
  void direct;
  return <span data-testid="count">{ops.length}</span>;
}

function setup(direct: () => Promise<unknown>, table = stubTable()) {
  let api:
    | {
        ops: OutboxOp[];
        saveOrQueue: (
          resource: string,
          action: string,
          payload: unknown,
          direct: () => Promise<unknown>,
        ) => Promise<void>;
      }
    | undefined;
  const services = {
    userPreferences: {
      saveAppearance: vi.fn(),
      saveSidebarNavigation: vi.fn(),
    },
  } as never;
  render(
    <AppServicesProvider services={services}>
      <HookProbe
        table={table}
        direct={direct}
        onReady={(ready) => {
          api = ready;
        }}
      />
    </AppServicesProvider>,
  );
  return {
    api: () => {
      if (!api) throw new Error("hook not ready");
      return api;
    },
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useOutbox saveOrQueue", () => {
  it("queues eligible saves when the direct call fails offline", async () => {
    const { api } = setup(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    await act(async () => {
      await api().saveOrQueue(
        "user-preferences",
        "save-appearance",
        { version: 1 },
        () => Promise.reject(new TypeError("Failed to fetch")),
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("count")).toHaveTextContent("1");
    });
  });

  it("sends directly when online without queueing", async () => {
    const direct = vi.fn().mockResolvedValue(undefined);
    const { api } = setup(direct);
    await act(async () => {
      await api().saveOrQueue(
        "user-preferences",
        "save-appearance",
        { version: 1 },
        direct,
      );
    });
    expect(direct).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("rethrows non-offline and ineligible errors", async () => {
    const { api } = setup(() => Promise.reject(new Error("VALIDATION_ERROR")));
    await expect(
      api().saveOrQueue("user-preferences", "save-appearance", {}, () =>
        Promise.reject(new Error("VALIDATION_ERROR")),
      ),
    ).rejects.toThrow("VALIDATION_ERROR");
    await expect(
      api().saveOrQueue("users", "delete", {}, () =>
        Promise.reject(new TypeError("Failed to fetch")),
      ),
    ).rejects.toThrow(TypeError);
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });
});
