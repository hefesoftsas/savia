// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { cleanup, screen } from "@testing-library/react";
import { render } from "./locale-test-render";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { RequestPageResultsEditor } from "../request-page-results-editor";
import { requestPageSchema } from "@savia/crm-shared/request-page";

afterEach(() => cleanup());

it("edits submit label, action labels, and result columns", async () => {
  const user = userEvent.setup();
  const initial = requestPageSchema.parse({
    version: 1,
    source: "savia-request",
    submitLabel: "Cotizar",
    actions: [
      {
        id: "quote-a",
        operationId: "execute_quote-a",
        label: "Aseguradora A",
        kind: "submit",
        input: { plate: "plate" },
      },
      {
        id: "lookup",
        operationId: "execute_lookup",
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
      <RequestPageResultsEditor
        config={config}
        onChange={(next) => {
          saved = next;
          setConfig(next);
        }}
      />
    );
  }

  render(<Harness />);

  await user.click(screen.getByText("Botón y nombres de operaciones"));

  const submitLabelInput = screen.getByRole("textbox", {
    name: "Texto del botón principal",
  });
  await user.clear(submitLabelInput);
  await user.type(submitLabelInput, "Ejecutar cotización");
  expect(saved.submitLabel).toBe("Ejecutar cotización");

  await user.click(screen.getByRole("button", { name: "Añadir columna" }));
  expect(saved.resultColumns).toHaveLength(2);

  await user.click(screen.getByRole("button", { name: "Restablecer" }));
  expect(saved.resultColumns).toEqual(initial.resultColumns);

  expect(screen.getByText("Operaciones")).toBeVisible();
  expect(screen.queryByText("lookup")).not.toBeInTheDocument();
  expect(screen.getByText("quote-a")).toBeVisible();
});

it("previews the selected layout using the published cards", async () => {
  const config = requestPageSchema.parse({
    version: 1,
    source: "savia-request",
    resultLayout: "comparison",
    actions: [
      {
        id: "example",
        operationId: "example",
        label: "Ejemplo",
        kind: "submit",
        input: {},
      },
    ],
  });
  render(<RequestPageResultsEditor config={config} onChange={() => {}} />);
  await userEvent.click(screen.getByRole("tab", { name: "Vista previa" }));
  expect(
    screen.getByRole("heading", { name: "Resultado de ejemplo 1" }),
  ).toBeVisible();
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("checkbox", { name: "Comparar Resultado de ejemplo 1" }),
  );
  await user.click(
    screen.getByRole("checkbox", { name: "Comparar Resultado de ejemplo 2" }),
  );
  expect(screen.getByRole("table")).toBeVisible();
});

it("offers React and lists the component context without requiring result columns", async () => {
  const config = requestPageSchema.parse({
    version: 1,
    source: "savia-request",
    resultLayout: "react",
    resultReact: "export default function Results() { return <p>Hola</p>; }",
    resultColumns: [],
    actions: [
      {
        id: "example",
        operationId: "example",
        label: "Ejemplo",
        kind: "submit",
        input: {},
      },
    ],
  });
  render(<RequestPageResultsEditor config={config} onChange={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: "Editar React" }));
  expect(screen.getByRole("dialog")).toBeVisible();
  await userEvent.click(
    screen.getByText("Propiedades disponibles del componente"),
  );
  expect(screen.getByText("rows[]")).toBeVisible();
  expect(screen.getByText("load(id)")).toBeVisible();
});
