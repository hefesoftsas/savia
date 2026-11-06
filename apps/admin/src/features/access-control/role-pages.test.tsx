import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { RolePages } from "./role-pages";

const accessClient = vi.hoisted(() => ({
  listRoles: vi.fn(),
  getCatalog: vi.fn(),
  saveRole: vi.fn(),
  deleteRole: vi.fn(),
}));
vi.mock("@/api/access-control-client", () => ({
  createAccessControlClient: () => accessClient,
}));
vi.mock("@/realtime/use-access-realtime", () => ({
  useAccessRealtime: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("keeps the same-scope role editor and draft mounted during a transient refresh error", async () => {
  accessClient.listRoles.mockResolvedValue({ roles: [], revision: 1 });
  accessClient.getCatalog.mockResolvedValue([]);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const services = {
    apiClient: {
      get: vi.fn().mockResolvedValue({
        data: [
          {
            id: "workspace-1",
            tenantId: 101,
            label: "Workspace",
            kind: "tenant",
          },
        ],
      }),
    },
    queryClient,
  };

  render(
    <QueryClientProvider client={queryClient}>
      <RolePages services={services as never} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Create role" }));
  fireEvent.change(screen.getByLabelText("Role name"), {
    target: { value: "reviewer" },
  });
  fireEvent.change(screen.getByLabelText("Display name"), {
    target: { value: "Reviewer draft" },
  });

  accessClient.listRoles.mockRejectedValueOnce(
    new Error("Temporary network failure"),
  );
  void queryClient.invalidateQueries({
    queryKey: ["access-control", "roles", "tenant:101"],
  });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Temporary network failure",
  );
  expect(screen.getByLabelText("Display name")).toHaveValue("Reviewer draft");
  await waitFor(() => expect(accessClient.listRoles).toHaveBeenCalledTimes(2));
});
