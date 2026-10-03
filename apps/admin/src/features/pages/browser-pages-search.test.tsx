import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { PagesClient, PageDocument } from "./client";
import { BrowserPagesSearch } from "./browser-pages-search";
import { publishPageChange } from "./page-events";

class ControlledWorker {
  static instances: ControlledWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    ControlledWorker.instances.push(this);
  }
  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

function summary(id: string, version = 1, kind: "page" | "folder" = "page") {
  return {
    id,
    title: `Page ${id}`,
    kind,
    version,
    parentId: null,
    rootId: id,
    ownerId: "owner",
    role: "owner",
    isShared: false,
    updatedAt: "2026-10-01T00:00:00Z",
  } as const;
}

function document(id: string, version = 1, title = `Page ${id}`): PageDocument {
  return {
    ...summary(id, version, "page"),
    title,
    content: [{ type: "p", children: [{ text: `Body ${id}` }] }],
  } as PageDocument;
}

function mockClient(overrides: Partial<PagesClient> = {}) {
  return {
    api: {} as PagesClient["api"],
    list: vi.fn(async () => [summary("one")]),
    get: vi.fn(async (id: string) => document(id)),
    ...overrides,
  } as unknown as PagesClient;
}

function renderSearch(client: PagesClient) {
  return render(
    <MemoryRouter>
      <BrowserPagesSearch client={client} getScope={async () => "user:api"} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  ControlledWorker.instances = [];
  vi.stubGlobal("Worker", ControlledWorker);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("reuses unchanged pages and fetches only documents requested by the cache plan", async () => {
  const client = mockClient({
    list: vi.fn(async () => [summary("same", 4), summary("changed", 8)]),
    get: vi.fn(async (id: string) => document(id, 8)),
  });
  renderSearch(client);
  const worker = ControlledWorker.instances[0];
  await waitFor(() =>
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: "open",
      scope: "user:api",
      pages: [
        { id: "same", title: "Page same", version: 4 },
        { id: "changed", title: "Page changed", version: 8 },
      ],
    }),
  );
  act(() =>
    worker.emit({ type: "plan", needed: ["changed"], reused: 1, total: 2 }),
  );
  await waitFor(() =>
    expect(client.get).toHaveBeenCalledExactlyOnceWith("changed"),
  );
  expect(client.get).not.toHaveBeenCalledWith("same");
  expect(worker.postMessage).toHaveBeenCalledWith({
    type: "upsert",
    page: {
      id: "changed",
      title: "Page changed",
      content: expect.any(Array),
      version: 8,
    },
  });
  expect(worker.postMessage).not.toHaveBeenCalledWith({ type: "finish" });
  act(() => worker.emit({ type: "updated", id: "changed" }));
  await waitFor(() =>
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "finish" }),
  );
  act(() => worker.emit({ type: "ready", total: 2, reused: 1, elapsedMs: 12 }));
  expect(await screen.findByText(/1 reused/)).toBeInTheDocument();
});

it("cancels page reads and ignores the late response", async () => {
  let finishRead!: (page: PageDocument) => void;
  const client = mockClient({
    get: vi.fn(
      () => new Promise<PageDocument>((resolve) => (finishRead = resolve)),
    ),
  });
  renderSearch(client);
  const worker = ControlledWorker.instances[0];
  await waitFor(() =>
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "open" }),
    ),
  );
  act(() =>
    worker.emit({ type: "plan", needed: ["one"], reused: 0, total: 1 }),
  );
  expect(await screen.findByText(/Reading pages: 0 of 1/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel indexing" }));
  expect(worker.terminate).toHaveBeenCalledOnce();
  finishRead(document("one"));
  await act(async () => Promise.resolve());
  expect(worker.postMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "upsert" }),
  );
  expect(screen.getByRole("status")).toHaveTextContent("Indexing cancelled");
});

it("reopens the existing cache for incremental update after a page change", async () => {
  const client = mockClient();
  renderSearch(client);
  const firstWorker = ControlledWorker.instances[0];
  await waitFor(() =>
    expect(firstWorker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "open" }),
    ),
  );
  act(() => {
    firstWorker.emit({ type: "plan", needed: [], reused: 1, total: 1 });
    firstWorker.emit({ type: "ready", total: 1, reused: 1, elapsedMs: 2 });
  });
  act(() => publishPageChange({ api: client.api }));
  expect(screen.getByText(/Pages may have changed/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Update index" }));
  const updatedWorker = ControlledWorker.instances[1];
  await waitFor(() =>
    expect(updatedWorker.postMessage).toHaveBeenCalledWith({
      type: "open",
      scope: "user:api",
      pages: [{ id: "one", title: "Page one", version: 1 }],
    }),
  );
});

