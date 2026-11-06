import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { ApiClient, ApiClientError } from "@/api/api-client";
import { PagesPage } from "./pages-page";
import type { PageDocument } from "./client";
vi.mock("./editor", () => ({
  PageEditor: ({ initialValue, onChange, readOnly, onPendingUpload }: any) => (
    <>
      <button onClick={() => onPendingUpload?.(true)}>Start upload</button>
      <textarea
        aria-label="Document body"
        readOnly={readOnly}
        defaultValue={initialValue?.[0]?.children?.[0]?.text ?? ""}
        onChange={(event) =>
          onChange([{ type: "p", children: [{ text: event.target.value }] }])
        }
      />
    </>
  ),
}));
afterEach(cleanup);
it("looks up the bound page again after a previous page has been deleted", async () => {
  let current: PageDocument | undefined;
  let creations = 0;
  const api = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => null },
    fetcher: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        current = {
          ...body,
          id: `bound-${++creations}`,
          rootId: `bound-${creations}`,
          ownerId: "user",
          parentId: null,
          version: 1,
          isShared: false,
          role: "owner",
          updatedAt: "2026-10-01T10:00:00Z",
          content: [],
        };
        return Response.json({ data: current });
      }
      if (path === "/v1/pages")
        return Response.json({ data: current ? [current] : [] });
      return current
        ? Response.json({ data: current })
        : Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
    },
  });
  const bound =
    "/pages?domain=%2Fv1%2Fstudio%2F1&collection=tasks&record=task-1";
  const router = createMemoryRouter(
    [
      {
        path: "/pages/:pageId?",
        element: <PagesPage services={{ apiClient: api }} />,
      },
    ],
    { initialEntries: [bound] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByRole("textbox", { name: "Document body" });
  expect(creations).toBe(1);
  current = undefined;
  await act(async () => {
    await router.navigate("/pages");
  });
  await act(async () => {
    await router.navigate(bound);
  });
  await waitFor(() =>
    expect(router.state.location.pathname).toBe("/pages/bound-2"),
  );
  expect(creations).toBe(2);
});
function setup(
  role = "owner",
  conflict = false,
  beforeWrite?: () => Promise<void>,
) {
  let page = {
    id: "one",
    parentId: null,
    rootId: "one",
    ownerId: "user",
    title: "My project",
    version: 1,
    updatedAt: "2026-10-01T10:00:00Z",
    role,
    binding: null,
    content: [{ type: "p", children: [{ text: "Original" }] }],
  };
  const writes: any[] = [];
  const api = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => null },
    fetcher: async (input, init) => {
      const url = new URL(String(input));
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        writes.push(body);
        await beforeWrite?.();
        if (conflict)
          return Response.json(
            { error: { code: "VERSION_CONFLICT", message: "Conflict" } },
            { status: 409 },
          );
        page = { ...page, ...body, version: page.version + 1 };
        return Response.json({ data: page });
      }
      return Response.json({
        data: url.pathname === "/v1/pages" ? [page] : page,
      });
    },
  });
  const router = createMemoryRouter(
    [
      {
        path: "/pages/:pageId?",
        element: <PagesPage services={{ apiClient: api }} />,
      },
      { path: "/elsewhere", element: <p>Other screen</p> },
    ],
    { initialEntries: ["/elsewhere", "/pages/one"] },
  );
  render(<RouterProvider router={router} />);
  return { writes, router };
}
it("autosaves a document using its current version and updates the saved status", async () => {
  const { writes } = setup();
  fireEvent.change(
    await screen.findByRole("textbox", { name: "Document body" }),
    { target: { value: "New note" } },
  );
  await waitFor(() => expect(writes).toHaveLength(1), { timeout: 2000 });
  expect(writes[0]).toMatchObject({
    version: 1,
    content: [{ type: "p", children: [{ text: "New note" }] }],
  });
  await screen.findByText("Saved");
});
it("preserves the draft after a conflict and offers recovery instead of silently overwriting", async () => {
  setup("owner", true);
  fireEvent.change(
    await screen.findByRole("textbox", { name: "Document body" }),
    { target: { value: "Keep this draft" } },
  );
  await screen.findByText(/Changes could not be saved/);
  expect(screen.getByRole("textbox", { name: "Document body" })).toHaveValue(
    "Keep this draft",
  );
  expect(screen.getByRole("button", { name: "Download draft" })).toBeVisible();
});
it("keeps shared reader documents read-only", async () => {
  setup("reader");
  expect(
    await screen.findByRole("textbox", { name: "Document body" }),
  ).toHaveAttribute("readonly");
  expect(
    screen.queryByRole("button", { name: "Share" }),
  ).not.toBeInTheDocument();
});

