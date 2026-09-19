import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const refetch = vi.fn();
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
    "links authorized administrators to tenant branding: %j",
    async (permissions) => {
      mockPermissions = permissions;
      const { getByRole, findByRole } = renderMenu();
      const trigger = getByRole("button", { name: /Abrir menú de cuenta/i });
      fireEvent.pointerDown(trigger);
      fireEvent.click(trigger);
      expect(
        await findByRole("menuitem", { name: "Identidad del tenant" }),
      ).toHaveAttribute("href", "/tenant-branding");
    },
  );
});
