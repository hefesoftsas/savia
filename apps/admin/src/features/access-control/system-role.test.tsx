import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SystemRoleDetails } from "./system-role";
import { RoleEditor } from "./role-editor";
import type { VisibleAccessRole } from "./system-role";
afterEach(cleanup);
it("shows inherited authority and assigned users without editable permission controls", () => {
  const onSave = vi.fn();
  const onDelete = vi.fn();
  const role: VisibleAccessRole = {
    id: "builtin:tenant:0:platform_admin",
    scope: "tenant:0",
    name: "platform_admin",
    legacy_role: "platform_admin",
    label: "Platform administrator",
    description: "",
    enabled: true,
    protected: true,
    source: "system",
    assignedUsers: [
      { id: "admin", displayName: "Savia Admin", email: "admin@example.test" },
    ],
    grants: [],
  };
  render(
    <RoleEditor
      role={role}
      scope="tenant:0"
      revision={1}
      catalog={[]}
      onSave={onSave}
      onDelete={onDelete}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Platform administrator" }),
  ).toBeVisible();
  fireEvent.click(screen.getByText(/Assigned users/));
  expect(screen.getByText("admin@example.test")).toBeInTheDocument();
  expect(
    screen.getByText(/grants administration across the platform/),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "Save role" })).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(onSave).not.toHaveBeenCalled();
  expect(onDelete).not.toHaveBeenCalled();
});

it("groups resource permissions and expands or collapses all details", () => {
  const role: VisibleAccessRole = {
    id: "builtin:tenant:0:platform_admin",
    scope: "tenant:0",
    name: "platform_admin",
    legacy_role: "platform_admin",
    label: "Platform administrator",
    description: "",
    enabled: true,
    protected: true,
    grants: ["read", "update"].map((action, index) => ({
      id: String(index),
      roleId: "admin",
      resource: "collection:customers",
      action: action as "read" | "update",
      fields: ["name"],
      predicate: { all: true },
    })),
  };
  render(<SystemRoleDetails role={role} />);
  const detail = screen.getByText("customers").closest("details")!;
  expect(detail).not.toHaveAttribute("open");
  fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
  expect(detail).toHaveAttribute("open");
  expect(screen.getByText("Read")).toBeVisible();
  expect(screen.getByText("Update")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
  expect(detail).not.toHaveAttribute("open");
});
