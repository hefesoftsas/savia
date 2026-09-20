import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StoreContextProvider, memoryStore, useSetLocale } from "ra-core";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { AppServices } from "@/app-services";
import { PersonalIntegrationsPage } from "./personal-integrations-page";

function Switcher() {
  const setLocale = useSetLocale();
  return (
    <>
      <button onClick={() => setLocale("es")}>ES</button>
      <button onClick={() => setLocale("en")}>EN</button>
      <button onClick={() => setLocale("pt")}>PT</button>
    </>
  );
}

function createServices() {
  return {
    personalIntegrations: {
      listProviders: vi.fn().mockResolvedValue([]),
      listConnections: vi.fn().mockResolvedValue([]),
      createConnectSession: vi.fn(),
      complete: vi.fn(),
      disconnect: vi.fn(),
    },
    dataProvider: { getList: vi.fn().mockResolvedValue({ data: [] }) },
    authProvider: { canAccess: vi.fn().mockResolvedValue(true) },
    crm: {
      listProviders: vi.fn().mockResolvedValue([]),
      listConnections: vi.fn().mockResolvedValue([]),
      complete: vi.fn(),
      disconnect: vi.fn(),
    },
    virtualEmployees: {
      list: vi.fn().mockResolvedValue([]),
      listCollections: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      uploadFile: vi.fn(),
      deleteFile: vi.fn(),
    },
    assistantConfiguration: { models: vi.fn().mockResolvedValue([]) },
  } as unknown as Pick<
    AppServices,
    | "personalIntegrations"
    | "dataProvider"
    | "authProvider"
    | "crm"
    | "virtualEmployees"
    | "assistantConfiguration"
  >;
}

afterEach(cleanup);

it("switches integrations and virtual employees copy through EN/ES/PT", async () => {
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <MemoryRouter initialEntries={["/my-integrations?tab=virtual-employees"]}>
          <Switcher />
          <PersonalIntegrationsPage services={createServices()} />
        </MemoryRouter>
      </AppLocaleProvider>
    </StoreContextProvider>,
  );

  expect(
    await screen.findByRole("heading", { name: "Integrations" }),
  ).toBeVisible();
  expect(
    screen.getByRole("tab", { name: "Virtual Employees (AI)" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "New Employee" }),
  ).toBeVisible();

  fireEvent.click(screen.getByText("ES"));
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "Integraciones" }),
    ).toBeVisible(),
  );
  expect(
    screen.getByRole("tab", { name: "Empleados Virtuales (IA)" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Nuevo Empleado" }),
  ).toBeVisible();
  expect(
    screen.getByPlaceholderText("Buscar empleado por nombre o @handle..."),
  ).toBeVisible();

  fireEvent.click(screen.getByText("PT"));
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "Integrações" })).toBeVisible(),
  );
  expect(
    screen.getByRole("tab", { name: "Funcionários Virtuais (IA)" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Novo Funcionário" }),
  ).toBeVisible();
});
