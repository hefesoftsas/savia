import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "@/api/api-client";
import { PagesClient } from "./client";
import { SharePanel } from "./share-panel";

afterEach(cleanup);

function setup(fetcher: typeof fetch) {
  const api = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => "session" },
    fetcher,
  });
  render(
    <SharePanel
      client={new PagesClient(api)}
      pageId="page-1"
      pageTitle="Project"
      pageKind="folder"
      onDone={vi.fn()}
    />,
  );
}

it("reports a member-load failure, retries it, and shows the real empty-team state", async () => {
  let memberAttempts = 0;
  setup(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/members") && ++memberAttempts === 1)
      return Response.json({ error: { code: "UNAVAILABLE" } }, { status: 503 });
    if (path.endsWith("/members")) return Response.json({ data: [] });
    if (path.endsWith("/shares"))
      return Response.json({
        data: { rootId: "page-1", version: 4, shares: [] },
      });
    return Response.json({ data: [] });
  });
  expect(
    await screen.findByText("Could not load team members."),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Save" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByText("There are no active members in this team."),
  ).toBeInTheDocument();
  expect(memberAttempts).toBe(2);
});

it("creates, copies, opens, and revokes a public link through the Pages API", async () => {
  const calls: Array<{ path: string; method: string; body?: string }> = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  setup(async (input, init) => {
    const url = new URL(String(input));
    calls.push({
      path: url.pathname,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    if (url.pathname.endsWith("/members")) return Response.json({ data: [] });
    if (url.pathname.endsWith("/shares"))
      return Response.json({
        data: { rootId: "page-1", version: 4, shares: [] },
      });
    if (url.pathname.endsWith("/public-links") && init?.method === "POST")
      return Response.json({
        data: {
          id: "link-1",
          path: "/public/pages/abcdefghijklmnopqrstuv",
          createdAt: "2026-10-01T00:00:00Z",
          expiresAt: null,
          revokedAt: null,
        },
      });
    if (
      url.pathname.endsWith("/public-links/link-1") &&
      init?.method === "DELETE"
    )
      return Response.json({ data: {} });
    return Response.json({ data: [] });
  });
  fireEvent.click(screen.getByRole("tab", { name: "Public link" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Create public link" }),
  );
  expect(await screen.findByText("Public link created.")).toBeInTheDocument();
  const publicUrl = new URL(
    "/public/pages/abcdefghijklmnopqrstuv",
    window.location.origin,
  ).href;
  expect(screen.getByText(publicUrl)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open link" })).toHaveAttribute(
    "href",
    publicUrl,
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  await waitFor(() =>
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(publicUrl),
  );
  fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  expect(await screen.findByText("Link revoked.")).toBeInTheDocument();
  expect(calls).toContainEqual({
    path: "/v1/pages/page-1/public-links",
    method: "POST",
    body: "{}",
  });
  expect(
    calls.some(
      (call) =>
        call.path === "/v1/pages/page-1/public-links/link-1" &&
        call.method === "DELETE",
    ),
  ).toBe(true);
});

it.each([false, true])(
  "uses a %s persisted short link for copying and opening",
  async (persisted) => {
    const shortUrl = "/s/p/0123456789abcdef01234567";
    const requests: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    setup(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/members")) return Response.json({ data: [] });
      if (path.endsWith("/shares"))
        return Response.json({
          data: { rootId: "page-1", version: 1, shares: [] },
        });
      if (path.endsWith("/short-url")) {
        requests.push(init?.method ?? "GET");
        return Response.json({ data: { shortUrl } });
      }
      return Response.json({
        data: [
          {
            id: "link-1",
            path: "/public/pages/long-token",
            shortUrl: persisted ? shortUrl : null,
            createdAt: "2026-10-01T00:00:00Z",
            expiresAt: null,
            revokedAt: null,
          },
        ],
      });
    });
    fireEvent.click(screen.getByRole("tab", { name: "Public link" }));
    if (!persisted) {
      fireEvent.click(
        await screen.findByRole("button", { name: "Create short link" }),
      );
      await screen.findByText("Short link ready to copy.");
    } else await screen.findByRole("link", { name: "Open link" });
    const url = new URL(shortUrl, window.location.origin).href;
    expect(screen.getByRole("link", { name: "Open link" })).toHaveAttribute(
      "href",
      url,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(url),
    );
    expect(
      screen.queryByRole("button", { name: "Create short link" }),
    ).not.toBeInTheDocument();
    expect(requests).toEqual(persisted ? [] : ["POST"]);
  },
);

it("keeps the full public URL usable when shortening fails", async () => {
  setup(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/members")) return Response.json({ data: [] });
    if (path.endsWith("/shares"))
      return Response.json({
        data: { rootId: "page-1", version: 1, shares: [] },
      });
    if (path.endsWith("/short-url"))
      return Response.json({ error: { code: "UNAVAILABLE" } }, { status: 503 });
    return Response.json({
      data: [
        {
          id: "link-1",
          path: "/public/pages/long-token",
          createdAt: "2026-10-01T00:00:00Z",
          expiresAt: null,
          revokedAt: null,
        },
      ],
    });
  });
  fireEvent.click(screen.getByRole("tab", { name: "Public link" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Create short link" }),
  );
  await screen.findByText(
    "Could not shorten the link. You can use the full link.",
  );
  expect(screen.getByRole("link", { name: "Open link" })).toHaveAttribute(
    "href",
    new URL("/public/pages/long-token", window.location.origin).href,
  );
});
