import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/app";
import type { AppServices } from "@/app-services";

const tenantAdminPermissions = {
  canReadDocuments: true,
  canExecuteCommands: false,
  canManageIdentity: false,
  memberships: [{ tenantId: 101, role: "tenant_admin" }],
};

function services() {
  const dataProvider = {
    getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    getOne: vi
      .fn()
      .mockResolvedValue({ data: { id: 101, name: "North workspace" } }),
    getMany: vi.fn().mockResolvedValue({ data: [] }),
    getManyReference: vi.fn(),
    create: vi.fn().mockResolvedValue({ data: { id: "new-user" } }),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  };
  return {
    authSession: {
      checkSession: vi.fn(),
      getPermissions: vi.fn().mockResolvedValue(tenantAdminPermissions),
      getIdentity: vi.fn(),
    },
    authProvider: {
      checkAuth: vi.fn().mockResolvedValue(undefined),
      checkError: vi.fn(),
      getIdentity: vi
        .fn()
        .mockResolvedValue({ id: "admin", fullName: "Admin" }),
      getPermissions: vi.fn().mockResolvedValue(tenantAdminPermissions),
      canAccess: vi.fn().mockResolvedValue(true),
      login: vi.fn(),
      logout: vi.fn(),
    },
    dataProvider,
    apiClient: {
      get: vi.fn().mockImplementation(async (path: string) => {
        if (path.includes("user-capacity")) {
          return {
            data: { tenantId: 101, maxActiveUsers: null, activeUsers: 1 },
          };
        }
        if (path.includes("access-control/roles")) return { roles: [] };
        throw new Error(`Unexpected API request: ${path}`);
      }),
    },
    domains: { list: vi.fn().mockResolvedValue([]) },
    commands: { execute: vi.fn() },
    assistantConfiguration: {
      summary: vi.fn().mockResolvedValue({ global: null, tenants: [] }),
      models: vi.fn().mockResolvedValue([]),
      activeTenant: vi.fn().mockResolvedValue({ tenants: [] }),
    },
  } as unknown as AppServices;
}

async function renderApp(appServices: AppServices) {
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
      throw new Error(`Unexpected user-page request: ${path}`);
    return new Response(JSON.stringify({ data: null }), {
      headers: { "content-type": "application/json" },
    });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("tenant-admin user pages", () => {
  it("creates users in the administrator's tenant without platform or tenant-transfer controls", async () => {
    open("/users/create");
    const appServices = services();
    await renderApp(appServices);

    expect(await screen.findByLabelText("Tenant")).toHaveValue(101);
    expect(screen.getByLabelText("Tenant")).toHaveAttribute("readonly");
    expect(screen.queryByLabelText("Administrador de plataforma")).toBeNull();
    expect(screen.queryByLabelText("Tenant comercial")).toBeNull();
    const identityFields = screen.getAllByRole("textbox");
    fireEvent.change(identityFields[0], {
      target: { value: "Ari" },
    });
    fireEvent.change(identityFields[1], {
      target: { value: "Rios" },
    });
    fireEvent.change(identityFields[2], {
      target: { value: "ari@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(appServices.dataProvider.create).toHaveBeenCalledWith(
        "users",
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 101,
            platformAdmin: false,
            agencyRole: "viewer",
          }),
        }),
      ),
    );
  });

  it.each(["North workspace", ""])(
    "uses the tenant name without exposing IDs when the name is %s",
    async (name) => {
      open("/users");
      const appServices = services();
      vi.mocked(appServices.dataProvider.getOne).mockResolvedValue({
        data: { id: 101, name },
      });
      vi.mocked(appServices.dataProvider.getList).mockImplementation(
        async (resource) =>
          resource === "users"
            ? {
                data: [
                  {
                    id: "user-1",
                    displayName: "Ari Rios",
                    email: "ari@example.test",
                    platformAdmin: false,
                    isActive: true,
                    twoFactorEnabled: false,
                    memberships: [
                      {
                        tenantId: 101,
                        agencyId: 101,
                        role: "viewer",
                        isActive: true,
                      },
                    ],
                  },
                ],
                total: 1,
              }
            : { data: [], total: 0 },
      );
      await renderApp(appServices);
      expect(await screen.findByText("ari@example.test")).toBeVisible();
      if (name) {
        expect(
          await screen.findByText("Usuarios de North workspace"),
        ).toBeVisible();
        expect(
          await screen.findByText("North workspace", { selector: "td span" }),
        ).toBeVisible();
      } else {
        expect(await screen.findByText("Usuarios del tenant")).toBeVisible();
      }
      expect(screen.queryByText(/#101/)).not.toBeInTheDocument();
    },
  );

  it("does not expose tenant selection from the tenant-admin user list", async () => {
    open("/users");
    const appServices = services();
    await renderApp(appServices);

    expect(
      await screen.findByText("Usuarios de North workspace"),
    ).toBeVisible();
    expect(screen.queryByLabelText("Tenant comercial")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Ver todos los usuarios" }),
    ).toBeNull();
    await waitFor(() =>
      expect(appServices.dataProvider.getList).toHaveBeenCalled(),
    );
  });
});
