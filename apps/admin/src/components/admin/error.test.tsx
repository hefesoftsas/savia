import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Error as LayoutError } from "./error";
vi.mock("ra-core", () => ({
  useResetErrorBoundaryOnLocationChange: vi.fn(),
  Translate: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}));
afterEach(cleanup);
it("recovers missing route modules at the inner layout boundary", () => {
  render(
    <LayoutError
      error={
        new TypeError(
          "Failed to fetch dynamically imported module: /assets/old-route.js",
        )
      }
      resetErrorBoundary={() => {}}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Actualizar y recargar" }),
  ).toBeInTheDocument();
});
it("keeps ordinary application errors on the existing fallback", () => {
  render(
    <LayoutError
      error={new Error("Business validation failed")}
      resetErrorBoundary={() => {}}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Actualizar y recargar" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "ra.action.back" }),
  ).toBeInTheDocument();
});