it("stops fetching stale hits when the query changes during result revalidation", async () => {
  let resolveFirstGet!: (page: PageDocument) => void;
  const client = mockClient({
    list: vi.fn(async () => [summary("first"), summary("remaining")]),
    get: vi.fn((id: string): Promise<PageDocument> => {
      if (id === "first")
        return new Promise((resolve) => {
          resolveFirstGet = resolve;
        });
      return Promise.resolve(document(id));
    }),
  });
  renderSearch(client);
  const worker = ControlledWorker.instances[0];
  await waitFor(() =>
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "open" }),
    ),
  );
  act(() => {
    worker.emit({ type: "plan", needed: [], reused: 2, total: 2 });
    worker.emit({ type: "ready", total: 2, reused: 2, elapsedMs: 3 });
  });

  const input = screen.getByRole("textbox", { name: "Search page content" });
  fireEvent.change(input, { target: { value: "first query" } });
  await waitFor(() =>
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "search", term: "first query" }),
    ),
  );
  const firstSearch = worker.postMessage.mock.calls.at(-1)?.[0] as {
    requestId: number;
  };
  act(() =>
    worker.emit({
      type: "results",
      requestId: firstSearch.requestId,
      hits: [
        { id: "first", score: 1 },
        { id: "remaining", score: 0.8 },
      ],
      elapsedMs: 1,
    }),
  );
  await waitFor(() => expect(client.get).toHaveBeenCalledWith("first"));

  fireEvent.change(input, { target: { value: "new query" } });
  expect(worker.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: "cancel-search" }),
  );
  await act(async () => {
    resolveFirstGet(document("first"));
    await Promise.resolve();
  });
  expect(client.get).not.toHaveBeenCalledWith("remaining");
  expect(
    screen.queryByRole("link", { name: "Page first" }),
  ).not.toBeInTheDocument();
});

it("revalidates returned ids, kinds, versions, and stale requests before displaying authorized content", async () => {
  const client = mockClient({
    list: vi.fn(async () => [
      summary("current", 2),
      summary("stale", 3),
      summary("folder", 1, "folder"),
    ]),
    get: vi.fn(async (id: string) => {
      if (id === "stale") return document(id, 4);
      return document(id, id === "current" ? 2 : 3, `Authorized ${id}`);
    }),
  });
  renderSearch(client);
  const worker = ControlledWorker.instances[0];
  await waitFor(() =>
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "open" }),
    ),
  );
  act(() => worker.emit({ type: "plan", needed: [], reused: 2, total: 2 }));
  act(() => worker.emit({ type: "ready", total: 2, reused: 2, elapsedMs: 3 }));
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search page content" }),
    { target: { value: "first" } },
  );
  await waitFor(() =>
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "search", term: "first" }),
    ),
  );
  const first = worker.postMessage.mock.calls.at(-1)?.[0] as {
    requestId: number;
  };
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search page content" }),
    { target: { value: "second" } },
  );
  await waitFor(() =>
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "search", term: "second" }),
    ),
  );
  const second = worker.postMessage.mock.calls.at(-1)?.[0] as {
    requestId: number;
  };
  act(() => {
    worker.emit({
      type: "results",
      requestId: first.requestId,
      hits: [{ id: "current", score: 1 }],
      elapsedMs: 1,
    });
    worker.emit({
      type: "results",
      requestId: second.requestId,
      hits: [
        { id: "current", score: 1 },
        { id: "stale", score: 0.8 },
        { id: "folder", score: 0.7 },
      ],
      elapsedMs: 2,
    });
  });
  expect(
    await screen.findByRole("link", { name: "Authorized current" }),
  ).toBeInTheDocument();
  await waitFor(() => expect(client.get).toHaveBeenCalledWith("stale"));
  expect(
    screen.queryByRole("link", { name: "Authorized stale" }),
  ).not.toBeInTheDocument();
  expect(client.get).not.toHaveBeenCalledWith("folder");
  expect(screen.getByText("Body current")).toBeInTheDocument();
});
