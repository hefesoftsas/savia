import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StoreContextProvider, memoryStore } from "ra-core";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { ApiClientError } from "@/api/api-client";
import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import { publishPageChange } from "@/features/pages/page-events";
import { PagesCloudflareSearch } from "./pages-cloudflare-search";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function LocationReadout() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderSearch(api: {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
}) {
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <MemoryRouter>
          <PagesCloudflareSearch client={{ api } as never} />
          <LocationReadout />
        </MemoryRouter>
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
}

function summary(id: string, title = id, excerpt?: string) {
  return {
    id,
    title,
    excerpt,
    updatedAt: "2026-10-03T10:00:00Z",
    parentId: null,
    rootId: id,
    ownerId: "owner",
    kind: "page",
    version: 1,
    role: "owner",
    isShared: false,
  };
}

function status(
  enabled: boolean,
  available = true,
): {
  enabled: boolean;
  available: boolean;
  total: number;
  indexed: number;
  needed: string[];
} {
  return { enabled, available, total: 2, indexed: 1, needed: [] };
}

function apiFor({
  settings = status(false),
  lexical = [],
  semantic = [],
}: {
  settings?: ReturnType<typeof status>;
  lexical?: ReturnType<typeof summary>[];
  semantic?: ReturnType<typeof summary>[];
} = {}): { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> } {
  return {
    get: vi.fn(async (path: string) => {
      const url = new URL(path, "https://savia.test");
      if (url.pathname === "/v1/pages/search/status") return { data: settings };
      if (url.pathname === "/v1/pages/search") return { data: semantic };
      return { data: lexical };
    }),
    post: vi.fn().mockResolvedValue({}),
  };
}

async function enterQuery(query = "Hello") {
  const input = await screen.findByRole("combobox", {
    name: "Search pages and content",
  });
  fireEvent.change(input, { target: { value: query } });
  return input;
}

it("keeps lexical title and content search available when semantic search is disabled", async () => {
  const api = apiFor({
    lexical: [summary("text", "Text match", "Hello in body")],
  });
  renderSearch(api);

  await enterQuery();
  expect(
    await screen.findByRole("option", { name: /Text match/ }),
  ).toBeVisible();
  expect(api.get).toHaveBeenCalledWith(
    "/v1/pages/search/status",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(api.get).not.toHaveBeenCalledWith(
    expect.stringContaining("/v1/pages/search?"),
    expect.anything(),
  );
  expect(api.post).not.toHaveBeenCalled();
  expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "true");
});

it("shows initial status failure while keeping lexical search available", async () => {
  const api = apiFor({ lexical: [summary("text", "Text match")] });
  api.get.mockImplementation(async (path: string) => {
    if (path === "/v1/pages/search/status")
      throw new Error("Network unavailable");
    if (path.startsWith("/v1/pages/search?")) return { data: [] };
    return { data: [summary("text", "Text match")] };
  });
  renderSearch(api);

  expect(
    await screen.findByText(
      "Index status could not be loaded; text search is still available.",
    ),
  ).toBeVisible();
  await enterQuery();
  expect(
    await screen.findByRole("option", { name: /Text match/ }),
  ).toBeVisible();
  expect(api.get).not.toHaveBeenCalledWith(
    expect.stringContaining("/v1/pages/search?"),
    expect.anything(),
  );
  expect(api.post).not.toHaveBeenCalled();
});

