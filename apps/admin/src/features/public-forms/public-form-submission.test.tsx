import { I18nContextProvider } from "ra-core";
import type { ReactElement, ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render as testingRender,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SafeResult } from "./public-form-submission";

const result = {
  quotes: [
    {
      insurer: "Equidad",
      product: "Equidad · Full",
      premiumTotal: 2000000,
      currency: "COP" as const,
      coverages: ["Asistencia"],
    },
    {
      insurer: "Liberty",
      product: "Liberty · Básico",
      premiumTotal: 1448081,
      currency: "COP" as const,
      coverages: ["Asistencia", "Jurídica"],
    },
    {
      insurer: "Equidad",
      product: "Equidad · RCE",
      premiumTotal: null,
      currency: "COP" as const,
      coverages: [],
    },
  ],
  unavailable: 2,
};

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

it("ranks cheapest first with a best-price ribbon and insurer filter chips", async () => {
  render(<SafeResult result={result} />);
  const headings = screen.getAllByRole("heading", { level: 4 });
  expect(headings.map((h) => h.textContent)).toEqual([
    "Liberty",
    "Equidad",
    "Equidad",
  ]);
  expect(screen.getByText(/Mejor precio/)).toBeInTheDocument();
  expect(screen.getByText("Liberty · Básico")).toBeInTheDocument();
  expect(screen.getByText("Valor por confirmar")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /Todas las aseguradoras/ }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Equidad \(2\)/ }));
  expect(screen.queryByText("Liberty · Básico")).not.toBeInTheDocument();
  expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(2);
  expect(screen.queryByText("PRIVATE")).not.toBeInTheDocument();
});

it("prints the results through the PDF button", async () => {
  const print = vi.fn();
  Object.defineProperty(window, "print", {
    configurable: true,
    value: print,
  });
  render(<SafeResult result={result} />);
  fireEvent.click(screen.getByRole("button", { name: "Descargar PDF" }));
  expect(print).toHaveBeenCalledTimes(1);
});
it("copies the quote summary and reports unavailable products", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(<SafeResult result={result} />);
  fireEvent.click(
    screen.getAllByRole("button", { name: "Copiar cotización" })[0],
  );
  expect(writeText).toHaveBeenCalledWith(
    expect.stringContaining("Liberty · Básico"),
  );
  expect(
    screen.getByText("2 resultados no están disponibles."),
  ).toBeInTheDocument();
});
