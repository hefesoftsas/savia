import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider, useSidebar } from "./sidebar";

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/i18n/core", () => ({
  useMessages: () => (message: string) => message,
}));

afterEach(cleanup);

function SidebarState() {
  const { state } = useSidebar();
  return <output role="status">{state}</output>;
}

describe("sidebar controls", () => {
  it("does not render a resize handle or capture the shortcut without a sidebar", () => {
    render(
      <SidebarProvider controlsEnabled={false}>
        <SidebarState />
      </SidebarProvider>,
    );

    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(
      fireEvent.keyDown(window, { key: "b", ctrlKey: true, cancelable: true }),
    ).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("expanded");
  });

  it("restores the previous sidebar state and controls when enabled again", () => {
    const { rerender } = render(
      <SidebarProvider>
        <SidebarState />
      </SidebarProvider>,
    );

    expect(screen.getByRole("separator")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(screen.getByRole("status")).toHaveTextContent("collapsed");

    rerender(
      <SidebarProvider controlsEnabled={false}>
        <SidebarState />
      </SidebarProvider>,
    );
    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(screen.getByRole("status")).toHaveTextContent("collapsed");

    rerender(
      <SidebarProvider>
        <SidebarState />
      </SidebarProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("collapsed");
    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(screen.getByRole("status")).toHaveTextContent("expanded");
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });
});
