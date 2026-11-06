import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "@/api/api-client";
import { OfficeSharePanel } from "./office-share-panel";

afterEach(cleanup);
const alice = {
  principalId: "alice",
  displayName: "Alice",
  email: "alice@example.test",
};
const bob = {
  principalId: "bob",
  displayName: "Bob",
  email: "bob@example.test",
};
function setup(
  options: { failLoad?: boolean; conflict?: boolean; existing?: boolean } = {},
) {
  let shares = options.existing ? [{ ...bob, role: "editor" }] : [];
  let version = 1;
  const writes: unknown[] = [];
  const onDone = vi.fn();
  const apiClient = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => null },
    fetcher: async (url, init) => {
      const request = new URL(String(url));
      if (init?.method === "PUT") {
        const body = JSON.parse(init.body as string);
        writes.push(body);
        if (options.conflict)
          return Response.json(
            { error: { code: "VERSION_CONFLICT", message: "Shares changed" } },
            { status: 409 },
          );
        shares = body.shares;
        version++;
        return Response.json({ data: { version, shares } });
      }
      if (options.failLoad)
        return Response.json(
          { error: { code: "FAILED", message: "Unavailable" } },
          { status: 503 },
        );
      if (request.pathname.endsWith("/members"))
        return Response.json({ data: [alice] });
      return Response.json({ data: { version, shares } });
    },
  });
  render(
    <OfficeSharePanel
      apiClient={apiClient}
      documentId="doc-1"
      onDone={onDone}
    />,
  );
  return { options, writes, onDone };
}
it("grants reading, preserves existing grants outside search results and can revoke them", async () => {
  const view = setup({ existing: true });
  fireEvent.change(
    await screen.findByRole("combobox", { name: "Permission for Alice" }),
    { target: { value: "reader" } },
  );
  expect(
    screen.getByRole("combobox", { name: "Permission for Bob" }),
  ).toHaveValue("editor");
  fireEvent.click(screen.getByRole("button", { name: "Save permissions" }));
  await waitFor(() => expect(view.onDone).toHaveBeenCalled());
  expect(view.writes[0]).toEqual({
    version: 1,
    shares: [
      { principalId: "bob", role: "editor" },
      { principalId: "alice", role: "reader" },
    ],
  });
});
it("can remove an existing grant", async () => {
  const view = setup({ existing: true });
  fireEvent.change(
    await screen.findByRole("combobox", { name: "Permission for Bob" }),
    { target: { value: "none" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Save permissions" }));
  await waitFor(() => expect(view.onDone).toHaveBeenCalled());
  expect(view.writes[0]).toEqual({ version: 1, shares: [] });
});
it("requires reload after a conflict and does not overwrite other changes", async () => {
  const view = setup({ conflict: true });
  fireEvent.change(
    await screen.findByRole("combobox", { name: "Permission for Alice" }),
    { target: { value: "editor" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Save permissions" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Permissions changed. Reload them before saving again.",
  );
  expect(view.onDone).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Save permissions" }),
  ).toBeDisabled();
  view.options.conflict = false;
  fireEvent.click(screen.getByRole("button", { name: "Reload permissions" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Save permissions" }),
    ).toBeEnabled(),
  );
  expect(
    screen.getByRole("combobox", { name: "Permission for Alice" }),
  ).toHaveValue("none");
});
it("keeps saving disabled when sharing cannot load and provides retry", async () => {
  const view = setup({ failLoad: true });
  await screen.findByRole("alert");
  expect(
    screen.getByRole("button", { name: "Save permissions" }),
  ).toBeDisabled();
  view.options.failLoad = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("combobox", { name: "Permission for Alice" });
  expect(
    screen.getByRole("button", { name: "Save permissions" }),
  ).toBeEnabled();
});

it("preserves unsaved permissions when retrying a failed member search", async () => {
  const view = setup();
  fireEvent.change(
    await screen.findByRole("combobox", { name: "Permission for Alice" }),
    { target: { value: "reader" } },
  );
  view.options.failLoad = true;
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search workspace members" }),
    { target: { value: "search" } },
  );
  await screen.findByRole("alert");
  view.options.failLoad = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
  expect(
    screen.getByRole("combobox", { name: "Permission for Alice" }),
  ).toHaveValue("reader");
});
