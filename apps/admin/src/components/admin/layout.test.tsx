import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { Layout } from "./layout";

vi.mock("ra-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ra-core")>();
  return {
    ...actual,
    useTranslate: () => (key: string) => {
      const labels: Record<string, string> = {
        "savia.layout.back": "Volver",
        "savia.layout.forward": "Adelante",
        "savia.layout.noPreviousScreen": "No hay una pantalla anterior",
        "savia.layout.noNextScreen": "No hay una pantalla siguiente",
        "savia.layout.toggleSidebar": "Mostrar u ocultar menú",
      };
      return labels[key] ?? key;
    },
  };
});

vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SidebarTrigger: ({ "aria-label": ariaLabel }: { "aria-label"?: string }) => (
    <button aria-label={ariaLabel} type="button" />
  ),
}));
vi.mock("@/components/admin/app-sidebar", () => ({
  AppSidebar: () => <aside>Navigation</aside>,
}));
vi.mock("@/components/admin/refresh-button", () => ({
  RefreshButton: () => <button type="button">Actualizar</button>,
}));
vi.mock("@/components/admin/locales-menu-button", () => ({
  LocalesMenuButton: () => null,
}));
vi.mock("@/components/admin/notification", () => ({
  Notification: () => null,
}));
vi.mock("@/components/admin/error", () => ({
  Error: () => <p>Error</p>,
}));
vi.mock("@/components/admin/loading", () => ({
  Loading: () => <p>Cargando</p>,
}));
vi.mock("@/features/assistant/assistant-bar", () => ({
  AssistantBar: () => null,
}));
vi.mock("@/features/savia-request/savia-request-provider", () => ({
  SaviaRequestProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

afterEach(cleanup);

function RouteControls() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          navigate(
            "/crm?domain=platform&object=customer_profiles&view=screen-relations",
          )
        }
      >
        Abrir relaciones
      </button>
      <output role="status">{location.pathname + location.search}</output>
    </>
  );
}

describe("admin layout", () => {
  it("shows a sidebar toggle alongside history navigation", () => {
    render(
      <MemoryRouter>
        <Layout>
          <p>Contenido</p>
        </Layout>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("button", { name: "Mostrar u ocultar menú" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Instalar|Install/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Volver" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Adelante" })).toBeDisabled();
  });

  it("keeps an app-level back control for in-app navigation", async () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/crm?domain=platform&object=customer_profiles&view=admin-screen",
        ]}
      >
        <Layout>
          <RouteControls />
        </Layout>
      </MemoryRouter>,
    );

    const back = screen.getByRole("button", { name: "Volver" });
    const forward = screen.getByRole("button", { name: "Adelante" });
    expect(back).toBeDisabled();
    expect(forward).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Abrir relaciones" }));
    await waitFor(() => expect(back).toBeEnabled());
    expect(forward).toBeDisabled();

    fireEvent.click(back);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "/crm?domain=platform&object=customer_profiles&view=admin-screen",
      ),
    );
    expect(forward).toBeEnabled();

    fireEvent.click(forward);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "/crm?domain=platform&object=customer_profiles&view=screen-relations",
      ),
    );
  });
});
