import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { AssignmentEditor } from "./assignment-editor";
import type {
  AccessControlClient,
  AccessRole,
} from "@/api/access-control-client";
it("saves multiple custom roles without editing the protected role", async () => {
  const replaceAssignments = vi.fn().mockResolvedValue({ revision: 3 });
  const client = {
    getMembers: async () => [
      { id: "u", displayName: "Ada", email: "ada@example.test" },
    ],
    getAssignments: async () => ({ revision: 2, roleIds: [] }),
    getEffective: async () => ({ grants: [] }),
    replaceAssignments,
  } as unknown as AccessControlClient;
  const roles = [
    { id: "a", label: "Reader", enabled: true, protected: false },
    { id: "b", label: "Editor", enabled: true, protected: false },
    { id: "builtin", label: "Protected", enabled: true, protected: true },
  ] as AccessRole[];
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AssignmentEditor
        scope="tenant:101"
        client={client}
        roles={roles}
        onSaved={() => {}}
      />
    </QueryClientProvider>,
  );
  await screen.findByRole("option", { name: "Ada — ada@example.test" });
  fireEvent.change(screen.getByLabelText("User"), { target: { value: "u" } });
  const reader = await screen.findByLabelText("Reader");
  await vi.waitFor(() => expect(reader).not.toBeDisabled());
  fireEvent.click(reader);
  fireEvent.click(screen.getByLabelText("Editor"));
  fireEvent.click(screen.getByRole("button", { name: "Save assignments" }));
  await screen.findByText("Roles saved.");
  expect(replaceAssignments).toHaveBeenCalledWith({
    scope: "tenant:101",
    principalId: "u",
    roleIds: ["a", "b"],
    expectedRevision: 2,
  });
  expect(screen.queryByLabelText("Protected")).toBeNull();
});
