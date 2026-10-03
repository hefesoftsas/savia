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
