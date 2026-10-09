import { StoreContextProvider, memoryStore } from "ra-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReadRefreshStatus } from "./read-refresh-status";

afterEach(cleanup);

const renderStatus = (ui: React.ReactNode, locale = "en") =>
  render(
    <StoreContextProvider value={memoryStore({ locale })}>
      {ui}
    </StoreContextProvider>,
  );

describe("ReadRefreshStatus", () => {
  it("shows localized nonblocking activity beside retained content", () => {
    renderStatus(
      <>
        <h2>Retained account content</h2>
        <ReadRefreshStatus refreshing />
      </>,
    );

    expect(
      screen.getByRole("heading", { name: "Retained account content" }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Updating");
  });

  it("uses the active Spanish locale", () => {
    renderStatus(<ReadRefreshStatus refreshing />, "es");

    expect(screen.getByRole("status")).toHaveTextContent("Actualizando");
  });

  it("shows a retry action for a refresh error without replacing content", () => {
    const onRetry = vi.fn();
    renderStatus(
      <>
        <p>Previously loaded records</p>
        <ReadRefreshStatus error="Network unavailable" onRetry={onRetry} />
      </>,
    );

    expect(screen.getByText("Previously loaded records")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Network unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("renders nothing when no refresh activity or error is present", () => {
    const { container } = renderStatus(<ReadRefreshStatus />);
    expect(container).toBeEmptyDOMElement();
  });
});
