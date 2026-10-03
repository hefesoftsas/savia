import { cleanup, render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ApiClient } from "@/api/api-client";
import {
  OfficeAvailabilityProvider,
  useOfficeAvailability,
} from "./office-availability";
afterEach(cleanup);
function Access() {
  const state = useOfficeAvailability();
  return (
    <div>
      {state.loading
        ? "Checking"
        : state.enabled
          ? "Office available"
          : "Office unavailable"}
    </div>
  );
}
it("fails closed and refreshes after an administrator disables office", async () => {
  let enabled = true;
  let fail = false;
  const client = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => null },
    fetcher: async () =>
      fail
        ? new Response(null, { status: 503 })
        : Response.json({ data: { enabled } }),
  });
  render(
    <OfficeAvailabilityProvider apiClient={client}>
      <Access />
    </OfficeAvailabilityProvider>,
  );
  expect(screen.getByText("Checking")).toBeVisible();
  await screen.findByText("Office available");
  enabled = false;
  act(() => window.dispatchEvent(new Event("savia:office-settings-changed")));
  await screen.findByText("Office unavailable");
  enabled = true;
  act(() => window.dispatchEvent(new Event("focus")));
  await screen.findByText("Office available");
  fail = true;
  act(() => window.dispatchEvent(new Event("focus")));
  await screen.findByText("Office unavailable");
});
it("never carries enabled state or a late response into a different tenant", async () => {
  let pending: ((response: Response) => void) | undefined;
  const paths: string[] = [];
  const client = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => null },
    fetcher: async (input) => {
      paths.push(String(input));
      if (String(input).includes("/101/"))
        return new Promise((resolve) => {
          pending = resolve;
        });
      return Response.json({ data: { enabled: false } });
    },
  });
  const { rerender } = render(
    <OfficeAvailabilityProvider apiClient={client} tenantId={101}>
      <Access />
    </OfficeAvailabilityProvider>,
  );
  await waitFor(() => expect(pending).toBeDefined());
  rerender(
    <OfficeAvailabilityProvider apiClient={client} tenantId={102}>
      <Access />
    </OfficeAvailabilityProvider>,
  );
  expect(screen.queryByText("Office available")).not.toBeInTheDocument();
  await screen.findByText("Office unavailable");
  await act(async () => pending!(Response.json({ data: { enabled: true } })));
  expect(screen.getByText("Office unavailable")).toBeVisible();
  expect(paths).toEqual([
    "https://savia.test/v1/tenants/101/office-settings",
    "https://savia.test/v1/tenants/102/office-settings",
  ]);
});
