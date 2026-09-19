import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/app";
import type { AppServices } from "@/app-services";

const tenant = {
  id: 101,
  name: "Comunidad",
  idSlug: "comunidad",
  isActive: true,
  agencyId: null,
  createdAt: "2026-09-09",
  updatedAt: "2026-09-09",
  kind: "commercial" as const,
};
const platformTenant = {
  id: 0,
  name: "Plataforma Savia",
  idSlug: "savia-platform",
  isActive: true,
  agencyId: null,
  createdAt: "2026-09-09",
  updatedAt: "2026-09-09",
  kind: "platform" as const,
};
function services() {
  return {
    authSession: {
      checkSession: vi.fn(),
      getPermissions: vi
        .fn()
        .mockResolvedValue({ memberships: [], canManageIdentity: true }),
      getIdentity: vi.fn(),
    },
    authProvider: {
      checkAuth: vi.fn().mockResolvedValue(undefined),
      checkError: vi.fn(),
      getIdentity: vi
        .fn()
        .mockResolvedValue({ id: "admin", fullName: "Admin" }),
      getPermissions: vi
        .fn()
        .mockResolvedValue({ memberships: [], canManageIdentity: true }),
      canAccess: vi.fn().mockResolvedValue(true),
      login: vi.fn(),
      logout: vi.fn(),
    },
    dataProvider: {
      getList: vi.fn().mockImplementation((resource) =>
        Promise.resolve({
          data: resource === "tenants" ? [tenant] : [],
          total: resource === "tenants" ? 1 : 0,
        }),
      ),
      getOne: vi.fn().mockResolvedValue({ data: tenant }),
      getMany: vi.fn().mockResolvedValue({ data: [] }),
      getManyReference: vi.fn(),
      create: vi
        .fn()
        .mockImplementation((_resource, params) =>
          Promise.resolve({ data: { ...tenant, ...params.data } }),
        ),
      update: vi
        .fn()
        .mockImplementation((_resource, params) =>
          Promise.resolve({ data: { ...tenant, ...params.data } }),
        ),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    domains: { list: vi.fn().mockResolvedValue([]) },
    commands: { execute: vi.fn() },
    assistantConfiguration: {
      summary: vi.fn().mockResolvedValue({ global: null, agencies: [] }),
      models: vi.fn().mockResolvedValue([]),
      activeAgency: vi.fn().mockResolvedValue({ agencies: [] }),
    },
  } as unknown as AppServices;
}
async function renderApp(appServices: AppServices) {
  // Flush the immediately resolved session and list-query effects before
  // starting an assertion timeout for the resulting page.
  await act(async () => {
    render(<App services={appServices} />);
  });
}
function open(path: string) {
  window.history.replaceState({}, "", "/");
  window.location.hash = `#${path}`;
}
beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const path = new URL(String(input), window.location.origin).pathname;
    if (path !== "/api/public/tenant-branding")
      throw new Error(`Unexpected tenant-page request: ${path}`);
    return new Response(JSON.stringify({ data: null }), {
      headers: { "content-type": "application/json" },
    });
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("generic tenant pages", () => {
  it("transfers an assigned user without offering membership removal", async () => {
    open("/users/principal-one");
    const appServices = services();
    const record = {
      id: "principal-one",
      displayName: "Persona Uno",
      firstName: "Persona",
      lastName: "Uno",
      email: "person@example.test",
      platformAdmin: false,
      isActive: true,
      isBanned: false,
      twoFactorEnabled: false,
      memberships: [
        {
          id: "membership-one",
          tenantId: 101,
          agencyId: 101,
          role: "tenant_admin",
          isActive: true,
        },
      ],
    };
    vi.mocked(appServices.dataProvider.getOne).mockResolvedValue({
      data: record,
    });
    vi.mocked(appServices.dataProvider.getList).mockResolvedValue({
      data: [tenant, { ...tenant, id: 102, name: "Destino" }],
      total: 2,
    });
    await renderApp(appServices);
    expect(await screen.findByText("Tenant #101")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Quitar" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Transferir usuario" }),
    ).toBeVisible();
  });

  it("lists a tenant without an agency profile", async () => {
    open("/tenants");
    const appServices = services();
    await renderApp(appServices);
    expect(await screen.findByText("Comunidad")).toBeVisible();
    expect(screen.getByRole("link", { name: "Nuevo tenant" })).toBeVisible();
  });

  it("opens the users list scoped to the selected tenant", async () => {
    open("/tenants");
    const user = userEvent.setup();
    await renderApp(services());

    await user.click(await screen.findByText("Comunidad"));

    await waitFor(() => {
      const [, query = ""] = window.location.hash.split("?");
      expect(window.location.hash).toContain("#/users");
      expect(new URLSearchParams(query).get("filter")).toBe('{"tenantId":101}');
    });
    expect(await screen.findByText("Usuarios del tenant #101")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Ver todos los usuarios" }),
    );
    await waitFor(() => {
      expect(
        screen.queryByText("Usuarios del tenant #101"),
      ).not.toBeInTheDocument();
    });
  });

  it("shows the internal tenant and opens its platform users", async () => {
    open("/tenants");
    const user = userEvent.setup();
    const appServices = services();
    vi.mocked(appServices.dataProvider.getList).mockImplementation((resource) =>
      Promise.resolve({
        data: resource === "tenants" ? [platformTenant] : [],
        total: resource === "tenants" ? 1 : 0,
      }),
    );
    await renderApp(appServices);

    expect(await screen.findByText("Interno")).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /editar/i }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByText("Plataforma Savia"));

    await waitFor(() => {
      const [, query = ""] = window.location.hash.split("?");
      expect(new URLSearchParams(query).get("filter")).toBe('{"tenantId":0}');
    });
    expect(await screen.findByText("Usuarios del tenant #0")).toBeVisible();
  });

  it("exposes the new-tenant action from the generic tenant list", async () => {
    open("/tenants");
    await renderApp(services());
    const action = await screen.findByRole("link", { name: "Nuevo tenant" });
    expect(action).toHaveAttribute("href", "#/tenants/create");
  });

  it("edits the tenant state and explains the effect on member access", async () => {
    open("/tenants/101");
    const appServices = services(),
      user = userEvent.setup();
    await renderApp(appServices);
    const name = await screen.findByDisplayValue("Comunidad");
    await user.clear(name);
    await user.type(name, "Comunidad renovada");
    expect(
      screen.getByText(
        "Desactivar el tenant suspende el acceso de sus miembros.",
      ),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Guardar/ }));
    await waitFor(() =>
      expect(appServices.dataProvider.update).toHaveBeenCalledWith(
        "tenants",
        expect.objectContaining({
          id: "101",
          data: expect.objectContaining({ name: "Comunidad renovada" }),
        }),
      ),
    );
  });
});
