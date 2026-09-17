import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import {
  DesignerProvider,
  createInitialDesignerState,
} from "@form-eng/designer";
import { GroupedDesignerCanvas } from "@/features/crm-engine/grouped-designer-canvas";
import { requestPageSchema } from "@savia/crm-shared/request-page";
it("groups fields in section order and identifies lookup outputs while allowing reorder and selection", async () => {
  const requestPage = requestPageSchema.parse({
    version: 1,
    source: "savia-request",
    actions: [
      {
        id: "quote",
        operationId: "quote",
        label: "Cotizar",
        kind: "submit",
        input: { plate: "plate" },
      },
      {
        id: "lookup",
        operationId: "lookup",
        label: "Consultar placa",
        kind: "lookup",
        input: { plate: "plate" },
        output: { year: "/data/vehicle/year" },
      },
    ],
  });
  render(
    <DesignerProvider
      initialState={{
        ...createInitialDesignerState(),
        fields: {
          name: {
            type: "Textbox",
            label: "Nombre",
            config: { section: "person" },
          },
          plate: {
            type: "Textbox",
            label: "Placa",
            config: { section: "vehicle" },
          },
          year: {
            type: "Number",
            label: "Año",
            config: { section: "vehicle" },
          },
        },
        fieldOrder: ["name", "plate", "year"],
      }}
    >
      <GroupedDesignerCanvas
        sections={[
          { id: "vehicle", label: "Vehículo" },
          { id: "person", label: "Persona" },
        ]}
        requestPage={requestPage}
      />
    </DesignerProvider>,
  );
  expect(
    screen.getAllByRole("region").map((region) => region.getAttribute("aria-label")),
  ).toEqual(["Vehículo (2 campos)", "Persona (1 campo)"]);
  expect(
    screen.getByText("Botón: Consultar placa · Junto al campo (derecha)"),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Se completa con Consultar placa"),
  ).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /^Año/ }));
  expect(screen.getByRole("button", { name: /^Año/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    within(
      screen.getByRole("region", { name: "Vehículo (2 campos)" }),
    ).getByRole("button", { name: "Arrastrar Año" }),
  ).toBeInTheDocument();
});
