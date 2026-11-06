import { I18nContextProvider } from "ra-core";
import type { ReactElement, ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render as testingRender,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  PublicComparison,
  PublicReceiptResult,
  type PublicComparisonItem,
} from "./public-comparison";

const items: PublicComparisonItem[] = [
  {
    flowId: "equidad-full-quote",
    insurer: "Equidad",
    product: "Equidad · Full",
    premiumTotal: 2000000,
    status: "succeeded",
  },
  {
    flowId: "liberty-basico-quote",
    insurer: "Liberty",
    product: "Liberty · Básico",
    premiumTotal: 1448081,
    status: "succeeded",
  },
  {
    flowId: "equidad-rce-quote",
    insurer: "Equidad",
    product: "Equidad · RCE",
    premiumTotal: null,
    status: "succeeded",
  },
  {
    flowId: "sbs-producto-8",
    insurer: "SBS",
    product: "SBS · Autos Producto 8",
    premiumTotal: null,
    status: "failed",
  },
];

afterEach(cleanup);

function render(ui: ReactElement) {
  return testingRender(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <I18nContextProvider
        value={{
          translate: (key: string) => key,
          changeLocale: async () => {},
          getLocale: () => "es",
        }}
      >
        {children}
      </I18nContextProvider>
    ),
  });
}

it("renders the shared comparator with plan data, filter and table", async () => {
  render(<PublicComparison items={items} />);
  const cards = () =>
    within(document.querySelector(".insurance-comparator__cards")!);
  // Same ranking language as the embedded comparator: score, then premium.
  const headings = cards().getAllByRole("heading", { level: 3 });
  expect(headings.map((h) => h.textContent)).toEqual([
    "Equidad",
    "Liberty",
    "Equidad",
  ]);
  // Static plan data enriches the cards: badges, highlights, product names.
  expect(
    screen.getByText(/Mejor relación cobertura\/precio/),
  ).toBeInTheDocument();
  expect(cards().getByText("Plan Full")).toBeInTheDocument();
  expect(cards().getByText("Básico RCE")).toBeInTheDocument();
  expect(cards().getByText("Consultar")).toBeInTheDocument();
  // Brand logos replace the monogram.
  expect(screen.getByAltText("Logo de Liberty")).toBeInTheDocument();
  // Provider filter chips from the shared component.
  fireEvent.click(screen.getByRole("button", { name: /Equidad \(2\)/ }));
  expect(cards().queryByText("Básico RCE")).not.toBeInTheDocument();
  expect(cards().getAllByRole("heading", { level: 3 })).toHaveLength(2);
  fireEvent.click(
    screen.getByRole("button", { name: /Todas las aseguradoras/ }),
  );
  expect(
    within(
      document.querySelector(".insurance-comparator__cards")!,
    ).getAllByRole("heading", { level: 3 }),
  ).toHaveLength(3);
  // Coverage table fed by the static plan catalog.
  expect(screen.getByText("$3.000.000.000 COP")).toBeInTheDocument();
  expect(
    screen.getAllByText("No informado por la aseguradora").length,
  ).toBeGreaterThan(0);
});

it("hides retry, history and quote numbers by construction", async () => {
  render(<PublicComparison items={items} />);
  expect(
    screen.queryByRole("button", { name: /Reintentar/ }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Historial")).not.toBeInTheDocument();
  expect(document.querySelector("code")).toBeNull();
  // Failed rows report without retry actions.
  expect(screen.getByText(/Falló/)).toBeInTheDocument();
});

it("toggles comparison columns through the shared compare-select", async () => {
  render(<PublicComparison items={items} />);
  expect(screen.getByText("$3.000.000.000 COP")).toBeInTheDocument();
  // Everything is compared by default; uncompare the first card.
  const toggle = screen.getAllByRole("button", { name: /del comparador/ })[0];
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(screen.queryByText("$3.000.000.000 COP")).not.toBeInTheDocument();
});

it("copies the quote data without private fields", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(<PublicComparison items={items} />);
  fireEvent.click(
    screen.getAllByRole("button", { name: "Copiar datos de cotización" })[0],
  );
  const copied = String(writeText.mock.calls[0][0]);
  expect(copied).toContain("Plan Full");
  expect(copied).not.toMatch(/run_id|flowId|quoteNumber/i);
});

it("renders the receipt projection with the unavailable note", async () => {
  render(
    <PublicReceiptResult
      result={{
        quotes: [
          {
            flowId: "equidad-full-quote",
            insurer: "Equidad",
            product: "Equidad · Full",
            premiumTotal: 2000000,
            currency: "COP",
            coverages: ["Asistencia"],
          },
          {
            flowId: "liberty-basico-quote",
            insurer: "Liberty",
            product: "Liberty · Básico",
            premiumTotal: 1448081,
            currency: "COP",
            coverages: ["Asistencia", "Jurídica"],
          },
        ],
        unavailable: 2,
      }}
    />,
  );
  expect(
    within(document.querySelector(".insurance-comparator__cards")!).getByText(
      "Plan Full",
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByText("2 resultados no están disponibles."),
  ).toBeInTheDocument();
});

it("hides unknown receipt structures", async () => {
  const { container } = render(<PublicReceiptResult result={{ nope: true }} />);
  expect(container).toBeEmptyDOMElement();
});
