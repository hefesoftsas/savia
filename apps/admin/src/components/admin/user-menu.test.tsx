import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const refetch = vi.fn();

vi.mock("ra-core", () => ({
  Translate: ({ children }: { children: React.ReactNode }) => children,
  UserMenuContext: {
    Provider: ({ children }: { children: React.ReactNode }) => children,
  },
  useAuthProvider: () => ({}),
  useGetIdentity: () => ({
    data: { avatar: "https://api.savia.test/v1/account/avatar?v=version" },
    refetch,
  }),
  useLogout: () => vi.fn(),
  useTranslate: () => (key: string, options?: any) => options?._ ?? key,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarMenuButton: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
  useSidebar: () => ({ isMobile: false }),
}));

import { UserMenu } from "./user-menu";

describe("UserMenu", () => {
  it("refreshes the identity when an account avatar changes", () => {
    render(<UserMenu />);

    fireEvent(window, new Event("savia:identity-changed"));

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
