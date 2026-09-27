import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "../studio-engine/test/locale-test-render";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { AppServices } from "@/app-services";
import { getStudioRuntime } from "@/features/studio-engine/runtime";
import { StudioPage } from "./studio-page";
const workspaceRendered = vi.hoisted(() => vi.fn());

vi.mock("ra-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ra-core")>()),
  useCanAccess: () => ({ canAccess: true, isPending: false }),
}));
vi.mock("@/features/studio-engine/app", () => ({
  default: ({ search }: { search?: string }) => {
    workspaceRendered(search, getStudioRuntime().apiBasePath);
    return <p>Espacio CRM {search}</p>;
  },
}));
vi.mock("@/features/studio-engine/business-panel", () => ({
  BusinessPanel: () => (
    <details>
      <summary>API del dominio</summary>
    </details>
  ),
}));
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  workspaceRendered.mockClear();
});

const platform = {
  id: "platform",
  label: "Plataforma",
  kind: "platform",
  apiBasePath: "/v1/data-domains/platform",
};
const agency = {
  id: "agency:101",
  agencyId: 101,
  label: "Norte",
  kind: "agency",
  apiBasePath: "/v1/dynamic-crm/101",
};
function servicesFor(domains: unknown[], admin = false): AppServices {
  return {
    authSession: {
      getPermissions: async () => ({
        canManageIdentity: admin,
        memberships: [],
      }),
    },
    apiClient: { get: vi.fn(async () => ({ data: domains })), post: vi.fn() },
  } as unknown as AppServices;
}
function mount(services: AppServices, route = "/studio") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <div id="header-actions" />
      <StudioPage services={services} />
    </MemoryRouter>,
  );
}
describe("Studio domain integration", () => {
  it("opens the platform designer without an agency", async () => {
    mount(
      servicesFor([platform], true),
      "/studio?domain=platform&view=designer&object=agencias",
    );
    expect(await screen.findByText(/Espacio CRM/)).toHaveTextContent(
      "domain=platform",
    );
    expect(getStudioRuntime().apiBasePath).toBe(platform.apiBasePath);
    expect(getStudioRuntime().businessSetupEnabled).toBe(false);
    expect(screen.getByText("Dominio activo: Plataforma")).toBeVisible();
  });
  it("separates tenant selection from advanced domains", async () => {
    mount(
      servicesFor([platform, agency], true),
      "/studio?domain=platform&view=admin",
    );
    await screen.findByText(/Espacio CRM/);
    expect(screen.getByLabelText("Tenant")).toHaveValue("");
    expect(screen.getByLabelText("Dominio de datos")).toHaveValue("platform");
    expect(
      screen.getByLabelText("Tenant").querySelector('option[value="platform"]'),
    ).toBeNull();
    expect(
      screen
        .getByLabelText("Dominio de datos")
        .querySelector('option[value="agency:101"]'),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Crear dominio" })).toBeVisible();
  });
  it("converts legacy agency links to a domain while preserving the requested tool", async () => {
    mount(
      servicesFor([agency]),
      "/studio?agencyId=101&object=clientes&view=designer",
    );
    expect(await screen.findByText(/Espacio CRM/)).toHaveTextContent(
      "domain=agency%3A101",
    );
    expect(screen.getByText(/Espacio CRM/)).toHaveTextContent("view=designer");
    expect(getStudioRuntime().apiBasePath).toBe(agency.apiBasePath);
    expect(
      screen.queryByRole("button", { name: "Crear dominio" }),
    ).not.toBeInTheDocument();
  });
  it("does not fall back to a different domain for an unauthorized URL", async () => {
    mount(servicesFor([agency]), "/studio?domain=platform");
    expect(
      (await screen.findAllByText(/Selecciona un tenant para administrar/))[0],
    ).toBeVisible();
    expect(screen.queryByText(/Espacio CRM/)).not.toBeInTheDocument();
  });
  it("clears the previous domain object when switching domains", async () => {
    mount(
      servicesFor([platform, agency], true),
      "/studio?domain=platform&view=admin",
    );
    await screen.findByText(/Espacio CRM/);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Tenant"), agency.id);
    expect(screen.getByText(/Espacio CRM/)).not.toHaveTextContent(
      "object=agencias",
    );
    expect(getStudioRuntime().apiBasePath).toBe(agency.apiBasePath);
  });
  it("creates a domain, reloads the catalog and opens its object designer", async () => {
    const custom = {
      id: "operaciones",
      label: "Operaciones",
      kind: "custom",
      apiBasePath: "/v1/data-domains/operaciones",
    };
    const services = servicesFor([platform], true);
    vi.mocked(services.apiClient.get)
      .mockResolvedValueOnce({ data: [platform] })
      .mockResolvedValue({ data: [platform, custom] });
    vi.mocked(services.apiClient.post).mockResolvedValue({ data: custom });
    mount(services);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", {
        name: "Administración avanzada",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Crear dominio" }));
    await user.type(screen.getByLabelText("Nombre del dominio"), "Operaciones");
    await user.type(screen.getByLabelText("Identificador"), "operaciones");
    await user.click(screen.getByRole("button", { name: "Guardar dominio" }));
    await waitFor(() =>
      expect(screen.getByText(/Espacio CRM/)).toHaveTextContent(
        "domain=operaciones",
      ),
    );
    expect(services.apiClient.post).toHaveBeenCalledWith("/v1/data-domains", {
      name: "operaciones",
      label: "Operaciones",
    });
    expect(getStudioRuntime().apiBasePath).toBe(custom.apiBasePath);
  });
  it("refreshes the domain selector when an agency is created in the platform designer", async () => {
    const services = servicesFor([platform], true);
    vi.mocked(services.apiClient.get)
      .mockResolvedValueOnce({ data: [platform] })
      .mockResolvedValue({ data: [platform, agency] });
    mount(services, "/studio?domain=platform&view=admin");
    await screen.findByText(/Espacio CRM/);
    expect(
      screen.queryByRole("option", { name: "Norte" }),
    ).not.toBeInTheDocument();
    window.dispatchEvent(new Event("savia-studio-domains-changed"));
    expect(await screen.findByRole("option", { name: "Norte" })).toBeVisible();
    expect(screen.getByLabelText("Dominio de datos")).toHaveValue("platform");
  });
  it("ignores repeated domain submits while creation is in flight", async () => {
    const services = servicesFor([platform], true);
    vi.mocked(services.apiClient.post).mockImplementation(
      () => new Promise(() => {}),
    );
    mount(services);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", {
        name: "Administración avanzada",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Crear dominio" }));
    await user.type(screen.getByLabelText("Nombre del dominio"), "Operaciones");
    await user.type(screen.getByLabelText("Identificador"), "operaciones");
    const form = screen
      .getByRole("button", { name: "Guardar dominio" })
      .closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(services.apiClient.post).toHaveBeenCalledTimes(1);
  });
  it("surfaces catalog errors", async () => {
    const services = servicesFor([]);
    vi.mocked(services.apiClient.get).mockRejectedValue(
      new Error("Sin conexión"),
    );
    mount(services);
    expect(await screen.findByRole("alert")).toHaveTextContent("Sin conexión");
  });
  it("closes the local workspace when leaving Studio", async () => {
    const close = vi.fn();
    const fakeStore = {
      status: vi.fn(async () => ({})),
      subscribe: vi.fn(() => () => undefined),
      db: {
        outbox: { toArray: vi.fn(async () => []) },
        syncState: { toArray: vi.fn(async () => []) },
        collections: { toArray: vi.fn(async () => []) },
        conflicts: { toArray: vi.fn(async () => []) },
      },
    };
    const services = {
      ...servicesFor([platform], true),
      authSession: {
        getPermissions: async () => ({
          canManageIdentity: true,
          memberships: [],
        }),
        getIdentity: async () => ({ id: "user-1" }),
      },
      localData: {
        open: vi.fn(async () => ({ close, store: fakeStore })),
        cachedMetadata: vi.fn(async (_name: string, load: () => unknown) =>
          load(),
        ),
      },
    } as unknown as AppServices;
    const mounted = mount(services, "/studio?domain=platform&view=records");
    await screen.findByText(/Espacio CRM/);
    expect(services.localData.open).toHaveBeenCalledWith(platform.apiBasePath);
    mounted.unmount();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("Studio Savia theme bridge", () => {
  it("does not keep a private olive brand palette in the imported Studio chrome", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(join(here, "../studio-engine/style.css"), "utf8");
    expect(css).not.toContain("#285841");
    expect(css).toContain("var(--primary)");
    expect(css).toContain("var(--foreground)");
  });
});