it("merges lexical matches first, appends semantic matches, and deduplicates by page id", async () => {
  const api = apiFor({
    settings: status(true),
    lexical: [summary("same", "Text match"), summary("text-only", "Text only")],
    semantic: [
      summary("same", "Duplicate semantic"),
      summary("semantic-only", "Meaning match"),
    ],
  });
  renderSearch(api);

  await enterQuery("hello world");
  const options = await screen.findAllByRole("option");
  await waitFor(() => expect(options).toHaveLength(3));
  expect(options.map((option) => option.textContent)).toEqual([
    expect.stringContaining("Text match"),
    expect.stringContaining("Text only"),
    expect.stringContaining("Meaning match"),
  ]);
  expect(options[0].textContent).not.toContain("Duplicate semantic");
  expect(api.get).toHaveBeenCalledWith(
    "/v1/pages/search?q=hello+world",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});

it("shows lexical matches while semantic search is pending, then falls back cleanly on semantic failure", async () => {
  let rejectSemantic!: (reason: Error) => void;
  const api = apiFor({
    settings: status(true),
    lexical: [summary("text", "Text result", "Hello from the body")],
  });
  api.get.mockImplementation(async (path: string) => {
    if (path === "/v1/pages/search/status") return { data: status(true) };
    if (path.startsWith("/v1/pages/search?"))
      return new Promise((_resolve, reject) => {
        rejectSemantic = reject;
      });
    return { data: [summary("text", "Text result", "Hello from the body")] };
  });
  renderSearch(api);

  await enterQuery();
  expect(
    await screen.findByRole("option", { name: /Text result/ }),
  ).toBeVisible();
  expect(screen.queryByText("Showing 1 suggestions")).toBeNull();
  await act(async () => rejectSemantic(new Error("Unavailable")));
  expect(
    await screen.findByText("Showing title and content matches."),
  ).toBeVisible();
  expect(screen.getByRole("option", { name: /Text result/ })).toBeVisible();
});

it("supports arrow selection, Enter navigation, and Escape dismissal", async () => {
  const api = apiFor({
    lexical: [summary("one", "First"), summary("two", "Second")],
  });
  renderSearch(api);
  const input = await enterQuery();
  const options = await screen.findAllByRole("option");

  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(input).toHaveAttribute("aria-activedescendant", options[0].id);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(input).toHaveAttribute("aria-activedescendant", options[1].id);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByTestId("location")).toHaveTextContent("/pages/two");

  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input).toHaveAttribute("aria-expanded", "false");
});

it("ignores results from an older query after the input changes", async () => {
  let resolveOld!: (value: { data: ReturnType<typeof summary>[] }) => void;
  const api = apiFor({ lexical: [] });
  api.get.mockImplementation((path: string) => {
    const url = new URL(path, "https://savia.test");
    if (url.pathname === "/v1/pages/search/status")
      return Promise.resolve({ data: status(false) });
    if (url.searchParams.get("q") === "old")
      return new Promise((resolve) => {
        resolveOld = resolve;
      });
    return Promise.resolve({ data: [summary("new", "New query result")] });
  });
  renderSearch(api);

  const input = await enterQuery("old");
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith(
      "/v1/pages?q=old",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ),
  );
  fireEvent.change(input, { target: { value: "new" } });
  expect(
    await screen.findByRole("option", { name: /New query result/ }),
  ).toBeVisible();
  await act(async () =>
    resolveOld({ data: [summary("old", "Old query result")] }),
  );
  expect(screen.queryByRole("option", { name: /Old query result/ })).toBeNull();
});

it("clears keyboard selection when faster lexical results reorder semantic suggestions", async () => {
  let resolveLexical!: (value: { data: ReturnType<typeof summary>[] }) => void;
  const api = apiFor({ settings: status(true) });
  api.get.mockImplementation((path: string) => {
    if (path === "/v1/pages/search/status")
      return Promise.resolve({ data: status(true) });
    if (path.startsWith("/v1/pages/search?"))
      return Promise.resolve({
        data: [summary("semantic", "Semantic suggestion")],
      });
    return new Promise((resolve) => {
      resolveLexical = resolve;
    });
  });
  renderSearch(api);
  const input = await enterQuery();

  const semanticOption = await screen.findByRole("option", {
    name: /Semantic suggestion/,
  });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(input).toHaveAttribute("aria-activedescendant", semanticOption.id);
  await act(async () =>
    resolveLexical({ data: [summary("lexical", "Text suggestion")] }),
  );
  expect(
    await screen.findByRole("option", { name: /Text suggestion/ }),
  ).toBeVisible();
  expect(input).not.toHaveAttribute("aria-activedescendant");
});

