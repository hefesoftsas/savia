import userEvent from "@testing-library/user-event";
import { screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { render } from "./locale-test-render";
import { expect, it, vi, afterEach } from "vitest";

const requestPageApiMock = vi.hoisted(() => vi.fn());

vi.mock("../request-page-api", () => ({
  requestPageApi: requestPageApiMock,
}));

import { RequestMappingEditor } from "../request-mapping-editor";
import { requestPageSchema } from "@savia/studio-shared/request-page";
afterEach(() => {
  cleanup();
  requestPageApiMock.mockReset();
});
it("changes only the selected input mapping", async () => {
  const config = requestPageSchema.parse({
    version: 1,
    source: "savia-request",
    actions: [
      {
        id: "quote",
        operationId: "quote",
        label: "Cotizar",
        kind: "submit",
        input: { plate: "old" },
        output: {},
      },
    ],
  });
  const onChange = vi.fn();
  render(
    <RequestMappingEditor
      config={config}
      fields={{ old: { label: "Placa" }, next: { label: "Otra placa" } }}
      onChange={onChange}
    />,
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Campo para plate" }), {
    target: { value: "next" },
  });
  expect(onChange.mock.calls[0][0].actions[0]).toEqual({
    ...config.actions[0],
    input: { plate: "next" },
  });
  await userEvent.click(screen.getByRole("tab", { name: "Respuestas (0)" }));
  expect(screen.getByText(/todavía no tiene ejecuciones/)).toBeTruthy();
});

