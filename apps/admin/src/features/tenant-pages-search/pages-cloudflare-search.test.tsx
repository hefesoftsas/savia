import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StoreContextProvider, memoryStore } from "ra-core";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import { PagesCloudflareSearch } from "./pages-cloudflare-search";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderSearch(api: {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
}) {
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <MemoryRouter>
          <PagesCloudflareSearch client={{ api } as never} />
        </MemoryRouter>
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
}

it("renders no page-search controls when the tenant feature is disabled", async () => {
  const api = {
    get: vi.fn().mockResolvedValue({
      data: {
        enabled: false,
        available: true,
        total: 0,
        indexed: 0,
        needed: [],
      },
    }),
    post: vi.fn(),
  };
  renderSearch(api);

  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith(
      "/v1/pages/search/status",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ),
  );
  expect(screen.queryByRole("region", { name: "Page search" })).toBeNull();
  expect(
    screen.queryByRole("textbox", { name: "Search pages by meaning" }),
  ).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
});

it("shows a clear unavailable state without search or indexing controls", async () => {
  const api = {
    get: vi.fn().mockResolvedValue({
      data: {
        enabled: true,
        available: false,
        total: 0,
        indexed: 0,
        needed: [],
      },
    }),
    post: vi.fn(),
  };
  renderSearch(api);

  expect(
    await screen.findByText("Semantic search is unavailable right now."),
  ).toBeVisible();
  expect(
    screen.queryByRole("textbox", { name: "Search pages by meaning" }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "Update index" })).toBeNull();
});

it("reports sequential indexing progress and stops before the next page on cancel", async () => {
  const api = {
    get: vi.fn().mockResolvedValue({
      data: {
        enabled: true,
        available: true,
        total: 2,
        indexed: 0,
        needed: ["page-one", "page-two"],
      },
    }),
    post: vi.fn(
      (_path: string, _body: unknown, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    ),
  };
  renderSearch(api);

  fireEvent.click(await screen.findByRole("button", { name: "Update index" }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      "/v1/pages/search/index/page-one",
      {},
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ),
  );
  expect(screen.getByText("Indexing pages: 0 of 2")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Cancel indexing" }));
  await act(async () => Promise.resolve());
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.post).not.toHaveBeenCalledWith(
    "/v1/pages/search/index/page-two",
    expect.anything(),
    expect.anything(),
  );
});

it("does not announce zero results when focus invalidates a completed search", async () => {
  const status = {
    enabled: true,
    available: true,
    total: 1,
    indexed: 1,
    needed: [],
  };
  const api = {
    get: vi.fn(async (path: string) => ({
      data:
        path === "/v1/pages/search/status"
          ? status
          : [
              {
                id: "found",
                title: "Found page",
                updatedAt: "2026-10-03",
                parentId: null,
                rootId: "found",
                ownerId: "owner",
                kind: "page",
                version: 1,
                role: "owner",
                isShared: false,
                score: 0.9,
                excerpt: "Hello context",
              },
            ],
    })),
    post: vi.fn(),
  };
  renderSearch(api);
  fireEvent.change(
    await screen.findByRole("textbox", { name: "Search pages by meaning" }),
    { target: { value: "Hello" } },
  );
  await screen.findByRole("link", { name: /Found page/ });
  expect(screen.getByText("1 result")).toBeVisible();
  fireEvent(window, new Event("focus"));
  await waitFor(() =>
    expect(
      api.get.mock.calls.filter(([path]) => path === "/v1/pages/search/status"),
    ).toHaveLength(2),
  );
  expect(screen.queryByRole("link", { name: /Found page/ })).toBeNull();
  expect(screen.queryByText("0 results")).toBeNull();
  expect(
    screen.getByRole("textbox", { name: "Search pages by meaning" }),
  ).toHaveValue("Hello");
});

it("refreshes the retained query after focus without waiting for another edit", async () => {
  let searches = 0;
  const api = {
    get: vi.fn(async (path: string) => ({
      data:
        path === "/v1/pages/search/status"
          ? { enabled: true, available: true, total: 1, indexed: 1, needed: [] }
          : [
              {
                id: "found",
                title: ++searches === 1 ? "Initial page" : "Updated page",
                updatedAt: "2026-10-03",
                parentId: null,
                rootId: "found",
                ownerId: "owner",
                kind: "page",
                version: 1,
                role: "owner",
                isShared: false,
                score: 0.9,
                excerpt: "Hello context",
              },
            ],
    })),
    post: vi.fn(),
  };
  renderSearch(api);
  fireEvent.change(
    await screen.findByRole("textbox", { name: "Search pages by meaning" }),
    { target: { value: "Hello" } },
  );
  await screen.findByRole("link", { name: /Initial page/ });
  fireEvent(window, new Event("focus"));
  await screen.findByRole("link", { name: /Updated page/ });
  expect(searches).toBe(2);
  expect(
    screen.getByRole("textbox", { name: "Search pages by meaning" }),
  ).toHaveValue("Hello");
});
