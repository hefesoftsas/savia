import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const refetch = vi.fn();
const setTheme = vi.fn();
const setColorTheme = vi.fn();
let mockBranding: object | null = null;
vi.mock("@/components/admin/use-theme", () => ({
  useTheme: () => ({
    theme: "light",
    colorTheme: "emerald",
    setTheme,
    setColorTheme,
  }),
}));
vi.mock("@/features/tenant-branding/tenant-branding-provider", () => ({
  useTenantBranding: () => ({ branding: mockBranding }),
}));
let mockPermissions: {
  canManageIdentity: boolean;
  memberships: Array<{ role: string }>;
} = {
  canManageIdentity: false,
  memberships: [],
};

vi.mock("ra-core", () => ({
  Translate: ({ children }: { children: React.ReactNode }) => children,
  UserMenuContext: {
    Provider: ({ children }: { children: React.ReactNode }) => children,
  },
  useAuthProvider: () => ({}),
  usePermissions: () => ({ permissions: mockPermissions }),
  useGetIdentity: () => ({
    data: { avatar: "https://api.savia.test/v1/account/avatar?v=version" },
    refetch,
  }),
  useLogout: () => vi.fn(),
  useTranslate: () => (key: string, options?: any) => options?._ ?? key,
  useLocales: () => [],
  useLocaleState: () => ["es", vi.fn()],
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarMenuButton: ({
    children,
    ...props
  }: React.ComponentProps<"button">) => <button {...props}>{children}</button>,
  useSidebar: () => ({ isMobile: false }),
}));

const mockPromptInstall = vi.fn();
let mockIsInstallable = false;
let mockIsInstalled = false;

vi.mock("@/pwa", () => ({
  usePwaInstall: () => ({
    isInstallable: mockIsInstallable,
    isInstalled: mockIsInstalled,
    hasNativePrompt: true,
    platform: "chromium",
    isIOS: false,
    promptInstall: mockPromptInstall,
  }),
  PwaInstallButton: ({ onAction }: { onAction?: () => void }) => {
    if (mockIsInstalled) return null;
    return (
      <button
        type="button"
        onClick={() => {
          onAction?.();
          mockPromptInstall();
        }}
      >
        Instalar aplicación
      </button>
    );
  },
  PwaInstallDialog: () => null,
}));

import { UserMenu } from "./user-menu";

function renderMenu() {
  return render(
    <MemoryRouter>
      <UserMenu />
    </MemoryRouter>,
  );
}

describe("UserMenu", () => {
  beforeEach(() => {
    mockBranding = null;
    mockPermissions = { canManageIdentity: false, memberships: [] };
    mockIsInstallable = false;
    mockIsInstalled = false;
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });
  it("refreshes the identity when an account avatar changes", () => {
    renderMenu();

    fireEvent(window, new Event("savia:identity-changed"));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows install option when installable and triggers promptInstall on click", async () => {
    mockIsInstallable = true;
    mockIsInstalled = false;

    const { getByRole, findByText } = renderMenu();

    // Open dropdown
    const menuButton = getByRole("button", { name: /Abrir menú de cuenta/i });
    fireEvent.pointerDown(menuButton);
    fireEvent.click(menuButton);

    const installOption = await findByText("Instalar aplicación");
    expect(installOption).toBeInTheDocument();

    fireEvent.click(installOption);
    expect(mockPromptInstall).toHaveBeenCalledTimes(1);
  });

  it.each([
    { canManageIdentity: true, memberships: [] },
    { canManageIdentity: false, memberships: [{ role: "tenant_admin" }] },
    { canManageIdentity: false, memberships: [{ role: "agency_admin" }] },
  ])(
    "keeps tenant branding out of the personal menu for administrators: %j",
    async (permissions) => {
      mockPermissions = permissions;
      const { getByRole, queryByRole } = renderMenu();
      const trigger = getByRole("button", { name: /Abrir menú de cuenta/i });
      fireEvent.pointerDown(trigger);
      fireEvent.click(trigger);
      expect(
        queryByRole("menuitem", { name: "Identidad del tenant" }),
      ).not.toBeInTheDocument();
    },
  );
  it("links personal connections to the connections tab", async () => {
    const { getByRole, findByRole } = renderMenu();
    const trigger = getByRole("button", { name: /Abrir menú de cuenta/i });
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    expect(
      await findByRole("menuitem", { name: "Mis conexiones" }),
    ).toHaveAttribute("href", "/my-integrations?tab=connections");
  });

  it("changes personal appearance through the account submenu", async () => {
    const { getByRole, findByRole } = renderMenu();
    const trigger = getByRole("button", { name: /Abrir menú de cuenta/i });
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    fireEvent.click(
      await findByRole("menuitem", { name: "savia.appearance.title" }),
    );
    fireEvent.click(
      await findByRole("menuitemradio", { name: "savia.appearance.darkMode" }),
    );
    expect(setTheme).toHaveBeenCalledWith("dark");
  });

  it("changes the personal palette through the account submenu", async () => {
    const { getByRole, findByRole } = renderMenu();
    const trigger = getByRole("button", { name: /Abrir menú de cuenta/i });
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    fireEvent.click(
      await findByRole("menuitem", { name: "savia.appearance.title" }),
    );
    fireEvent.click(await findByRole("menuitemradio", { name: "Blue" }));
    expect(setColorTheme).toHaveBeenCalledWith("blue");
  });

  it("respects tenant branding by hiding personal palette choices", async () => {
    mockBranding = { name: "Tenant" };
    const { getByRole, findByRole, queryByRole } = renderMenu();
    const trigger = getByRole("button", { name: /Abrir menú de cuenta/i });
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    fireEvent.click(
      await findByRole("menuitem", { name: "savia.appearance.title" }),
    );
    expect(
      await findByRole("menuitemradio", { name: "savia.appearance.darkMode" }),
    ).toBeVisible();
    expect(
      queryByRole("menuitemradio", { name: "Blue" }),
    ).not.toBeInTheDocument();
  });
});
