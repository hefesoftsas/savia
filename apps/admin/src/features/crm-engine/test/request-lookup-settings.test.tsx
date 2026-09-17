import userEvent from "@testing-library/user-event";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RequestLookupSettings } from "../request-lookup-settings";
import { requestActionSchema } from "@savia/crm-shared/request-page";
afterEach(cleanup);
it("edits output mappings and debounce in the existing action contract", () => {
  const action = requestActionSchema.parse({
    id: "lookup",
    operationId: "lookup",
    label: "Consultar",
    kind: "lookup",
    input: { plate: "plate" },
    output: { year: "/data/year" },
    events: ["blur"],
  });
  const onChange = vi.fn();
  render(
    <RequestLookupSettings
      action={action}
      fields={{ plate: { label: "Placa" }, year: { label: "Año" } }}
      onChange={onChange}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Ruta para year" }), {
    target: { value: "/data/vehicle/year" },
  });
  expect(onChange.mock.calls[0][0].output.year).toBe("/data/vehicle/year");
  fireEvent.click(screen.getByRole("checkbox", { name: "Debounce" }));
  expect(
    requestActionSchema.parse(onChange.mock.calls[1][0]).eventDebounceMs,
  ).toBe(450);
  fireEvent.click(screen.getByRole("button", { name: "Quitar asignación" }));
  expect(onChange.mock.calls[2][0].output).toEqual({});
});

it("keeps lookup mapping actions compact", () => {
  const action = requestActionSchema.parse({
    id: "lookup",
    operationId: "lookup",
    label: "Consultar",
    kind: "lookup",
    input: { plate: "plate" },
    output: { year: "/data/year" },
  });
  render(
    <RequestLookupSettings
      action={action}
      fields={{
        plate: { label: "Placa" },
        year: { label: "Año" },
        make: { label: "Marca" },
      }}
      onChange={vi.fn()}
    />,
  );

  expect(
    screen.getByRole("button", { name: "Quitar asignación" }).className,
  ).toContain("h-8");
  expect(
    screen.getByRole("button", { name: "Agregar campo de salida" }).className,
  ).toContain("h-8");
});

it("moves lookup guidance into contextual tooltips", async () => {
  const user = userEvent.setup();
  const action = requestActionSchema.parse({
    id: "lookup",
    operationId: "lookup",
    label: "Consultar",
    kind: "lookup",
    input: { plate: "plate" },
    output: { year: "/data/year" },
  });
  render(
    <RequestLookupSettings
      action={action}
      fields={{ plate: { label: "Placa" }, year: { label: "Año" } }}
      onChange={vi.fn()}
    />,
  );

  expect(screen.queryByText(/Campo disparador:/)).toBeNull();
  expect(screen.queryByText(/Selecciona cada campo/)).toBeNull();
  expect(
    screen.getByRole("button", { name: "Ayuda sobre los disparadores" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Ayuda sobre los campos de salida" }),
  ).toBeTruthy();

  await user.hover(
    screen.getByRole("button", { name: "Ayuda sobre los disparadores" }),
  );
  expect((await screen.findByRole("tooltip")).textContent).toContain(
    "Campo disparador: Placa",
  );
});

it("keeps output mappings collapsed and opens the match from search", async () => {
  const action = requestActionSchema.parse({
    id: "lookup",
    operationId: "lookup",
    label: "Consultar",
    kind: "lookup",
    input: { plate: "plate" },
    output: { year: "/data/year", make: "/data/make" },
  });
  render(
    <RequestLookupSettings
      action={action}
      fields={{
        plate: { label: "Placa" },
        year: { label: "Año" },
        make: { label: "Marca" },
      }}
      onChange={vi.fn()}
    />,
  );

  const year = screen
    .getByText("Año", { selector: "summary span" })
    .closest("details");
  const make = screen
    .getByText("Marca", { selector: "summary span" })
    .closest("details");
  expect(year?.open).toBe(false);
  expect(make?.open).toBe(false);

  await userEvent.type(
    screen.getByRole("searchbox", { name: "Buscar campos de salida" }),
    "marca",
  );

  await waitFor(() => {
    expect(year?.hidden).toBe(true);
    expect(make?.open).toBe(true);
  });
});