it("lets a reader export the page as Markdown from page options", async () => {
  setup("reader");
  const user = userEvent.setup();
  const createDescriptor = Object.getOwnPropertyDescriptor(
    URL,
    "createObjectURL",
  );
  const revokeDescriptor = Object.getOwnPropertyDescriptor(
    URL,
    "revokeObjectURL",
  );
  const clickDescriptor = Object.getOwnPropertyDescriptor(
    HTMLAnchorElement.prototype,
    "click",
  );
  const createObjectURL = vi.fn(() => "blob:markdown-export");
  const click = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLAnchorElement.prototype, "click", {
    configurable: true,
    value: click,
  });
  try {
    await user.click(
      await screen.findByRole("button", { name: "Page options" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Export as Markdown" }),
    );
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledOnce();
  } finally {
    if (createDescriptor)
      Object.defineProperty(URL, "createObjectURL", createDescriptor);
    else Reflect.deleteProperty(URL, "createObjectURL");
    if (revokeDescriptor)
      Object.defineProperty(URL, "revokeObjectURL", revokeDescriptor);
    else Reflect.deleteProperty(URL, "revokeObjectURL");
    if (clickDescriptor)
      Object.defineProperty(
        HTMLAnchorElement.prototype,
        "click",
        clickDescriptor,
      );
    else Reflect.deleteProperty(HTMLAnchorElement.prototype, "click");
  }
});

it("preserves a dirty draft when using browser Back", async () => {
  const { router } = setup("owner", true);
  fireEvent.change(
    await screen.findByRole("textbox", { name: "Document body" }),
    { target: { value: "Do not lose this" } },
  );
  await act(async () => {
    await router.navigate(-1);
  });
  expect(screen.getByRole("textbox", { name: "Document body" })).toHaveValue(
    "Do not lose this",
  );
  expect(router.state.location.pathname).toBe("/pages/one");
});
it("saves a reversion made while an earlier save is still pending", async () => {
  let resolveWrite!: () => void;
  const pending = new Promise<void>((resolve) => {
    resolveWrite = resolve;
  });
  const { writes } = setup("owner", false, () => pending);
  const body = await screen.findByRole("textbox", { name: "Document body" });
  fireEvent.change(body, { target: { value: "Intermediate" } });
  await waitFor(() => expect(writes).toHaveLength(1), { timeout: 2000 });
  fireEvent.change(body, { target: { value: "Original" } });
  await act(async () => resolveWrite());
  await waitFor(() => expect(writes).toHaveLength(2), { timeout: 2000 });
  expect(writes[1]).toMatchObject({
    version: 2,
    content: [{ type: "p", children: [{ text: "Original" }] }],
  });
  await screen.findByText("Saved");
});

it("clears dirty status when the draft is reverted before autosave", async () => {
  const { writes } = setup();
  const body = await screen.findByRole("textbox", { name: "Document body" });
  fireEvent.change(body, { target: { value: "Temporary edit" } });
  await screen.findByText("Unsaved changes");
  fireEvent.change(body, { target: { value: "Original" } });
  await screen.findByText("Saved");
  expect(writes).toHaveLength(0);
});

it("blocks navigation while an attachment is uploading", async () => {
  const { router } = setup();
  fireEvent.click(await screen.findByRole("button", { name: "Start upload" }));
  await act(async () => {
    await router.navigate(-1);
  });
  expect(router.state.location.pathname).toBe("/pages/one");
  expect(screen.getByRole("textbox", { name: "Document body" })).toBeVisible();
});

function renderPagesHome(fetcher: typeof fetch) {
  const api = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => null },
    fetcher,
  });
  const router = createMemoryRouter(
    [
      {
        path: "/pages/:pageId?",
        element: <PagesPage services={{ apiClient: api }} />,
      },
    ],
    { initialEntries: ["/pages"] },
  );
  render(<RouterProvider router={router} />);
  return { api, router };
}

async function openPagesOptions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", { name: "Pages options" }),
  );
}

