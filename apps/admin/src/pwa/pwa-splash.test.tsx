import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { PwaSplash, PwaSpinner, PWA_SPLASH_MESSAGE } from "./pwa-splash";

describe("PwaSplash", () => {
  afterEach(cleanup);

  it("shows a branded status with spinner and caption", () => {
    render(<PwaSplash />);

    const status = screen.getByRole("status", { name: PWA_SPLASH_MESSAGE });
    expect(status).toBeInTheDocument();
    expect(screen.getByTestId("pwa-spinner")).toBeInTheDocument();
    expect(screen.getByText(PWA_SPLASH_MESSAGE)).toBeInTheDocument();
  });

  it("supports a custom message", () => {
    render(<PwaSplash message="Cargando…" />);

    expect(
      screen.getByRole("status", { name: "Cargando…" }),
    ).toBeInTheDocument();
  });
});

describe("PwaSpinner", () => {
  afterEach(cleanup);

  it("renders a decorative ring with size class", () => {
    const { container } = render(<PwaSpinner size="xs" />);

    const spinner = screen.getByTestId("pwa-spinner");
    expect(spinner).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".savia-ring-xs")).not.toBeNull();
  });
});
