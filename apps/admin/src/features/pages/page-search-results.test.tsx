import { cleanup, render, screen, within } from "@testing-library/react";
import { StoreContextProvider, memoryStore } from "ra-core";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import type { PageSummary } from "./client";
import { PageSearchResults } from "./page-search-results";

afterEach(cleanup);

function page(overrides: Partial<PageSummary> = {}): PageSummary {
  return {
    id: "page-1",
    title: "Sin título",
    kind: "page",
    version: 1,
    parentId: null,
    rootId: "page-1",
    ownerId: "user-1",
    role: "owner",
    isShared: false,
    updatedAt: "2026-10-02T10:00:00Z",
    ...overrides,
  };
}

function renderResults(
  pages: Array<PageSummary & { excerpt?: string }>,
  query: string,
) {
  return render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <MemoryRouter>
          <PageSearchResults pages={pages} query={query} empty="No results" />
        </MemoryRouter>
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
}

it("shows excerpt context, safely highlights literal case-insensitive query, and localizes the update date", () => {
  const result = page({
    excerpt:
      "HelloX is different; hello. appears near <img src=x onerror=alert(1)>",
  });
  renderResults([result], "Hello.");

  expect(screen.getByRole("status")).toHaveTextContent("1 result");
  expect(screen.getByRole("link", { name: /Sin título/ })).toBeVisible();
  const markedMatches = screen.getAllByText("hello.", { selector: "mark" });
  expect(markedMatches).toHaveLength(1);
  expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeVisible();
  expect(screen.queryByRole("img")).toBeNull();
  const formatted = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(new Date(result.updatedAt));
  expect(screen.getByText(`Updated: ${formatted}`)).toBeVisible();
  expect(screen.getByRole("link", { name: /Sin título/ })).toHaveAttribute(
    "href",
    "/pages/page-1",
  );
});

it("keeps the title when an older result has no excerpt and hides invalid update dates", () => {
  const result = page({ title: "Original title", updatedAt: "not-a-date" });
  renderResults([result], "Original");

  const link = screen.getByRole("link", { name: /Original title/ });
  expect(link).toBeVisible();
  expect(within(link).queryByText(/Updated:/)).toBeNull();
  expect(within(link).queryByText(/No results/)).toBeNull();
});

it("announces plural result counts accessibly", () => {
  renderResults(
    [page(), page({ id: "page-2", title: "Second page", rootId: "page-2" })],
    "page",
  );
  expect(screen.getByRole("status")).toHaveTextContent("2 results");
});
