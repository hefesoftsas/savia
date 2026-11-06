import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AssistantMarkdown,
  AssistantPresentationCard,
  presentationFrom,
} from "./assistant-response-ui";

describe("assistant response UI", () => {
  it("renders a Markdown table as a semantic table", () => {
    render(
      <AssistantMarkdown
        text={"| Aseguradora | Oferta |\n| --- | ---: |\n| Savia | 128000 |"}
      />,
    );

    const table = screen.getByRole("table");
    expect(table).toBeVisible();
    expect(table).not.toHaveAttribute("node");
    expect(
      screen.getByRole("columnheader", { name: "Aseguradora" }),
    ).toBeVisible();
    expect(screen.getByRole("cell", { name: "128000" })).toBeVisible();
  });

  it("renders a bounded data table returned by the presentation tool", () => {
    const presentation = presentationFrom({
      title: "Ofertas por aseguradora",
      visualization: {
        kind: "table",
        columns: ["Aseguradora", "Valor"],
        rows: [["Savia", 128000]],
      },
    });

    expect(presentation).not.toBeNull();
    render(<AssistantPresentationCard presentation={presentation!} />);

    expect(
      screen.getByRole("heading", { name: "Ofertas por aseguradora" }),
    ).toBeVisible();
    const table = screen.getByRole("table", {
      name: "Ofertas por aseguradora",
    });
    expect(table).toBeVisible();
    expect(within(table).getByRole("cell", { name: "Savia" })).toBeVisible();
  });

  it("renders a labelled line chart from numeric series", () => {
    const presentation = presentationFrom({
      title: "Cotizaciones por día",
      description: "Últimos tres días",
      visualization: {
        kind: "line",
        valueLabel: "Cotizaciones",
        series: [
          { label: "Lun", value: 3 },
          { label: "Mar", value: 7 },
          { label: "Mié", value: 5 },
        ],
      },
    });

    expect(presentation).not.toBeNull();
    render(<AssistantPresentationCard presentation={presentation!} />);

    expect(
      screen.getByRole("img", {
        name: "Cotizaciones por día. Cotizaciones: Lun 3, Mar 7, Mié 5.",
      }),
    ).toBeVisible();
    expect(screen.getByText("Últimos tres días")).toBeVisible();
  });

  it("keeps the zero baseline inside a bar chart with only negative values", () => {
    const presentation = presentationFrom({
      title: "Variación diaria",
      visualization: {
        kind: "bar",
        valueLabel: "Variación",
        series: [
          { label: "Lun", value: -5 },
          { label: "Mar", value: -3 },
        ],
      },
    });

    render(<AssistantPresentationCard presentation={presentation!} />);

    const chart = screen.getByRole("img", { name: /Variación diaria/ });
    const baseline = chart.querySelector("line");
    expect(baseline).not.toBeNull();
    expect(Number(baseline?.getAttribute("y1"))).toBeGreaterThanOrEqual(0);
    expect(Number(baseline?.getAttribute("y1"))).toBeLessThanOrEqual(144);
  });

  it("does not render malformed presentation data", () => {
    expect(
      presentationFrom({
        title: "Datos no válidos",
        visualization: {
          kind: "table",
          columns: ["A"],
          rows: [["valor", "columna adicional"]],
        },
      }),
    ).toBeNull();
  });
});
