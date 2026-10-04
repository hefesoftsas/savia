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
import { PluginStudioPage, StudioPage } from "./studio-page";
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
vi.mock("@/features/studio-engine/plugin-project-workspace", () => ({
  default: ({ tenantId }: { tenantId: number }) => (
    <main aria-label="Your plugin projects">
      Plugin projects for tenant {tenantId}
    </main>
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
  id: "tenant:0",
  tenantId: 0,
  label: "Plataforma",
  kind: "platform",
  apiBasePath: "/v1/studio/0",
};
const tenant = {
  id: "tenant:101",
  tenantId: 101,
  label: "Norte",
  kind: "tenant",
  apiBasePath: "/v1/studio/101",
};
function servicesFor(tenants: unknown[]): AppServices {
  return {
    authSession: { getIdentity: async () => ({ id: "user-1" }) },
    apiClient: { get: vi.fn(async () => ({ data: tenants })) },
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
function mountPluginStudio(services: AppServices, route = "/plugin-studio") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <div id="header-actions" />
      <PluginStudioPage services={services} />
    </MemoryRouter>,
  );
}
describe("Studio tenant integration", () => {
  it("loads the dedicated plugin workspace under the selected authorized tenant", async () => {
    mountPluginStudio(
      servicesFor([platform, tenant]),
      "/plugin-studio?tenantId=101",
    );
    expect(await screen.findByLabelText("Your plugin projects")).toBeVisible();
    expect(getStudioRuntime().apiBasePath).toBe(tenant.apiBasePath);
    expect(getStudioRuntime().tenantId).toBe(101);
  });
  it("selects reserved platform tenant zero and uses its Studio route", async () => {
    mount(
      servicesFor([platform, tenant]),
      "/studio?tenantId=0&view=designer&object=agencias",
    );
    expect(await screen.findByText(/Espacio CRM/)).toHaveTextContent(
      "tenantId=0",
    );
    expect(getStudioRuntime().apiBasePath).toBe(platform.apiBasePath);
    expect(getStudioRuntime().tenantId).toBe(0);
    expect(screen.getByLabelText("Tenant")).toHaveValue("0");
  });

  it("selects the requested tenant and clears an old domain query parameter", async () => {
    mount(
      servicesFor([platform, tenant]),
      "/studio?tenantId=101&domain=old-domain&object=clientes",
    );
    expect(await screen.findByText(/Espacio CRM/)).toHaveTextContent(
      "tenantId=101",
    );
    expect(getStudioRuntime().apiBasePath).toBe(tenant.apiBasePath);
    expect(getStudioRuntime().tenantId).toBe(101);
    expect(
      screen.queryByRole("button", { name: /Crear dominio|Create domain/ }),
    ).toBeNull();
    expect(screen.queryByLabelText(/Dominio de datos|Data domain/)).toBeNull();
  });

  it("does not fall back to another tenant for an unauthorized tenant id", async () => {
    mount(servicesFor([tenant]), "/studio?tenantId=0");
    expect(
      (await screen.findAllByText(/Selecciona un tenant para administrar/))[0],
    ).toBeVisible();
    expect(screen.queryByText(/Espacio CRM/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Tenant")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Norte" }));
    expect(await screen.findByText(/Espacio CRM/)).toBeVisible();
    expect(getStudioRuntime().tenantId).toBe(101);
  });

  it("opens a single authorized tenant without requiring a query parameter", async () => {
    mount(servicesFor([tenant]));
    expect(await screen.findByText(/Espacio CRM/)).toBeVisible();
    expect(getStudioRuntime().tenantId).toBe(101);
    expect(screen.queryByLabelText("Tenant")).not.toBeInTheDocument();
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
      ...servicesFor([platform]),
      localData: {
        open: vi.fn(async () => ({ close, store: fakeStore })),
        cachedMetadata: vi.fn(async (_name: string, load: () => unknown) =>
          load(),
        ),
      },
    } as unknown as AppServices;
    const mounted = mount(services, "/studio?tenantId=0&view=records");
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
