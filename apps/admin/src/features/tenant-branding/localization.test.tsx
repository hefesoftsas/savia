import { AppLocaleProvider } from "@/i18n/app-locale-provider";
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
  const get = vi.fn().mockImplementation(async (path: string) =>
    path === "/v1/tenants"
      ? { data: [{ id: 1, name: "Acme Agency" }] }
      : {
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
        },
  );
  const services = {
    apiClient: { get, put: vi.fn() },
  } as unknown as AppServices;
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <Switcher />
        <TenantBrandingPage services={services} />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
  const input = await screen.findByLabelText("Display name");
  fireEvent.change(input, { target: { value: "Unsaved business name" } });
  fireEvent.click(screen.getByText("ES"));
  await waitFor(() =>
    expect(screen.getByLabelText("Nombre visible")).toHaveValue(
      "Unsaved business name",
    ),
  );
  fireEvent.click(screen.getByText("PT"));
  await waitFor(() =>
    expect(screen.getByLabelText("Nome de exibição")).toHaveValue(
      "Unsaved business name",
    ),
  );
  expect(
    screen.getByRole("button", { name: "Salvar alterações" }),
  ).toBeTruthy();
  expect(get).toHaveBeenCalledTimes(2);
});
