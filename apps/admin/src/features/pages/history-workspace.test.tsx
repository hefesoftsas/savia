import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HistoryWorkspace } from "./history-workspace";
import { PagesClient, type PageDocument } from "./client";
import { ApiClient } from "@/api/api-client";
vi.mock("./editor", () => ({
  PageEditor: ({ initialValue, readOnly }: any) => (
    <div data-testid="revision-content" data-readonly={readOnly}>
      {initialValue[0]?.children[0]?.text}
    </div>
  ),
}));
afterEach(cleanup);
const doc = {
  id: "one",
  version: 3,
  role: "owner",
  title: "Current note",
  content: [],
} as unknown as PageDocument;
function setup(
  role = "owner",
  revisionLoader?: (version: number) => Promise<any>,
) {
  let cleared = false;
  const calls: string[] = [];
  const api = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => null },
    fetcher: async (input, init) => {
      const url = new URL(String(input));
      if (init?.method === "DELETE") {
        calls.push(url.pathname + url.search);
        cleared = true;
        return Response.json({ data: { deleted: true } });
      }
      if (url.pathname.endsWith("/restore")) {
        calls.push(String(init?.body));
        return Response.json({ data: doc });
      }
      if (url.pathname.endsWith("/revisions"))
        return Response.json({
          data: (cleared ? [3] : [3, 2, 1]).map((version) => ({
            id: "one",
            version,
            title: `Note ${version}`,
            createdAt: `2026-10-0${version}T10:00:00Z`,
          })),
        });
      const version = Number(url.pathname.split("/").at(-1));
      const value = revisionLoader
        ? await revisionLoader(version)
        : {
            title: `Note ${version}`,
            content: [
              { type: "p", children: [{ text: `Content ${version}` }] },
            ],
          };
      return Response.json({ data: value });
    },
  });
  const onRestored = vi.fn();
  render(
    <HistoryWorkspace
      client={new PagesClient(api)}
      document={{ ...doc, role: role as PageDocument["role"] }}
      issueProviders={[]}
      onClose={vi.fn()}
      onRestored={onRestored}
    />,
  );
  return { calls, onRestored };
}
function versionButton(version: number) {
  return screen.getByText(new RegExp(`^v${version}( ·|$)`)).closest("button")!;
}
it("previews versions in the document region and restores the selected version", async () => {
  const { calls, onRestored } = setup();
  await screen.findByText("Content 3");
  fireEvent.click(versionButton(2));
  await screen.findByText("Content 2");
  expect(screen.getByTestId("revision-content")).toHaveAttribute(
    "data-readonly",
    "true",
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Restore version" }));
  await waitFor(() => expect(onRestored).toHaveBeenCalledOnce());
  expect(JSON.parse(calls[0])).toEqual({ revision: 2, version: 3 });
});
it("requires confirmation to clear history and returns to the preserved current version", async () => {
  const { calls } = setup();
  await screen.findByText("Content 3");
  fireEvent.click(versionButton(1));
  await screen.findByText("Content 1");
  fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
  const dialog = screen.getByRole("dialog");
  expect(calls).toHaveLength(0);
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Clear history" }),
  );
  await screen.findByText("Content 3");
  expect(calls).toEqual(["/v1/pages/one/revisions?version=3"]);
  expect(screen.queryByText("v1")).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it.each(["reader", "editor"])(
  "does not offer history deletion to a %s",
  async (role) => {
    setup(role);
    await screen.findByText("Content 3");
    expect(
      screen.queryByRole("button", { name: "Clear history" }),
    ).not.toBeInTheDocument();
    if (role === "reader")
      expect(
        screen.queryByRole("button", { name: "Restore version" }),
      ).not.toBeInTheDocument();
  },
);
it("ignores a delayed preview response after selecting a different version", async () => {
  let resolveOld!: (value: any) => void;
  setup("owner", (version) =>
    version === 2
      ? new Promise((resolve) => {
          resolveOld = resolve;
        })
      : Promise.resolve({
          title: `Note ${version}`,
          content: [{ type: "p", children: [{ text: `Content ${version}` }] }],
        }),
  );
  await screen.findByText("Content 3");
  fireEvent.click(versionButton(2));
  await waitFor(() => expect(resolveOld).toBeDefined());
  fireEvent.click(versionButton(1));
  await screen.findByText("Content 1");
  await act(async () =>
    resolveOld({
      title: "Note 2",
      content: [{ type: "p", children: [{ text: "Content 2" }] }],
    }),
  );
  expect(screen.getByText("Content 1")).toBeInTheDocument();
  expect(screen.queryByText("Content 2")).not.toBeInTheDocument();
});
