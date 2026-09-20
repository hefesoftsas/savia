import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { AppServices } from "@/app-services";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppServicesProvider } from "@/features/assistant/assistant-context";
import { SaviaRequestProvider } from "./savia-request-provider";
import { SaviaRequestSidebar } from "./savia-request-sidebar";
import type { RequestFlow } from "./types";

vi.mock("ra-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ra-core")>()),
  useCanAccess: () => ({ canAccess: true, isPending: false }),
}));

const autos: RequestFlow = {
  id: "autos",
  name: "Autos",
  folderPath: "Cotizaciones/Autos",
  description: "Cotiza autos.",
  input: {},
  variables: [],
  versions: [],
  steps: [
    {
      id: "cotizar",
      name: "Cotizar auto",
      url: "https://provider.test/autos",
      method: "POST",
      headers: {},
      body: "{}",
      pre: "",
      post: "",
    },
  ],
};

const hogar: RequestFlow = {
  ...autos,
  id: "hogar",
  name: "Hogar",
  folderPath: "Cotizaciones/Propiedades",
  steps: [{ ...autos.steps[0], id: "cotizar-hogar", name: "Cotizar hogar" }],
};

function Selection() {
  const location = useLocation();
  return <output data-testid="selection">{location.search}</output>;
}

function renderSidebar({
  initialFlows = [autos, hogar],
  initialFolders = [
    "Cotizaciones",
    "Cotizaciones/Autos",
    "Cotizaciones/Propiedades",
  ],
}: {
  initialFlows?: RequestFlow[];
  initialFolders?: string[];
} = {}) {
  let flows = [...initialFlows];
  let folders = [...initialFolders];
  const get = vi.fn(async (path: string) => {
    if (path.endsWith("/flows")) {
      return flows.map(({ id, name, folderPath, steps }) => ({
        id,
        name,
        folderPath,
        steps,
      }));
    }
    if (path.endsWith("/folders")) {
      return folders;
    }
    if (path.endsWith("/flows/autos")) return autos;
    if (path.endsWith("/flows/hogar")) return hogar;
    throw new Error(`Ruta inesperada: ${path}`);
  });
  const post = vi.fn(async (_path: string, body: { path: string }) => {
    folders = [...folders, body.path];
    return { path: body.path };
  });
  const request = vi.fn(async (_path: string, options: { body?: string }) => {
    const { path } = JSON.parse(options.body ?? "{}") as { path: string };
    folders = folders.filter(
      (candidate) => candidate !== path && !candidate.startsWith(`${path}/`),
    );
    return { ok: true };
  });
  render(
    <SidebarProvider>
      <MemoryRouter initialEntries={["/savia-request?flow=autos&step=0"]}>
        <AppServicesProvider
          services={
            {
              apiClient: { get, post, put: vi.fn(), request },
            } as unknown as AppServices
          }
        >
          <SaviaRequestProvider>
            <SaviaRequestSidebar />
            <Selection />
          </SaviaRequestProvider>
        </AppServicesProvider>
      </MemoryRouter>
    </SidebarProvider>,
  );
  return { post, request };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SaviaRequestSidebar", () => {
  it("filters the contextual tree and updates the shared flow selection", async () => {
    const user = userEvent.setup();
    renderSidebar();

    expect(
      await screen.findByRole("navigation", { name: "Flows de Savia Request" }),
    ).toBeVisible();
    await user.type(
      screen.getByRole("searchbox", { name: "Buscar flows" }),
      "hog",
    );
    expect(
      screen.queryByRole("button", { name: "Autos" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hogar" }));

    expect(await screen.findByTestId("selection")).toHaveTextContent(
      "?flow=hogar&step=0",
    );
  });

  it("keeps folder expansion out of browser storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const user = userEvent.setup();
    renderSidebar();

    await screen.findByRole("button", { name: "Cotizaciones" });
    await user.click(screen.getByRole("button", { name: "Cotizaciones" }));

    expect(setItem).not.toHaveBeenCalled();
  });

  it("creates a folder from the contextual tree", async () => {
    const user = userEvent.setup();
    const { post } = renderSidebar();

    await user.click(
      await screen.findByRole("button", { name: "Crear carpeta" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Ruta de la carpeta" }),
      "Cotizaciones/Nuevos",
    );
    await user.click(screen.getByRole("button", { name: "Crear" }));

    expect(post).toHaveBeenCalledWith("/v1/savia-request/api/folders", {
      path: "Cotizaciones/Nuevos",
    });
    expect(await screen.findByRole("button", { name: "Nuevos" })).toBeVisible();
  });

  it("shows folders created by the API even when they have no flows", async () => {
    renderSidebar({ initialFlows: [], initialFolders: ["Vacías"] });

    expect(await screen.findByRole("button", { name: "Vacías" })).toBeVisible();
  });

  it("deletes an empty folder after confirmation", async () => {
    const user = userEvent.setup();
    const { request } = renderSidebar({
      initialFlows: [],
      initialFolders: ["Vacías"],
    });

    await screen.findByRole("button", { name: "Vacías" });
    await user.click(
      screen.getByRole("button", { name: "Eliminar carpeta Vacías" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Eliminar" }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("/v1/savia-request/api/folders", {
        method: "DELETE",
        body: JSON.stringify({ path: "Vacías" }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(
      screen.queryByRole("button", { name: "Vacías" }),
    ).not.toBeInTheDocument();
  });
});
