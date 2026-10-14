import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PublicPage, safePublicHref } from "./public-page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalCreateObjectURL) URL.createObjectURL = originalCreateObjectURL;
  else delete (URL as Partial<typeof URL>).createObjectURL;
});
const originalCreateObjectURL = URL.createObjectURL;

it("fetches only the anonymous public endpoint and renders rich content as safe static text", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return Response.json({
        data: {
          root: { id: "root", title: "Shared handbook" },
          page: {
            id: "root",
            title: "Welcome",
            kind: "page",
            updatedAt: "2026-10-01T00:00:00Z",
            content: [
              {
                type: "p",
                children: [
                  { text: "Safe text" },
                  { text: "external", url: "https://example.com" },
                  { text: "unsafe", url: "javascript:alert(1)" },
                ],
              },
              {
                type: "code_block",
                children: [{ text: "<script>never run</script>" }],
              },
              { type: "collection", children: [{ text: "private records" }] },
              {
                type: "ticket_summary",
                ticketSummaryConfig: { project: "OPS" },
                children: [{ text: "" }],
              },
              { type: "issue", url: "javascript:alert(2)" },
              { type: "bullet", children: [{ text: "One bullet" }] },
              { type: "numbered", children: [{ text: "First step" }] },
              { type: "callout", children: [{ text: "Important note" }] },
              {
                type: "p",
                children: [
                  {
                    type: "a",
                    url: "https://example.com/docs",
                    children: [{ text: "nested link" }],
                  },
                ],
              },
            ],
          },
          children: [{ id: "child", title: "Subpage", kind: "page" }],
          breadcrumbs: [{ id: "root", title: "Shared handbook" }],
        },
      });
    },
  );
  render(<PublicPage token="abcdefghijklmnopqrstuv" />);
  expect(
    await screen.findByRole("heading", { name: "Welcome" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Safe text")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "external" })).toHaveAttribute(
    "href",
    "https://example.com/",
  );
  expect(
    screen.queryByRole("link", { name: "unsafe" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("<script>never run</script>")).toBeInTheDocument();
  expect(
    screen.getByText("Collection data is not available in the public view."),
  ).toBeInTheDocument();
  expect(screen.getByText("javascript:alert(2)")).toBeInTheDocument();
  expect(screen.getByText("One bullet").closest("p")).toHaveClass(
    "public-page-bullet",
  );
  expect(screen.getByText("First step").closest("p")).toHaveClass(
    "public-page-numbered",
  );
  expect(screen.getByText("Important note").closest("aside")).toHaveClass(
    "public-page-callout",
  );
  expect(screen.getByRole("link", { name: "nested link" })).toHaveAttribute(
    "href",
    "https://example.com/docs",
  );
  expect(
    screen.queryByRole("navigation", { name: "Breadcrumbs" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Subpage" })).toHaveAttribute(
    "href",
    "/public/pages/abcdefghijklmnopqrstuv/child",
  );
  expect(
    screen.getByText("Ticket summary is available only to connected readers."),
  ).toBeInTheDocument();
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toContain("/api/public/pages/abcdefghijklmnopqrstuv");
  expect(requests[0].init).toMatchObject({
    credentials: "omit",
    cache: "no-store",
  });
});

it("accepts only HTTP, HTTPS, and mail links", () => {
  expect(safePublicHref("https://example.com/a")).toBe("https://example.com/a");
  expect(safePublicHref("mailto:hello@example.com")).toBe(
    "mailto:hello@example.com",
  );
  expect(safePublicHref("javascript:alert(1)")).toBeUndefined();
  expect(safePublicHref("data:text/html,unsafe")).toBeUndefined();
});

it("removes public page content when navigation switches to a revoked share token", async () => {
  const firstToken = "share-token-abcdefghijklmnop";
  const revokedToken = "revoked-token-abcdefghijkl";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "https://savia.test");
      if (url.pathname.includes(encodeURIComponent(revokedToken)))
        return new Response(null, { status: 410 });
      return Response.json({
        data: {
          root: { id: "root", title: "Confidential handbook" },
          page: {
            id: "root",
            title: "Private operations notes",
            kind: "page",
            content: [{ type: "p", children: [{ text: "Old share content" }] }],
          },
          children: [],
          breadcrumbs: [],
        },
      });
    }),
  );

  const page = render(<PublicPage token={firstToken} />);
  expect(
    await screen.findByRole("heading", { name: "Private operations notes" }),
  ).toBeInTheDocument();
  page.rerender(<PublicPage token={revokedToken} />);

  expect(
    await screen.findByRole("heading", { name: "Public page unavailable" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Old share content")).not.toBeInTheDocument();
});

it("loads attachment bytes without credentials and uses a local blob URL", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:savia-public-file"),
  });
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes("/files/"))
        return new Response("sample", {
          headers: { "content-type": "application/pdf" },
        });
      return Response.json({
        data: {
          root: { id: "root", title: "Shared handbook" },
          page: {
            id: "root",
            title: "Welcome",
            kind: "page",
            content: [
              {
                type: "attachment",
                fileId: "file-1",
                name: "Guide.pdf",
                mimeType: "application/pdf",
              },
            ],
          },
          children: [],
          breadcrumbs: [],
        },
      });
    },
  );
  render(<PublicPage token="abcdefghijklmnopqrstuv" />);
  expect(
    await screen.findByRole("link", { name: "Guide.pdf" }),
  ).toHaveAttribute("href", "blob:savia-public-file");
  expect(requests).toHaveLength(2);
  expect(requests[1].url).toContain(
    "/api/public/pages/abcdefghijklmnopqrstuv/pages/root/files/file-1",
  );
  expect(requests[1].init).toMatchObject({
    credentials: "omit",
    cache: "no-store",
  });
});

it("shows attachment failure and retries the anonymous file request", async () => {
  const requests: string[] = [];
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:savia-public-file"),
  });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/files/"))
      return requests.filter((item) => item.includes("/files/")).length === 1
        ? new Response(null, { status: 503 })
        : new Response("sample", {
            headers: { "content-type": "application/pdf" },
          });
    return Response.json({
      data: {
        root: { id: "root", title: "Shared handbook" },
        page: {
          id: "root",
          title: "Welcome",
          kind: "page",
          content: [
            {
              type: "attachment",
              fileId: "file-1",
              name: "Guide.pdf",
              mimeType: "application/pdf",
            },
          ],
        },
        children: [],
        breadcrumbs: [],
      },
    });
  });
  render(<PublicPage token="abcdefghijklmnopqrstuv" />);
  expect(
    await screen.findByText("Could not load this attachment."),
  ).toBeInTheDocument();
  screen.getByRole("button", { name: "Retry" }).click();
  expect(
    await screen.findByRole("link", { name: "Guide.pdf" }),
  ).toHaveAttribute("href", "blob:savia-public-file");
  expect(requests.filter((url) => url.includes("/files/")).length).toBe(2);
});
