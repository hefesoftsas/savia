import { expect, it } from "vitest";
import { quoteTabForScreen } from "../../../store-ports/quotes/entry-selection";

it("opens the matching quote view for each store screen", () => {
  expect(quoteTabForScreen("cotizador_por_pasos")).toBe("wizard");
  expect(quoteTabForScreen("cotizador")).toBe("direct");
  expect(quoteTabForScreen("administrar_seguros")).toBe("admin");
  expect(quoteTabForScreen(undefined)).toBe("wizard");
});
