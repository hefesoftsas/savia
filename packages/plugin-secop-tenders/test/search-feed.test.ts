import { afterEach, describe, expect, it, vi } from "vitest";
import { PAGE_SIZE, type SearchInput, type SearchPage } from "../logic";
import { SearchFeed } from "../search-feed";

function page(ids: string[], pageNumber: number, hasNext = true): SearchPage {
  return {
    data: ids.map((id) => ({ id })),
    page: pageNumber,
    perPage: PAGE_SIZE,
    hasNext,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("SearchFeed", () => {
  it("starts a fresh first page immediately and ignores a stale query response", async () => {
    const oldPage = deferred<SearchPage>();
    const calls: SearchInput[] = [];
    const feed = new SearchFeed((input) => {
      calls.push(input);
      return input.q === "old"
        ? oldPage.promise
        : Promise.resolve(page(["new"], 1));
    });

    const oldSearch = feed.search({ q: "old" });
    expect(feed.getSnapshot()).toMatchObject({
      result: null,
      criteria: { q: "old" },
      loading: true,
      searched: true,
    });

    await feed.search({ q: "new" });
    oldPage.resolve(page(["stale"], 1));
    await oldSearch;

    expect(calls).toEqual([
      { q: "old", page: 1, perPage: PAGE_SIZE },
      { q: "new", page: 1, perPage: PAGE_SIZE },
    ]);
    expect(feed.getSnapshot()).toMatchObject({
      result: page(["new"], 1),
      criteria: { q: "new" },
      loading: false,
      error: false,
    });
  });

  it("appends the next page, preserving first occurrences and newest metadata", async () => {
    const calls: SearchInput[] = [];
    const feed = new SearchFeed(async (input) => {
      calls.push(input);
      return input.page === 1
        ? { ...page(["a", "b"], 1), perPage: 2 }
        : { ...page(["b", "c"], 2, false), perPage: 2 };
    });

    await feed.search({ estado: "Publicado" });
    await feed.more();

    expect(calls[1]).toEqual({
      estado: "Publicado",
      page: 2,
      perPage: PAGE_SIZE,
    });
    expect(feed.getSnapshot().result).toEqual({
      data: [{ id: "a" }, { id: "b" }, { id: "c" }],
      page: 2,
      perPage: 2,
      hasNext: false,
    });
  });

  it("keeps rows and retries the same page after an append failure", async () => {
    const calls: SearchInput[] = [];
    let shouldFail = true;
    const feed = new SearchFeed(async (input) => {
      calls.push(input);
      if (input.page === 1) return page(["a"], 1);
      if (shouldFail) throw new Error("temporary failure");
      return page(["b"], 2, false);
    });

    await feed.search({ departamento: "Cundinamarca" });
    await feed.more();
    expect(feed.getSnapshot()).toMatchObject({
      result: page(["a"], 1),
      criteria: { departamento: "Cundinamarca" },
      loading: false,
      error: true,
    });

    shouldFail = false;
    await feed.more();
    expect(calls.map(({ page: pageNumber }) => pageNumber)).toEqual([1, 2, 2]);
    expect(feed.getSnapshot()).toMatchObject({
      result: page(["a", "b"], 2, false),
      error: false,
    });
  });

  it("retains requested criteria after a first-page failure and permits search retry", async () => {
    let attempts = 0;
    const feed = new SearchFeed(async (input) => {
      attempts += 1;
      if (attempts === 1) throw new Error("offline");
      return page([input.q ?? ""], 1, false);
    });

    await feed.search({ q: "bridges" });
    expect(feed.getSnapshot()).toMatchObject({
      result: null,
      criteria: { q: "bridges" },
      loading: false,
      error: true,
      searched: true,
    });
    await feed.search(feed.getSnapshot().criteria);
    expect(feed.getSnapshot()).toMatchObject({
      result: page(["bridges"], 1, false),
      error: false,
    });
  });

  it("prevents concurrent append calls and stops when a page adds no new IDs", async () => {
    let appendResolve!: (result: SearchPage) => void;
    const calls: SearchInput[] = [];
    const feed = new SearchFeed((input) => {
      calls.push(input);
      if (input.page === 1) return Promise.resolve(page(["same"], 1));
      return new Promise<SearchPage>((resolve) => {
        appendResolve = resolve;
      });
    });

    await feed.search({});
    const firstMore = feed.more();
    const concurrentMore = feed.more();
    expect(feed.getSnapshot().loading).toBe(true);
    await concurrentMore;
    expect(calls).toHaveLength(2);

    appendResolve(page(["same", "same"], 2, true));
    await firstMore;
    expect(feed.getSnapshot().result).toEqual(page(["same"], 2, false));
    await feed.more();
    expect(calls).toHaveLength(2);
  });

  it("forces an empty first page to be exhausted", async () => {
    const feed = new SearchFeed(async () => page([], 1, true));
    await feed.search({});
    expect(feed.getSnapshot().result?.hasNext).toBe(false);
    await feed.more();
    expect(feed.getSnapshot().result?.page).toBe(1);
  });

  it("invalidates pending work on cancel and supports later searches", async () => {
    const pending = deferred<SearchPage>();
    let calls = 0;
    const feed = new SearchFeed(() => {
      calls += 1;
      return calls === 1
        ? pending.promise
        : Promise.resolve(page(["later"], 1));
    });

    const pendingSearch = feed.search({ q: "cancelled" });
    feed.cancel();
    expect(feed.getSnapshot().loading).toBe(false);
    await feed.search({ q: "later" });
    pending.resolve(page(["stale"], 1));
    await pendingSearch;
    expect(feed.getSnapshot().result).toEqual(page(["later"], 1));
  });

  it("notifies subscribers and returns a stable snapshot between changes", async () => {
    const feed = new SearchFeed(async () => page([], 1, false));
    let notifications = 0;
    const unsubscribe = feed.subscribe(() => notifications++);
    const initial = feed.getSnapshot();
    expect(feed.getSnapshot()).toBe(initial);
    await feed.search({});
    unsubscribe();
    expect(notifications).toBeGreaterThan(0);
    expect(feed.getSnapshot()).not.toBe(initial);
  });

  it("preserves a search started synchronously by a completion subscriber", async () => {
    const secondPage = deferred<SearchPage>();
    const feed = new SearchFeed((input) =>
      input.q === "first"
        ? Promise.resolve(page(["first"], 1, false))
        : secondPage.promise,
    );
    let startedSecondSearch = false;
    let secondSearch: Promise<void> | undefined;
    feed.subscribe(() => {
      if (
        !startedSecondSearch &&
        feed.getSnapshot().result?.data[0]?.id === "first"
      ) {
        startedSecondSearch = true;
        secondSearch = feed.search({ q: "second" });
      }
    });

    await feed.search({ q: "first" });
    expect(feed.getSnapshot().loading).toBe(true);
    secondPage.resolve(page(["second"], 1, false));
    await secondSearch;
    expect(feed.getSnapshot().result?.data[0]?.id).toBe("second");
  });
});

describe("transient SECOP failures", () => {
  afterEach(() => vi.useRealTimers());

  it("recovers a failed next page once without advancing its offset or losing rows", async () => {
    vi.useFakeTimers();
    const calls: SearchInput[] = [];
    let failures = 0;
    const feed = new SearchFeed(async (input) => {
      calls.push(input);
      if (input.page === 1) return page(["first"], 1);
      if (failures++ === 0)
        throw Object.assign(new Error("upstream unavailable"), { status: 502 });
      return page(["second"], 2, false);
    });
    await feed.search({ estado: "Publicado" });
    const loading = feed.more();
    await vi.runAllTimersAsync();
    await loading;
    expect(calls).toEqual([
      { estado: "Publicado", page: 1, perPage: 20 },
      { estado: "Publicado", page: 2, perPage: 20 },
      { estado: "Publicado", page: 2, perPage: 20 },
    ]);
    expect(feed.getSnapshot()).toMatchObject({
      result: page(["first", "second"], 2, false),
      error: false,
    });
  });

  it("bounds retries and reports a timeout while keeping the loaded page", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const feed = new SearchFeed(async (input) => {
      if (input.page === 1) return page(["first"], 1);
      attempts++;
      throw Object.assign(new Error("MCP timeout"), { status: 504 });
    });
    await feed.search({});
    const loading = feed.more();
    await vi.runAllTimersAsync();
    await loading;
    expect(attempts).toBe(2);
    expect(feed.getSnapshot()).toMatchObject({
      result: page(["first"], 1),
      error: true,
      errorKind: "timeout",
      loading: false,
    });
  });

  it("does not retry a source requiring authorization", async () => {
    let attempts = 0;
    const feed = new SearchFeed(async () => {
      attempts++;
      throw Object.assign(new Error("unauthorized"), { status: 401 });
    });
    await feed.search({});
    expect(attempts).toBe(1);
    expect(feed.getSnapshot()).toMatchObject({
      error: true,
      errorKind: "authorization",
    });
  });

  it("does not retry an obsolete query after its backoff expires", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const feed = new SearchFeed(async (input) => {
      calls.push(input.q ?? "");
      if (input.q === "old")
        throw Object.assign(new Error("temporary"), { status: 503 });
      return page(["new"], 1, false);
    });
    const old = feed.search({ q: "old" });
    await Promise.resolve();
    await feed.search({ q: "new" });
    await vi.runAllTimersAsync();
    await old;
    expect(calls).toEqual(["old", "new"]);
    expect(feed.getSnapshot()).toMatchObject({
      result: page(["new"], 1, false),
      error: false,
      loading: false,
    });
  });
});