it("removes a connection while preserving the remaining main action", () => {
  const config = requestPageSchema.parse({
    version: 1,
    source: "savia-request",
    actions: ["first", "second"].map((id) => ({
      id,
      operationId: id,
      label: id,
      kind: "submit",
      input: {},
      output: {},
    })),
  });
  const onChange = vi.fn();
  const { unmount } = render(
    <RequestMappingEditor config={config} fields={{}} onChange={onChange} />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Quitar de esta página" }),
  );
  expect(
    onChange.mock.calls[0][0].actions.map(
      (action: { id: string }) => action.id,
    ),
  ).toEqual(["second"]);
  unmount();
  render(
    <RequestMappingEditor
      config={{ ...config, actions: [config.actions[0]] }}
      fields={{}}
      onChange={onChange}
    />,
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Quitar de esta página",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

it("marks the remove-connection action with the standard delete icon", () => {
  const config = requestPageSchema.parse({
    version: 1,
    source: "savia-request",
    actions: ["first", "second"].map((id) => ({
      id,
      operationId: id,
      label: id,
      kind: "submit",
      input: {},
      output: {},
    })),
  });
  render(
    <RequestMappingEditor config={config} fields={{}} onChange={vi.fn()} />,
  );

  expect(
    screen
      .getByRole("button", { name: "Quitar de esta página" })
      .querySelector(".lucide-trash-2"),
  ).not.toBeNull();
});

it("uses an icon-only remove action with an explanatory tooltip", async () => {
  const user = userEvent.setup();
  const config = requestPageSchema.parse({
    version: 1,
    source: "savia-request",
    actions: ["first", "second"].map((id) => ({
      id,
      operationId: id,
      label: id,
      kind: "submit",
      input: {},
      output: {},
    })),
  });
  render(
    <RequestMappingEditor config={config} fields={{}} onChange={vi.fn()} />,
  );

  const removeRequest = screen.getByRole("button", {
    name: "Quitar de esta página",
  });
  expect(removeRequest.textContent).toBe("");
  await user.hover(removeRequest);
  expect((await screen.findByRole("tooltip")).textContent).toContain(
    "Quitar de esta página",
  );
});

it("keeps mappings collapsed and reveals the matching property while searching", async () => {
  const config = requestPageSchema.parse({
    version: 1,
    source: "savia-request",
    actions: [
      {
        id: "quote",
        operationId: "quote",
        label: "Cotizar",
        kind: "submit",
        input: { plate: "plate", email: "email" },
        output: {},
      },
    ],
  });
  render(
    <RequestMappingEditor
      config={config}
      fields={{
        plate: { label: "Placa" },
        email: { label: "Correo electrónico" },
      }}
      onChange={vi.fn()}
    />,
  );

  const plate = screen
    .getByText("plate", { selector: "summary span" })
    .closest("details");
  const email = screen
    .getByText("email", { selector: "summary span" })
    .closest("details");
  expect(plate?.open).toBe(false);
  expect(email?.open).toBe(false);

  await userEvent.type(
    screen.getByRole("searchbox", { name: "Buscar propiedad" }),
    "correo",
  );

  await waitFor(() => {
    expect(plate?.hidden).toBe(true);
    expect(email?.open).toBe(true);
  });
});

it("keeps connection actions compact beside the editor controls", async () => {
  const config = requestPageSchema.parse({
    version: 1,
    source: "savia-request",
    actions: ["first", "second"].map((id) => ({
      id,
      operationId: id,
      label: id,
      kind: "submit",
      input: {},
      output: {},
    })),
  });
  render(
    <RequestMappingEditor config={config} fields={{}} onChange={vi.fn()} />,
  );

  expect(
    screen.getByRole("button", { name: "Quitar de esta página" }).className,
  ).toContain("size-8");

  await userEvent.click(screen.getByRole("tab", { name: "Respuestas (0)" }));
  expect(
    screen.getByRole("button", { name: "Actualizar respuestas" }).className,
  ).toContain("h-8");
});

it("moves connection status and execution details into contextual tooltips", async () => {
  const user = userEvent.setup();
  const config = requestPageSchema.parse({
    version: 1,
    source: "savia-request",
    actions: [
      {
        id: "quote",
        operationId: "quote",
        label: "Cotizar",
        kind: "submit",
        input: {},
        output: {},
      },
    ],
  });
  render(
    <RequestMappingEditor config={config} fields={{}} onChange={vi.fn()} />,
  );

  expect(
    screen.queryByText("1 operaciones · Los cambios se guardan al publicar"),
  ).toBeNull();
  expect(screen.queryByText("Se ejecuta con el botón principal")).toBeNull();
  expect(
    screen.getByRole("button", {
      name: "Cómo se ejecuta esta operación",
    }),
  ).toBeTruthy();

  await user.hover(
    screen.getByRole("button", { name: "Estado de las conexiones" }),
  );
  expect((await screen.findByRole("tooltip")).textContent).toContain(
    "1 operaciones · Los cambios se guardan al publicar",
  );
});

it("moves the saved-response explanation into a contextual tooltip", async () => {
  const user = userEvent.setup();
  requestPageApiMock.mockResolvedValue({
    data: [
      {
        id: "run-1",
        domainId: "platform",
        pageName: "cotizador",
        actionId: "quote",
        label: "Cotizar",
        mode: "mock",
        status: "complete",
        values: {},
        result: null,
        error: null,
        createdAt: "2026-09-12T12:00:00.000Z",
      },
    ],
  });
  const config = requestPageSchema.parse({
    version: 1,
    source: "savia-request",
    actions: [
      {
        id: "quote",
        operationId: "quote",
        label: "Cotizar",
        kind: "submit",
        input: {},
        output: {},
      },
    ],
  });
  render(
    <RequestMappingEditor
      config={config}
      fields={{}}
      pageName="cotizador"
      onChange={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("tab", { name: "Respuestas (0)" }));
  expect(
    await screen.findByRole("combobox", { name: "Ejecución" }),
  ).toBeTruthy();
  expect(
    screen.queryByText(
      "Datos enviados desde el formulario y respuesta guardada. Consultar este historial no ejecuta el request.",
    ),
  ).toBeNull();

  await user.hover(
    screen.getByRole("button", {
      name: "Ayuda sobre las respuestas guardadas",
    }),
  );
  expect((await screen.findByRole("tooltip")).textContent).toContain(
    "Consultar este historial no ejecuta el request.",
  );
});
