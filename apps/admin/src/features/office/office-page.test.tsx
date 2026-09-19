import { afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { OfficePage } from "./office-page";
import { loadOfficeEngine } from "./office-engine";
vi.mock("./office-engine", () => ({ loadOfficeEngine: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("reports denied access without starting the office engine", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ error: "Denied" }, { status: 403 })),
  );
  render(<OfficePage search="?base=%2Fv1%2Fdynamic-crm%2F1&file=file-1" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("permiso");
  expect(loadOfficeEngine).not.toHaveBeenCalled();
});
it("retains a recovery download and dirty state after a conflicting save", async () => {
  let dirty = () => {};
  vi.mocked(loadOfficeEngine).mockImplementation(async (_canvas, events) => {
    dirty = events.onDirty;
    return {
      open: async () => {},
      save: async () => new Uint8Array([1, 2]),
      dispose: () => {},
    };
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      const url = String(input);
      if (init?.method === "POST")
        return Response.json(
          { error: "Hay una versión más reciente" },
          { status: 409 },
        );
      if (url.endsWith("/office"))
        return Response.json({
          data: {
            id: "file-1",
            name: "policy.docx",
            mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            version: 1,
            size: 2,
            maxSize: 500000,
            readOnly: false,
          },
        });
      if (url.endsWith("/revisions"))
        return Response.json({
          data: [{ version: 1, size: 2, created_at: "2026-09-19" }],
        });
      return new Response(new Uint8Array([1, 2]));
    }),
  );
  render(<OfficePage search="?base=%2Fv1%2Fdynamic-crm%2F1&file=file-1" />);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Descargar copia" }),
    ).toBeEnabled(),
  );
  dirty();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("versión");
  expect(screen.getByRole("button", { name: "Descargar copia" })).toBeEnabled();
  expect(screen.getByText("Cambios sin guardar")).toBeInTheDocument();
  expect(screen.getByText("Versión 1")).toBeInTheDocument();
});

it.each([false, true])(
  "tracks edits that arrive during upload: %s",
  async (editDuringUpload) => {
    let dirty = () => {};
    let finishUpload: (response: Response) => void = () => {};
    let uploading = false;
    vi.mocked(loadOfficeEngine).mockImplementation(async (_canvas, events) => {
      dirty = events.onDirty;
      return {
        open: async () => {},
        save: async () => {
          dirty();
          return new Uint8Array([1, 2]);
        },
        dispose: () => {},
      };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, init) => {
        if (init?.method === "POST") {
          uploading = true;
          return new Promise<Response>((resolve) => {
            finishUpload = resolve;
          });
        }
        if (String(input).endsWith("/office"))
          return Response.json({
            data: {
              id: "file-1",
              name: "policy.docx",
              mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              size: 2,
              version: 1,
              maxSize: 500000,
              readOnly: false,
            },
          });
        if (String(input).endsWith("/revisions"))
          return Response.json({ data: [] });
        return new Response(new Uint8Array([1, 2]));
      }),
    );
    render(<OfficePage search="?base=%2Fv1%2Fdynamic-crm%2F1&file=file-1" />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Descargar copia" }),
      ).toBeEnabled(),
    );
    dirty();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(uploading).toBe(true));
    if (editDuringUpload) dirty();
    finishUpload(Response.json({ data: { version: 2 } }, { status: 201 }));
    await screen.findByText("Versión 2");
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Guardar" })
          .hasAttribute("disabled"),
      ).toBe(!editDuringUpload),
    );
    expect(
      screen.getByText(
        editDuringUpload ? "Cambios sin guardar" : "Guardado en Savia",
      ),
    ).toBeInTheDocument();
  },
);