it("downloads the archive returned by the all-pages export endpoint", async () => {
  const archive = {
    format: "savia-pages",
    version: 1,
    exportedAt: "2026-10-02T10:00:00.000Z",
    pages: [],
    files: [],
  };
  let exported = false;
  renderPagesHome(async (input, init) => {
    if (new URL(String(input)).pathname === "/v1/pages/export") {
      exported = init?.method === undefined || init.method === "GET";
      return Response.json({ data: archive });
    }
    return Response.json({ data: [] });
  });
  const createDescriptor = Object.getOwnPropertyDescriptor(
    URL,
    "createObjectURL",
  );
  const revokeDescriptor = Object.getOwnPropertyDescriptor(
    URL,
    "revokeObjectURL",
  );
  const clickDescriptor = Object.getOwnPropertyDescriptor(
    HTMLAnchorElement.prototype,
    "click",
  );
  const createObjectURL = vi.fn(() => "blob:pages-export");
  const click = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLAnchorElement.prototype, "click", {
    configurable: true,
    value: click,
  });
  try {
    const user = userEvent.setup();
    await openPagesOptions(user);
    await user.click(
      screen.getByRole("menuitem", { name: "Export all my pages" }),
    );
    await waitFor(() => expect(exported).toBe(true));
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledOnce();
    expect(await screen.findByText("Pages exported.")).toBeVisible();
  } finally {
    if (createDescriptor)
      Object.defineProperty(URL, "createObjectURL", createDescriptor);
    else Reflect.deleteProperty(URL, "createObjectURL");
    if (revokeDescriptor)
      Object.defineProperty(URL, "revokeObjectURL", revokeDescriptor);
    else Reflect.deleteProperty(URL, "revokeObjectURL");
    if (clickDescriptor)
      Object.defineProperty(
        HTMLAnchorElement.prototype,
        "click",
        clickDescriptor,
      );
    else Reflect.deleteProperty(HTMLAnchorElement.prototype, "click");
  }
});

it("imports new pages and refreshes the Pages navigation", async () => {
  let imported = false;
  let listRequests = 0;
  const archive = {
    format: "savia-pages",
    version: 1,
    exportedAt: "2026-10-02T10:00:00.000Z",
    pages: [
      {
        id: "source",
        parentId: null,
        title: "Imported idea",
        kind: "page",
        content: [],
      },
    ],
    files: [],
  };
  renderPagesHome(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/pages/import" && init?.method === "POST") {
      imported = JSON.parse(String(init.body)).format === "savia-pages";
      return Response.json({ data: { pages: 1, folders: 0, files: 0 } });
    }
    if (url.pathname === "/v1/pages") {
      listRequests++;
      return Response.json({
        data: imported
          ? [
              {
                id: "copy",
                parentId: null,
                rootId: "copy",
                title: "Imported idea",
                kind: "page",
                version: 1,
                updatedAt: "2026-10-02T10:00:00Z",
                ownerId: "user",
                role: "owner",
                isShared: false,
              },
            ]
          : [],
      });
    }
    return Response.json({ data: archive });
  });
  const user = userEvent.setup();
  await openPagesOptions(user);
  await user.click(screen.getByRole("menuitem", { name: "Import pages" }));
  await user.upload(
    screen.getByLabelText("Choose archive"),
    new File([JSON.stringify(archive)], "ideas.savia-pages.json", {
      type: "application/json",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Import archive" }));
  await screen.findByText("Imported idea");
  expect(imported).toBe(true);
  expect(listRequests).toBeGreaterThan(1);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Imported content as private copies. Pages: 1; folders: 0; attachments: 0.",
  );
});

