import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResultCards, type ResultCardRow } from "../result-cards";
import { requestPageSchema } from "@savia/crm-shared/request-page";
const rows: ResultCardRow[] = Array.from({ length: 5 }, (_, i) => ({
  id: String(i),
  title: `Opción ${i}`,
  status: "Disponible",
  date: "2026-09-12T00:00:00Z",
  simulation: true,
  values: [`Valor ${i}`],
  errors: i === 0 ? ["Respuesta incompleta"] : [],
  response: {},
  onLoad: vi.fn(),
}));
describe("presentación configurable", () => {
  it("compara valores reales, limita la selección y conserva errores y acciones", () => {
    render(
      <ResultCards
        rows={rows}
        columns={[{ label: "Detalle", pointer: "/result", format: "text" }]}
        comparison
      />,
    );
    expect(screen.getByText("Respuesta incompleta")).toBeTruthy();
    const checks = screen.getAllByRole("checkbox");
    checks.slice(0, 4).forEach((input) => fireEvent.click(input));
    expect((checks[4] as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole("table")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Cargar datos" })[0]);
    expect(rows[0].onLoad).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "inexistente" },
    });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain(
      "No hay resultados",
    );
  });
  it("valida la configuración y mantiene compatibles las pantallas existentes", () => {
    const config = {
      version: 1,
      source: "savia-request",
      actions: [
        {
          id: "test",
          operationId: "test",
          label: "Test",
          kind: "submit",
          input: {},
        },
      ],
    };
    expect(requestPageSchema.safeParse(config).success).toBe(true);
    expect(
      requestPageSchema.parse({ ...config, resultLayout: "comparison" })
        .resultLayout,
    ).toBe("comparison");
    expect(
      requestPageSchema.safeParse({ ...config, resultLayout: "unsupported" }).success,
    ).toBe(false);
  });
});

it("renders custom HTML in an isolated frame and escapes response values", () => {
  const row = { ...rows[0], title: '<img src=x onerror="alert(1)">' };
  const { container } = render(<ResultCards rows={[row]} columns={[]} comparison={false} customHtml="<h2>{{values.title}}</h2>" />);
  const frame = container.querySelector("iframe")!;
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  expect(frame.srcdoc).toContain("&lt;img");
  expect(frame.srcdoc).toContain("default-src 'none'");
});
