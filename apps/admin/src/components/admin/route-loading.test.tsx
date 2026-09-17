import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RouteLoading } from "./route-loading";

describe("RouteLoading", () => {
  afterEach(cleanup);

  it("renders page skeleton with empty sections and label", () => {
    render(<RouteLoading label="Cargando Savia…" />);

    expect(screen.getByRole("status")).toBeVisible();
    expect(screen.getByText("Cargando Savia…")).toBeVisible();
    const skeletons = document.querySelectorAll("[data-slot='skeleton']");
    expect(skeletons.length).toBeGreaterThanOrEqual(10);
  });

  it("renders compact mode when compact is true", () => {
    render(<RouteLoading compact label="Cargando…" />);

    expect(screen.getByRole("status")).toBeVisible();
    expect(screen.getByText("Cargando…")).toBeVisible();
    const skeletons = document.querySelectorAll("[data-slot='skeleton']");
    expect(skeletons.length).toBe(0);
  });
});
