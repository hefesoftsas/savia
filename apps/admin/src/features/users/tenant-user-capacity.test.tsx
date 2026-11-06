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

function renderCapacity(platformCanEdit: boolean, tenantId = 101) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <TenantUserCapacity
          tenantId={tenantId}
          platformCanEdit={platformCanEdit}
        />
      </QueryClientProvider>,
    ),
  };
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

it("keeps loaded capacity and the editor visible when a background read fails", async () => {
  get.mockResolvedValueOnce({
    data: { tenantId: 101, maxActiveUsers: 25, activeUsers: 8 },
  });
  const { queryClient } = renderCapacity(true);

  const input = await screen.findByLabelText("Maximum active users");
  fireEvent.change(input, { target: { value: "30" } });
  get.mockRejectedValueOnce(new Error("Network unavailable"));

  await queryClient.invalidateQueries({
    queryKey: ["tenant-user-capacity", 101],
  });
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));

  expect(screen.getByText("8 / 25 active users")).toBeVisible();
  expect(screen.getByLabelText("Maximum active users")).toBe(input);
  expect(input).toHaveValue(30);
  expect(screen.getByText(/Refresh failed:/)).toBeVisible();
});

it("does not replace an edited cap with a successful background read", async () => {
  get.mockResolvedValueOnce({
    data: { tenantId: 101, maxActiveUsers: 25, activeUsers: 8 },
  });
  const { queryClient } = renderCapacity(true);

  const input = await screen.findByLabelText("Maximum active users");
  fireEvent.change(input, { target: { value: "30" } });
  get.mockResolvedValueOnce({
    data: { tenantId: 101, maxActiveUsers: 40, activeUsers: 9 },
  });

  await queryClient.invalidateQueries({
    queryKey: ["tenant-user-capacity", 101],
  });
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));

  expect(screen.getByText("9 / 40 active users")).toBeVisible();
  expect(screen.getByLabelText("Maximum active users")).toBe(input);
  expect(input).toHaveValue(30);
});

it("does not carry a capacity draft into a different tenant scope", async () => {
  get.mockResolvedValueOnce({
    data: { tenantId: 101, maxActiveUsers: 25, activeUsers: 8 },
  });
  const { queryClient, rerender } = renderCapacity(true);
  const input = await screen.findByLabelText("Maximum active users");
  fireEvent.change(input, { target: { value: "30" } });
  get.mockResolvedValueOnce({
    data: { tenantId: 202, maxActiveUsers: 90, activeUsers: 4 },
  });

  rerender(
    <QueryClientProvider client={queryClient}>
      <TenantUserCapacity tenantId={202} platformCanEdit />
    </QueryClientProvider>,
  );

  expect(screen.queryByDisplayValue("30")).toBeNull();
  expect(await screen.findByLabelText("Maximum active users")).toHaveValue(90);
});

it.each([401, 403])(
  "hides retained capacity after a %i response",
  async (status) => {
    get.mockResolvedValueOnce({
      data: { tenantId: 101, maxActiveUsers: 25, activeUsers: 8 },
    });
    const { queryClient } = renderCapacity(true);
    expect(await screen.findByText("8 / 25 active users")).toBeVisible();
    get.mockRejectedValueOnce(
      Object.assign(new Error("Access revoked"), { status }),
    );

    await queryClient.invalidateQueries({
      queryKey: ["tenant-user-capacity", 101],
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));

    expect(screen.queryByText("8 / 25 active users")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Maximum active users"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
  },
);
