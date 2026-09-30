import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  TenantBrandingProvider,
  useTenantBranding,
} from "./tenant-branding-provider";
const branding = {
  displayName: "Agencia Uno",
  loginTitle: "Bienvenido",
  loginDescription: "Tu espacio",
  primaryColor: "#125633",
  accentColor: "#d1e8d9",
  logoUrl: null,
  coverUrl: null,
  version: 1,
};
function Name() {
  const { branding } = useTenantBranding();
  return <span>{branding?.displayName ?? "Sin marca"}</span>;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("style");
  delete document.documentElement.dataset.colorTheme;
});
it("loads only public host branding and restores its variables on unmount", async () => {
  document.documentElement.style.setProperty("--background", "untouched");
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ data: branding })));
  vi.stubGlobal("fetch", fetcher);
  const view = render(
    <TenantBrandingProvider>
      <Name />
    </TenantBrandingProvider>,
  );
  await screen.findByText("Agencia Uno");
  await waitFor(() =>
    expect(
      getComputedStyle(document.documentElement).getPropertyValue("--primary"),
    ).toBe("#125633"),
  );
  expect(document.documentElement.style.getPropertyValue("--background")).toBe(
    "untouched",
  );
  expect(fetcher.mock.calls[0][0]).toContain("/api/public/tenant-branding");
  expect(fetcher.mock.calls[0][1].credentials).toBe("omit");
  expect(fetcher.mock.calls[0][1].cache).toBe("default");
  view.unmount();
  expect(
    getComputedStyle(document.documentElement).getPropertyValue("--primary"),
  ).toBe("");
});
it("clears old branding when the host changes and ignores its stale response", async () => {
  let resolveOld!: (value: Response) => void;
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: null })));
  vi.stubGlobal("fetch", fetcher);
  const view = render(
    <TenantBrandingProvider hostname="first.savia.app.hefesoft.com">
      <Name />
    </TenantBrandingProvider>,
  );
  view.rerender(
    <TenantBrandingProvider hostname="second.savia.app.hefesoft.com">
      <Name />
    </TenantBrandingProvider>,
  );
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  await act(async () =>
    resolveOld(new Response(JSON.stringify({ data: branding }))),
  );
  expect(screen.getByText("Sin marca")).toBeInTheDocument();
  expect(
    getComputedStyle(document.documentElement).getPropertyValue("--primary"),
  ).toBe("");
});
it("has a safe fallback outside a provider", () => {
  render(<Name />);
  expect(screen.getByText("Sin marca")).toBeInTheDocument();
});
it("removes applied colors immediately on host change and null branding", async () => {
  let resolveNext!: (value: Response) => void;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: branding })))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveNext = resolve;
        }),
    );
  vi.stubGlobal("fetch", fetcher);
  const view = render(
    <TenantBrandingProvider hostname="first.savia.app.hefesoft.com">
      <Name />
    </TenantBrandingProvider>,
  );
  await screen.findByText("Agencia Uno");
  expect(
    getComputedStyle(document.documentElement).getPropertyValue("--primary"),
  ).toBe("#125633");
  view.rerender(
    <TenantBrandingProvider hostname="second.savia.app.hefesoft.com">
      <Name />
    </TenantBrandingProvider>,
  );
  expect(screen.getByText("Sin marca")).toBeInTheDocument();
  expect(
    getComputedStyle(document.documentElement).getPropertyValue("--primary"),
  ).toBe("");
  await act(async () =>
    resolveNext(new Response(JSON.stringify({ data: null }))),
  );
  expect(
    getComputedStyle(document.documentElement).getPropertyValue("--primary"),
  ).toBe("");
});
it("ignores unsafe public image configuration without applying its colors", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { ...branding, logoUrl: "javascript:alert(1)" },
        }),
      ),
    ),
  );
  render(
    <TenantBrandingProvider>
      <Name />
    </TenantBrandingProvider>,
  );
  await act(async () => undefined);
  expect(screen.getByText("Sin marca")).toBeInTheDocument();
  expect(
    getComputedStyle(document.documentElement).getPropertyValue("--primary"),
  ).toBe("");
});

it("passes reload cache mode when refetch is called with reload option", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ data: branding })));
  vi.stubGlobal("fetch", fetcher);

  function RefetchButton() {
    const { refetch } = useTenantBranding();
    return (
      <button onClick={() => void refetch({ reload: true })}>Refetch</button>
    );
  }

  render(
    <TenantBrandingProvider>
      <RefetchButton />
    </TenantBrandingProvider>,
  );
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(fetcher.mock.calls[0][1].cache).toBe("default");

  await act(async () => {
    screen.getByRole("button", { name: "Refetch" }).click();
  });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(fetcher.mock.calls[1][1].cache).toBe("reload");
});

it.each([false, true])(
  "keeps personal colors across branding refreshes (palette present on load: %s)",
  async (savedPalette) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(
          async () => new Response(JSON.stringify({ data: branding })),
        ),
    );
    const palette = document.createElement("style");
    palette.textContent =
      ':root[data-color-theme="blue"] { --primary: blue; --accent: lightblue; }';
    document.head.append(palette);
    function Refresh() {
      const { refetch } = useTenantBranding();
      return <button onClick={() => void refetch()}>Refresh</button>;
    }
    try {
      if (savedPalette) document.documentElement.dataset.colorTheme = "blue";
      render(
        <TenantBrandingProvider>
          <Name />
          <Refresh />
        </TenantBrandingProvider>,
      );
      await screen.findByText("Agencia Uno");
      const root = document.documentElement;
      expect(getComputedStyle(root).getPropertyValue("--primary")).toBe(
        savedPalette ? "blue" : "#125633",
      );
      root.dataset.colorTheme = "blue";
      expect(getComputedStyle(root).getPropertyValue("--primary")).toBe("blue");
      expect(getComputedStyle(root).getPropertyValue("--accent")).toBe(
        "lightblue",
      );
      await act(async () =>
        screen.getByRole("button", { name: "Refresh" }).click(),
      );
      expect(getComputedStyle(root).getPropertyValue("--primary")).toBe("blue");
      delete root.dataset.colorTheme;
      expect(getComputedStyle(root).getPropertyValue("--primary")).toBe(
        "#125633",
      );
    } finally {
      palette.remove();
    }
  },
);
