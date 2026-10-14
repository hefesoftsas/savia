import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  vi.unstubAllGlobals();
});

describe("OfflineBanner", () => {
  it("clears a false browser offline hint when Savia responds", async () => {
    setOnline(false);
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    render(<OfflineBanner />);
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toContain("/api/health");
  });

  it("does not mistake an HTTP API failure for no connectivity", async () => {
    setOnline(false);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );
    render(<OfflineBanner />);
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
  });
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
    expect(status).toHaveTextContent(/colecciones locales/i);
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
