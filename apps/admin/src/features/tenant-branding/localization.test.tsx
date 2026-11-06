import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import userEvent from "@testing-library/user-event";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StoreContextProvider, memoryStore, useSetLocale } from "ra-core";
import { afterEach, expect, it, vi } from "vitest";
import type { AppServices } from "@/app-services";
import { TenantBrandingPage } from "./tenant-branding-page";
function Switcher() {
  const setLocale = useSetLocale();
  return (
    <>
      <button onClick={() => setLocale("es")}>ES</button>
      <button onClick={() => setLocale("pt")}>PT</button>
    </>
  );
}
afterEach(cleanup);
it("switches branding labels through ES/EN/PT without translating or losing unsaved business content", async () => {
  const get = vi.fn().mockImplementation(async (path: string) => {
    if (path === "/v1/tenants")
      return { data: [{ id: 1, name: "Acme Agency" }] };
    if (path.endsWith("/api-keys/members")) return { members: [] };
    if (path.endsWith("/api-keys")) return { keys: [] };
    return {
      data: {
        displayName: "Acme Agency",
        loginTitle: "Welcome team",
        loginDescription: "Your workspace",
        primaryColor: "#125633",
        accentColor: "#d1e8d9",
        logoUrl: null,
        coverUrl: null,
        version: 1,
      },
      canManage: true,
    };
  });
  const services = {
    apiClient: { get, put: vi.fn(), post: vi.fn(), delete: vi.fn() },
  } as unknown as AppServices;
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <Switcher />
        <TenantBrandingPage services={services} />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
  const user = userEvent.setup();
  const input = await screen.findByLabelText("Display name");
  const baselineCalls = get.mock.calls.length;
  expect(baselineCalls).toBe(2);
  await user.click(screen.getByRole("tab", { name: "Login screen" }));
  expect(screen.getByLabelText("Repeat animation")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Find free animations on LottieFiles" }),
  ).toHaveAttribute("href", "https://lottiefiles.com/free-animations/dog");
  fireEvent.change(input, { target: { value: "Unsaved business name" } });
  fireEvent.click(screen.getByText("ES"));
  await waitFor(() =>
    expect(screen.getByLabelText("Título de acceso")).toHaveValue(
      "Welcome team",
    ),
  );
  expect(screen.getByLabelText("Repetir animación")).toBeTruthy();
  await user.click(screen.getByRole("tab", { name: "Identidad" }));
  expect(screen.getByLabelText("Nombre visible")).toHaveValue(
    "Unsaved business name",
  );
  await user.click(screen.getByRole("tab", { name: "Pantalla de acceso" }));
  fireEvent.click(screen.getByText("PT"));
  await waitFor(() =>
    expect(screen.getByLabelText("Título de acesso")).toHaveValue(
      "Welcome team",
    ),
  );
  expect(screen.getByLabelText("Repetir animação")).toBeTruthy();
  expect(
    screen.getByRole("link", {
      name: "Buscar animações gratuitas no LottieFiles",
    }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Salvar alterações" }),
  ).toBeTruthy();
  expect(get).toHaveBeenCalledTimes(baselineCalls);
});