it("automatically indexes needed pages sequentially and exposes pause and resume", async () => {
  let resolveFirst!: () => void;
  let resolveSecond!: () => void;
  const api = apiFor({
    settings: { ...status(true), needed: ["page-one", "page-two"] },
  });
  api.get.mockImplementation(async (path: string) => ({
    data:
      path === "/v1/pages/search/status"
        ? { ...status(true), needed: ["page-one", "page-two"] }
        : [],
  }));
  api.post
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = () => resolve({});
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = () => resolve({});
        }),
    );
  renderSearch(api);

  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      "/v1/pages/search/index/page-one",
      {},
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ),
  );
  expect(screen.getByText("Indexing pages: 0 of 2")).toBeVisible();
  expect(api.post).toHaveBeenCalledTimes(1);
  await act(async () => resolveFirst());
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
  expect(api.post).toHaveBeenLastCalledWith(
    "/v1/pages/search/index/page-two",
    {},
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(screen.getByText("Indexing pages: 1 of 2")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Pause catch-up" }));
  await act(async () => resolveSecond());
  expect(
    await screen.findByRole("button", { name: "Resume catch-up" }),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "Update index" })).toBeNull();
});

it("does not repeat a failed catchup batch until Retry is selected", async () => {
  const api = apiFor({ settings: { ...status(true), needed: ["page-one"] } });
  api.get.mockImplementation(async (path: string) => ({
    data:
      path === "/v1/pages/search/status"
        ? { ...status(true), needed: ["page-one"] }
        : [],
  }));
  api.post
    .mockRejectedValueOnce(new Error("Unavailable"))
    .mockResolvedValueOnce({});
  renderSearch(api);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "A page could not be indexed.",
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(api.post).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Retry indexing" }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
});

it("defers INDEX_IN_PROGRESS and checks the manifest after five seconds without an immediate retry", async () => {
  vi.useFakeTimers();
  let statusCalls = 0;
  const api = apiFor();
  api.get.mockImplementation(async (path: string) => {
    if (path !== "/v1/pages/search/status") return { data: [] };
    statusCalls += 1;
    return {
      data: {
        ...status(true),
        needed: statusCalls === 1 ? ["busy-page"] : [],
      },
    };
  });
  api.post.mockRejectedValueOnce(
    new ApiClientError(409, "INDEX_IN_PROGRESS", "Index in progress"),
  );
  renderSearch(api);

  await act(async () => {
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
  });
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/Another request is indexing/)).toBeVisible();
  await act(async () => vi.advanceTimersByTimeAsync(4999));
  expect(statusCalls).toBe(1);
  expect(api.post).toHaveBeenCalledTimes(1);

  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(statusCalls).toBe(2);
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/Another request is indexing/)).toBeNull();
});

it("aborts catchup on a page change and indexes the refreshed needed list", async () => {
  let statusCalls = 0;
  const api = apiFor();
  api.get.mockImplementation(async (path: string) => {
    if (path !== "/v1/pages/search/status") return { data: [] };
    statusCalls += 1;
    return {
      data: {
        ...status(true),
        needed: statusCalls === 1 ? ["old-page"] : ["new-page"],
      },
    };
  });
  api.post.mockImplementation(
    (path: string, _body: unknown, options: { signal: AbortSignal }) => {
      if (path.endsWith("old-page"))
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      return Promise.resolve({});
    },
  );
  renderSearch(api);

  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      "/v1/pages/search/index/old-page",
      {},
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ),
  );
  act(() => publishPageChange({ api: api as never }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      "/v1/pages/search/index/new-page",
      {},
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ),
  );
  expect(api.post).toHaveBeenCalledTimes(2);
});

it("keeps indexing details in a tooltip that can be opened with a tap", async () => {
  renderSearch(apiFor({ settings: status(true) }));
  const information = await screen.findByRole("button", {
    name: "Page indexing information",
  });
  expect(screen.queryByText("1 of 2 pages sent for indexing")).toBeNull();
  expect(screen.queryByRole("tooltip")).toBeNull();

  fireEvent.click(information);
  const tooltip = await screen.findByRole("tooltip");
  expect(tooltip).toHaveTextContent("1 of 2 pages sent for indexing");
  expect(tooltip).toHaveTextContent("Older pages catch up");
  fireEvent.keyDown(information, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
});
