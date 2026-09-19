// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TruncatedWithTooltip } from "./truncated-with-tooltip";

describe("TruncatedWithTooltip", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(80);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("wraps truncated labels in a tooltip trigger", async () => {
    render(<TruncatedWithTooltip>Agregar sección</TruncatedWithTooltip>);

    await waitFor(() =>
      expect(
        screen.getByText("Agregar sección").closest('[data-slot="tooltip-trigger"]'),
      ).toBeTruthy(),
    );
  });

  it("renders plain text when the label is not truncated", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(120);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(120);

    render(<TruncatedWithTooltip>Agregar sección</TruncatedWithTooltip>);

    await waitFor(() =>
      expect(screen.getByText("Agregar sección")).toBeInTheDocument(),
    );
    expect(
      screen.getByText("Agregar sección").closest('[data-slot="tooltip-trigger"]'),
    ).toBeNull();
  });
});
