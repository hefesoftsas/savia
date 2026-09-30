import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { TenantUserCapacity } from "./tenant-user-capacity";

const get = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
vi.mock("@/features/assistant/assistant-context", () => ({
  useAppServices: () => ({ apiClient: { get, put } }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderCapacity(platformCanEdit: boolean) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TenantUserCapacity tenantId={101} platformCanEdit={platformCanEdit} />
    </QueryClientProvider>,
  );
}

it("shows the active-user count and cap to tenant administrators", async () => {
  get.mockResolvedValue({
    data: { tenantId: 101, maxActiveUsers: 25, activeUsers: 8 },
  });
  renderCapacity(false);

  expect(await screen.findByText("8 / 25 active users")).toBeVisible();
  expect(screen.queryByLabelText("Maximum active users")).toBeNull();
});

it("lets platform administrators save an unlimited cap", async () => {
  get.mockResolvedValue({
    data: { tenantId: 101, maxActiveUsers: 25, activeUsers: 8 },
  });
  put.mockResolvedValue({
    data: { tenantId: 101, maxActiveUsers: null, activeUsers: 8 },
  });
  renderCapacity(true);

  const input = await screen.findByLabelText("Maximum active users");
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save limit" }));

  await waitFor(() =>
    expect(put).toHaveBeenCalledWith("/v1/tenants/101/user-capacity", {
      maxActiveUsers: null,
    }),
  );
});