it("rejects malformed and oversized archives before making an import request", async () => {
  let importRequests = 0;
  renderPagesHome(async (input, init) => {
    if (
      new URL(String(input)).pathname === "/v1/pages/import" &&
      init?.method === "POST"
    )
      importRequests++;
    return Response.json({ data: [] });
  });
  const user = userEvent.setup();
  await openPagesOptions(user);
  await user.click(screen.getByRole("menuitem", { name: "Import pages" }));
  const input = screen.getByLabelText("Choose archive");
  await user.upload(
    input,
    new File(["{"], "broken.savia-pages.json", { type: "application/json" }),
  );
  await user.click(screen.getByRole("button", { name: "Import archive" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The archive is not valid JSON",
  );
  expect(importRequests).toBe(0);

  const oversized = new File(["{}"], "large.savia-pages.json", {
    type: "application/json",
  });
  Object.defineProperty(oversized, "size", {
    configurable: true,
    value: 50 * 1024 * 1024 + 1,
  });
  await user.upload(input, oversized);
  await user.click(screen.getByRole("button", { name: "Import archive" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The archive exceeds the 50 MiB limit",
  );
  expect(importRequests).toBe(0);
});

it("allows the same file to be selected again after an import request fails", async () => {
  let importRequests = 0;
  const archive = {
    format: "savia-pages",
    version: 1,
    exportedAt: "2026-10-02T10:00:00.000Z",
    pages: [],
    files: [],
  };
  renderPagesHome(async (input, init) => {
    if (
      new URL(String(input)).pathname === "/v1/pages/import" &&
      init?.method === "POST"
    ) {
      importRequests++;
      if (importRequests === 1)
        return Response.json(
          { error: { code: "UNAVAILABLE" } },
          { status: 503 },
        );
      return Response.json({ data: { pages: 0, folders: 0, files: 0 } });
    }
    return Response.json({ data: [] });
  });
  const user = userEvent.setup();
  await openPagesOptions(user);
  await user.click(screen.getByRole("menuitem", { name: "Import pages" }));
  const input = screen.getByLabelText("Choose archive");
  const file = new File([JSON.stringify(archive)], "retry.savia-pages.json", {
    type: "application/json",
  });
  await user.upload(input, file);
  await user.click(screen.getByRole("button", { name: "Import archive" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not import pages",
  );
  expect(input).toHaveValue("");
  await user.upload(input, file);
  await user.click(screen.getByRole("button", { name: "Import archive" }));
  await screen.findByText(/Pages: 0; folders: 0; attachments: 0/);
  expect(importRequests).toBe(2);
});

it("shows the size limit when the server rejects a large export", async () => {
  renderPagesHome(async (input) =>
    new URL(String(input)).pathname === "/v1/pages/export"
      ? Response.json(
          { error: { code: "ARCHIVE_TOO_LARGE", message: "too large" } },
          { status: 413 },
        )
      : Response.json({ data: [] }),
  );
  const user = userEvent.setup();
  await openPagesOptions(user);
  await user.click(
    screen.getByRole("menuitem", { name: "Export all my pages" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The archive exceeds the 50 MiB limit",
  );
});

it("explains when the server rejects an invalid Pages archive", async () => {
  const archive = {
    format: "savia-pages",
    version: 1,
    exportedAt: "2026-10-02T10:00:00.000Z",
    pages: [],
    files: [],
  };
  renderPagesHome(async (input, init) => {
    if (
      new URL(String(input)).pathname === "/v1/pages/import" &&
      init?.method === "POST"
    )
      return Response.json(
        { error: { code: "INVALID_ARCHIVE", message: "invalid" } },
        { status: 400 },
      );
    return Response.json({ data: [] });
  });
  const user = userEvent.setup();
  await openPagesOptions(user);
  await user.click(screen.getByRole("menuitem", { name: "Import pages" }));
  await user.upload(
    screen.getByLabelText("Choose archive"),
    new File([JSON.stringify(archive)], "valid.json", {
      type: "application/json",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Import archive" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This file is not a valid Pages archive",
  );
});

it("shows the archive size limit when the server rejects an import", async () => {
  const archive = {
    format: "savia-pages",
    version: 1,
    exportedAt: "2026-10-02T10:00:00.000Z",
    pages: [],
    files: [],
  };
  renderPagesHome(async (input, init) => {
    if (
      new URL(String(input)).pathname === "/v1/pages/import" &&
      init?.method === "POST"
    )
      return Response.json(
        { error: { code: "ARCHIVE_TOO_LARGE", message: "too large" } },
        { status: 413 },
      );
    return Response.json({ data: [] });
  });
  const user = userEvent.setup();
  await openPagesOptions(user);
  await user.click(screen.getByRole("menuitem", { name: "Import pages" }));
  await user.upload(
    screen.getByLabelText("Choose archive"),
    new File([JSON.stringify(archive)], "valid.json", {
      type: "application/json",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Import archive" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The archive exceeds the 50 MiB limit",
  );
});
