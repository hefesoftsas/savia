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
});
it("loads only public host branding and restores its variables on unmount", async () => {
  document.documentElement.style.setProperty("--primary", "original");
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
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
      "#125633",
    ),
  );
  expect(document.documentElement.style.getPropertyValue("--background")).toBe(
    "untouched",
  );
  expect(fetcher.mock.calls[0][0]).toContain("/api/public/tenant-branding");
  expect(fetcher.mock.calls[0][1].credentials).toBe("omit");
  view.unmount();
  expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
    "original",
  );
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
  expect(document.documentElement.style.getPropertyValue("--primary")).toBe("");
});
it("has a safe fallback outside a provider", () => {
  render(<Name />);
  expect(screen.getByText("Sin marca")).toBeInTheDocument();
});
it("removes applied colors immediately on host change and null branding", async () => {
  document.documentElement.style.setProperty("--primary", "original");
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
  expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
    "#125633",
  );
  view.rerender(
    <TenantBrandingProvider hostname="second.savia.app.hefesoft.com">
      <Name />
    </TenantBrandingProvider>,
  );
  expect(screen.getByText("Sin marca")).toBeInTheDocument();
  expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
    "original",
  );
  await act(async () =>
    resolveNext(new Response(JSON.stringify({ data: null }))),
  );
  expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
    "original",
  );
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
  expect(document.documentElement.style.getPropertyValue("--primary")).toBe("");
});
