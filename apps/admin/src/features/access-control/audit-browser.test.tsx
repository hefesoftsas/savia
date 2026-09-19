import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import AuditBrowser from "./audit-browser";

const entry = {
  id: "event-1",
  scope: "tenant:101",
  actor: { id: "actor-1", displayName: "Ada" },
  action: "role.saved",
  targetId: "reviewer",
  createdAt: "2026-09-19T12:00:00.000Z",
};
const makeClient = () => ({
  listAudit: vi.fn().mockResolvedValue({ data: [entry], nextCursor: null }),
  getAudit: vi.fn().mockResolvedValue({
    ...entry,
    before: { label: "Old label" },
    after: { label: "New label" },
  }),
});
function mount(client = makeClient(), scope = "tenant:101") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const ui = (value: string) => (
    <QueryClientProvider client={queryClient}>
      <AuditBrowser scope={value} client={client} />
    </QueryClientProvider>
  );
  const view = render(ui(scope));
  return {
    ...view,
    client,
    queryClient,
    changeScope: (next: string) => view.rerender(ui(next)),
  };
}
afterEach(cleanup);
it("loads only summaries until the user selects an event, then compares captured values", async () => {
  const { client } = mount();
  expect(await screen.findByText("Ada")).toBeInTheDocument();
  expect(client.getAudit).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "View changes to reviewer" }),
  );
  expect(await screen.findByText("Old label")).toBeInTheDocument();
  expect(screen.getByText("New label")).toBeInTheDocument();
  expect(client.getAudit).toHaveBeenCalledWith("tenant:101", "event-1");
  fireEvent.click(screen.getByRole("button", { name: "Close details" }));
  expect(screen.queryByText("Old label")).not.toBeInTheDocument();
});
it("pages by cursor and resets pagination and detail selection when filters change", async () => {
  const client = makeClient();
  client.listAudit.mockResolvedValue({ data: [entry], nextCursor: "next" });
  mount(client);
  await screen.findByText("Ada");
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await waitFor(() =>
    expect(client.listAudit).toHaveBeenLastCalledWith(
      "tenant:101",
      expect.objectContaining({ cursor: "next", limit: 25 }),
    ),
  );
  fireEvent.change(screen.getByLabelText("Action"), {
    target: { value: "assignments.saved" },
  });
  fireEvent.change(screen.getByLabelText("Actor ID"), {
    target: { value: " actor-2 " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  await waitFor(() =>
    expect(client.listAudit).toHaveBeenLastCalledWith("tenant:101", {
      limit: 25,
      action: "assignments.saved",
      actorId: "actor-2",
    }),
  );
  expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
});
it("does not display cached summaries or snapshots after an authorization failure", async () => {
  const { client } = mount();
  await screen.findByText("Ada");
  fireEvent.click(
    screen.getByRole("button", { name: "View changes to reviewer" }),
  );
  await screen.findByText("Old label");
  client.listAudit.mockRejectedValue(new Error("Access denied"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh history" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Access denied");
  expect(screen.queryByText("Ada")).not.toBeInTheDocument();
  expect(screen.queryByText("Old label")).not.toBeInTheDocument();
  client.listAudit.mockResolvedValue({ data: [], nextCursor: null });
  fireEvent.click(screen.getByRole("button", { name: "Retry history" }));
  expect(
    await screen.findByText("No permission changes match these filters."),
  ).toBeInTheDocument();
});
it("clears old scope data while the new scope loads", async () => {
  const { client, changeScope } = mount();
  await screen.findByText("Ada");
  client.listAudit.mockImplementation(() => new Promise(() => {}));
  changeScope("tenant:202");
  expect(screen.queryByText("Ada")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Loading history");
  expect(client.getAudit).not.toHaveBeenCalled();
});
it("rejects reversed date filters before requesting history", async () => {
  const { client } = mount();
  await screen.findByText("Ada");
  fireEvent.change(screen.getByLabelText("From"), {
    target: { value: "2026-09-20T12:00" },
  });
  fireEvent.change(screen.getByLabelText("To"), {
    target: { value: "2026-09-19T12:00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Start must be before end",
  );
  expect(client.listAudit).toHaveBeenCalledTimes(1);
});

it("hides the entire audit surface when a detail request detects revoked access", async () => {
  const client = makeClient();
  client.getAudit.mockRejectedValue(
    Object.assign(new Error("Permissions revoked"), { status: 403 }),
  );
  mount(client);
  await screen.findByText("Ada");
  fireEvent.click(
    screen.getByRole("button", { name: "View changes to reviewer" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Permissions revoked",
  );
  expect(screen.queryByText("Ada")).not.toBeInTheDocument();
});
