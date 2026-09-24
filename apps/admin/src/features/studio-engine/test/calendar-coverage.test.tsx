// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { PluginApi } from "@savia/studio-shared/plugin-api";
import { releaseCatalog } from "@savia/release-catalog";
afterEach(cleanup);
function setup() {
  const rows: Record<string, unknown>[] = [];
  const collection = {
    list: vi.fn(async () => ({ data: rows, total: rows.length })),
    create: vi.fn(async (input: Record<string, unknown>) => {
      const row = { ...input, id: "event-1", _version: 1 };
      rows.push(row);
      return row;
    }),
    update: vi.fn(
      async (
        id: string,
        input: Record<string, unknown>,
        options: { version: number },
      ) => {
        const row = { ...input, id, _version: options.version + 1 };
        rows[0] = row;
        return row;
      },
    ),
  };
  const savia = {
    collections: { collection: () => collection },
    connections: { list: vi.fn(async () => []) },
    actions: { list: vi.fn(async () => []) },
  } as unknown as PluginApi;
  const Calendar = releaseCatalog.extensionScreens.find(
    (entry) => entry.extensionId === "insurance.calendar",
  )!.Screen;
  render(<Calendar savia={savia} />);
  return collection;
}
it.each(["change", "input"] as const)(
  "preserves local date %s events across other fields, saves UTC and updates using current version",
  async (eventName) => {
    const collection = setup();
    await waitFor(() => expect(collection.list).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Título"), {
      target: { value: "Revisión" },
    });
    fireEvent[eventName](screen.getByLabelText("Inicio"), {
      target: { value: "2026-09-21T09:00" },
    });
    fireEvent[eventName](screen.getByLabelText("Fin"), {
      target: { value: "2026-09-21T10:00" },
    });
    fireEvent.change(screen.getByLabelText("Descripción"), {
      target: { value: "Primera visita" },
    });
    expect(screen.getByLabelText("Inicio")).toHaveValue("2026-09-21T09:00");
    expect(screen.getByLabelText("Fin")).toHaveValue("2026-09-21T10:00");
    expect(
      screen.getByRole("button", { name: "Guardar evento" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Guardar evento" }));
    await waitFor(() => expect(collection.create).toHaveBeenCalledOnce());
    const payload = JSON.parse(
      String(collection.create.mock.calls[0][0].payload),
    );
    expect(payload).toMatchObject({
      start: "2026-09-21T14:00:00.000Z",
      end: "2026-09-21T15:00:00.000Z",
      timeZone: "America/Bogota",
      description: "Primera visita",
    });
    await screen.findByText("Evento guardado en la agenda.");
    fireEvent.change(screen.getByLabelText("Fin"), {
      target: { value: "2026-09-21T11:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar evento" }));
    await waitFor(() => expect(collection.update).toHaveBeenCalledOnce());
    expect(collection.update.mock.calls[0][2]).toEqual({ version: 1 });
    expect(
      JSON.parse(String(collection.update.mock.calls[0][1].payload)).end,
    ).toBe("2026-09-21T16:00:00.000Z");
  },
);
it("shows a recoverable error for a nonexistent local time and disables saving", async () => {
  const collection = setup();
  await waitFor(() => expect(collection.list).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText("Zona horaria"), {
    target: { value: "America/New_York" },
  });
  fireEvent.change(screen.getByLabelText("Inicio"), {
    target: { value: "2026-03-08T02:30" },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("no existe");
  expect(screen.getByRole("button", { name: "Guardar evento" })).toBeDisabled();
});
