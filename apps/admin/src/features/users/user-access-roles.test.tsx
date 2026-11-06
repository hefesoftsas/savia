import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FormProvider, useForm } from "react-hook-form";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UserAccessRoles } from "./user-access-roles";
const get = vi.hoisted(() => vi.fn());
vi.mock("@/features/assistant/assistant-context", () => ({
  useAppServices: () => ({ apiClient: { get } }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function Harness() {
  const form = useForm({
    defaultValues: {
      tenantId: "3",
      platformAdmin: false,
      accessRoleIds: [] as string[],
    },
  });
  return (
    <FormProvider {...form}>
      <UserAccessRoles />
      <button onClick={() => form.setValue("tenantId", "4")}>
        Change tenant
      </button>
      <output data-testid="selected">
        {form.watch("accessRoleIds").join(",")}
      </output>
    </FormProvider>
  );
}
it("loads enabled custom roles for the tenant and clears selections when it changes", async () => {
  get.mockImplementation(async (path: string) => ({
    revision: 1,
    roles: decodeURIComponent(path).includes("tenant:3")
      ? [
          { id: "test", label: "Test", protected: false, enabled: true },
          {
            id: "disabled",
            label: "Disabled role",
            protected: false,
            enabled: false,
          },
          {
            id: "admin",
            label: "System admin",
            protected: true,
            enabled: true,
          },
        ]
      : [],
  }));
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Harness />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("checkbox", { name: "Test" }));
  expect(screen.getByTestId("selected")).toHaveTextContent("test");
  expect(screen.queryByText("Disabled role")).toBeNull();
  expect(screen.queryByText("System admin")).toBeNull();
  fireEvent.click(screen.getByText("Change tenant"));
  await waitFor(() =>
    expect(screen.getByTestId("selected")).toBeEmptyDOMElement(),
  );
  expect(await screen.findByText(/No enabled custom roles/)).toBeVisible();
  expect(get).toHaveBeenCalledWith("/v1/access-control/roles?scope=tenant%3A4");
});
