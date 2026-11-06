import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { AppServices } from "@/app-services";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppServicesProvider } from "@/features/assistant/assistant-context";
import { SaviaRequestProvider } from "./savia-request-provider";
import { SaviaRequestSidebar } from "./savia-request-sidebar";

vi.mock("ra-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ra-core")>()),
  useCanAccess: () => ({ canAccess: true, isPending: false }),
}));

const currentStatus = {
  id: "insurance-auto-light",
  currentVersion: "1.1.0",
  installedVersion: "1.1.0",
  updateAvailable: false,
  flows: [],
  summary: {
    current: 22,
    customized: 0,
    outdated: 0,
    hidden: 0,
    "not-installed": 0,
  },
};

function renderSidebar(status: typeof currentStatus) {
  const get = vi.fn(async (rawPath: string) => {
    const path = rawPath.split("?")[0];
    if (path.endsWith("/status")) return status;
    if (path.endsWith("/flows")) return [];
    if (path.endsWith("/folders")) return [];
    throw new Error(`Ruta inesperada: ${rawPath}`);
  });
  const post = vi.fn(async () => ({
    id: "insurance-auto-light",
    version: "1.1.0",
    updated: ["sura-autos-provider"],
    installed: [],
    skippedCustomized: ["sbs-producto-8"],
    hidden: [],
    variablesAdded: 0,
  }));
  const services = {
    apiClient: { get, post, put: vi.fn(), delete: vi.fn(), request: vi.fn() },
  } as unknown as AppServices;

  render(
    <SidebarProvider>
      <MemoryRouter initialEntries={["/savia-request"]}>
        <AppServicesProvider services={services}>
          <SaviaRequestProvider>
            <SaviaRequestSidebar />
          </SaviaRequestProvider>
        </AppServicesProvider>
      </MemoryRouter>
    </SidebarProvider>,
  );
  return { get, post };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SaviaRequestBundleRow", () => {
  it("shows the installed version without update controls when current", async () => {
    renderSidebar(currentStatus);

    expect(await screen.findByText("Seguros v1.1.0")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Actualizar paquete" }),
    ).not.toBeInTheDocument();
  });

  it("syncs outdated flows and reports skipped customizations", async () => {
    const user = userEvent.setup();
    const { post } = renderSidebar({ ...currentStatus, updateAvailable: true });

    expect(await screen.findByText("Seguros v1.1.0")).toBeVisible();
    await user.click(
      await screen.findByRole("button", { name: "Actualizar paquete" }),
    );

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        expect.stringContaining("/api/bundles/insurance-auto-light/sync"),
        {},
      ),
    );
    expect(
      await screen.findByText(
        "Paquete actualizado: 1 flow(s). 1 personalizado(s) omitidos: restablécelos para actualizarlos.",
      ),
    ).toBeVisible();
  });
});
