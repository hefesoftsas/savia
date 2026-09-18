import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OfflineBanner } from "./offline-banner";

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    value: online,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  setOnline(true);
});

describe("OfflineBanner", () => {
  it("renders nothing while online", () => {
    setOnline(true);
    const { container } = render(<OfflineBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("announces cached reads while offline", () => {
    setOnline(false);
    render(<OfflineBanner />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/sin conexión/i);
    expect(status).toHaveTextContent(/datos guardados/i);
  });

  it("reacts to connectivity changes", async () => {
    setOnline(true);
    render(<OfflineBanner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await act(async () => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toBeVisible();

    await act(async () => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
