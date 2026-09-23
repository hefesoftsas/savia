import { useState } from "react";
import { screen, cleanup, within } from "@testing-library/react";
import { render } from "../studio-engine/test/locale-test-render";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it } from "vitest";
import { RequestActionsEditor } from "@/features/studio-engine/request-actions-editor";
import { setStudioRuntime } from "@/features/studio-engine/runtime";
import { requestPageSchema } from "@savia/studio-shared/request-page";
afterEach(() => {
  cleanup();
  setStudioRuntime({ embedded: false });
});
it("edits lookup mappings without executing requests or changing submit actions", async () => {
  let calls = 0;
  setStudioRuntime({
    embedded: true,
    requestTransport: async (_path, init) => {
      expect(init?.method).toBe("GET");
      calls++;
      return Response.json({ paths: {} });
    },
  });
  const initial = requestPageSchema.parse({
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
  let saved = initial;
  function Harness() {
    const [config, setConfig] = useState(initial);
    return (
      <RequestActionsEditor
        fieldId="plate"
        fields={{
          plate: { type: "Textbox", label: "Placa" },
          year: { type: "Number", label: "Año" },
        }}
        config={config}
        onChange={(value) => {
          saved = value;
          setConfig(value);
        }}
      />
    );
  }
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Harness />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  const tabs = screen.getByRole("tablist", { name: "Idioma de la etiqueta" });
  await user.click(within(tabs).getByText("ES"));
  const label = screen.getByDisplayValue("Consultar placa");
  await user.clear(label);
  await user.type(label, "Buscar vehículo");
  await user.click(screen.getByText("Mapeo del request"));
  const path = screen.getByLabelText("Ruta en la respuesta");
  await user.clear(path);
  await user.type(path, "/data/vehicle/productionYear");
  expect(saved.actions[1].label).toBe("Buscar vehículo");
  expect(saved.actions[1].output.year).toBe("/data/vehicle/productionYear");
  expect(saved.actions[0]).toEqual(initial.actions[0]);
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Estilo del botón" }),
    "icon",
  );
  await user.click(screen.getByRole("button", { name: "Icono del botón" }));
  await user.click(screen.getByRole("tab", { name: "Marcas" }));
  await user.click(screen.getByRole("option", { name: "HubSpot" }));
  expect(saved.actions[1].buttonStyle).toBe("icon");
  expect(saved.actions[1].icon).toBe("thesvg:hubspot");
  await user.click(screen.getByRole("button", { name: "Eliminar consulta" }));
  expect(saved.actions).toHaveLength(1);
  expect(calls).toBe(1);
});
