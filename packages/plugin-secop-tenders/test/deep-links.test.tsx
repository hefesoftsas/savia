/** @vitest-environment jsdom */
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PluginApi } from "@savia/plugin-sdk";
import { render } from "../entry";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const row = {
  id: "source-1",
  process_id: "CO1.REQ.99",
  name: "Recovered tender",
};

function harness(initial: Record<string, string>) {
  const listeners = new Set<(state: Record<string, string>) => void>();
  let state = { ...initial };
  const route = {
    get: vi.fn(async () => ({ ...state })),
    set: vi.fn(async (next: Record<string, string>) => {
      state = { ...next };
      for (const listener of listeners) listener({ ...state });
    }),
    subscribe: vi.fn((listener: (state: Record<string, string>) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    navigate(next: Record<string, string>) {
      state = { ...next };
      for (const listener of listeners) listener({ ...state });
    },
  };
  const detail = vi.fn(async (_id: string, _request: unknown) => ({
    output: { data: [row] },
  }));
  const search = vi.fn(async () => ({ output: { data: [] } }));
  const action = vi.fn(async () => ({
    output: { status: 200, data: { data: null } },
  }));
  const element = document.createElement("div");
  document.body.append(element);
  const api = {
    route,
    i18n: {
      locale: "en",
      translate: (_catalog: unknown, key: string) =>
        ({
          deepLinkError: "Could not load this tender.",
          deepLinkLoading: "Loading tender…",
          deepLinkNotFound: "This tender could not be found in SECOP.",
          retry: "Retry",
          back: "Back to tenders",
        })[key] ?? key,
    },
    collections: {
      collection: () => ({ list: vi.fn().mockResolvedValue({ data: [] }) }),
    },
    actions: {
      execute: vi.fn((id: string, request: unknown) =>
        id === "detail"
          ? detail(id, request)
          : id === "search"
            ? search()
            : action(),
      ),
    },
  } as unknown as PluginApi;
  let cleanup: (() => void) | undefined;

  return {
    element,
    route,
    detail,
    search,
    async mount() {
      await act(async () => {
        cleanup = render(element, api);
      });
    },
    async navigate(next: Record<string, string>) {
      await act(async () => route.navigate(next));
    },
    async dispose() {
      await act(async () => cleanup?.());
      element.remove();
    },
  };
}

afterEach(() => vi.clearAllMocks());

it("restores a tender and selected tab from a fresh route without searching", async () => {
  const app = harness({ tender: row.process_id, tab: "documents" });
  await app.mount();
  expect(app.detail).toHaveBeenCalledWith(
    "detail",
    expect.objectContaining({ input: { id_del_proceso: row.process_id } }),
  );
  expect(app.search).not.toHaveBeenCalled();
  expect(app.element.textContent).toContain(row.name);
  expect(
    app.element.querySelector('[role="tab"][aria-selected="true"]')
      ?.textContent,
  ).toContain("Documents");
  await app.dispose();
});

it("tracks browser back and forward route changes without refetching the same tender", async () => {
  const app = harness({ tender: row.process_id, tab: "summary" });
  await app.mount();
  await app.navigate({ tender: row.process_id, tab: "requirements" });
  expect(
    app.element.querySelector('[role="tab"][aria-selected="true"]')
      ?.textContent,
  ).toContain("Requirements");
  expect(app.detail).toHaveBeenCalledTimes(1);
  await app.navigate({});
  expect(app.element.textContent).not.toContain(row.name);
  await app.navigate({ tender: row.process_id, tab: "documents" });
  expect(app.element.textContent).toContain(row.name);
  expect(app.detail).toHaveBeenCalledTimes(2);
  await app.dispose();
});

it("shows a retry for a failed deep-link lookup and retries by process ID", async () => {
  const app = harness({ tender: row.process_id, tab: "documents" });
  app.detail.mockRejectedValueOnce(new Error("SECOP unavailable"));
  await app.mount();
  expect(app.element.textContent).toContain("Could not load this tender");
  const retry = [...app.element.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Retry",
  );
  expect(retry).toBeDefined();
  app.detail.mockResolvedValueOnce({ output: { data: [row] } });
  await act(async () => retry!.click());
  expect(app.element.textContent).toContain(row.name);
  expect(app.detail).toHaveBeenCalledTimes(2);
  await app.dispose();
});

it("shows a localized not-found state when the detail action returns no tender", async () => {
  const app = harness({ tender: row.process_id, tab: "documents" });
  app.detail.mockResolvedValueOnce({ output: { data: [] } });
  await app.mount();
  expect(app.element.textContent).toContain(
    "This tender could not be found in SECOP.",
  );
  expect(app.element.textContent).not.toContain(row.name);
  await app.dispose();
});

it("rejects route IDs over the detail API limit without making a request", async () => {
  const app = harness({ tender: "x".repeat(201), tab: "documents" });
  await app.mount();
  expect(app.detail).not.toHaveBeenCalled();
  expect(app.element.textContent).toContain(
    "This tender could not be found in SECOP.",
  );
  await app.dispose();
});

it("does not render a detail response whose process ID differs from the route", async () => {
  const app = harness({ tender: "CO1.REQ.REQUESTED", tab: "documents" });
  app.detail.mockResolvedValueOnce({
    output: { data: [{ ...row, process_id: "CO1.REQ.OTHER" }] },
  });
  await app.mount();
  expect(app.element.textContent).toContain(
    "This tender could not be found in SECOP.",
  );
  expect(app.element.textContent).not.toContain(row.name);
  await app.dispose();
});

it("updates the route for tab navigation and clears only plugin state on Back", async () => {
  const app = harness({ tender: row.process_id, tab: "summary" });
  await app.mount();
  const documents = [...app.element.querySelectorAll('[role="tab"]')].find(
    (tab) => tab.textContent?.includes("Documents"),
  );
  await act(async () =>
    documents!.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  expect(app.route.set).toHaveBeenCalledWith({
    tender: row.process_id,
    tab: "documents",
  });
  const back = [...app.element.querySelectorAll("button")].find((button) =>
    button.textContent?.trim().includes("Back to tenders"),
  );
  await act(async () => back!.click());
  expect(app.route.set).toHaveBeenLastCalledWith({}, { replace: true });
  expect(app.element.textContent).not.toContain(row.name);
  await app.dispose();
});

it("ignores a late restore after the route changes to another tender", async () => {
  const app = harness({ tender: "CO1.REQ.OLD", tab: "summary" });
  let resolveOld!: (value: { output: { data: (typeof row)[] } }) => void;
  app.detail.mockImplementation((_id, request) =>
    (request as { input: { id_del_proceso: string } }).input.id_del_proceso ===
    "CO1.REQ.OLD"
      ? new Promise((resolve) => {
          resolveOld = resolve;
        })
      : Promise.resolve({
          output: {
            data: [{ ...row, process_id: "CO1.REQ.NEW", name: "New tender" }],
          },
        }),
  );
  await app.mount();
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(app.detail).toHaveBeenCalledWith(
    "detail",
    expect.objectContaining({ input: { id_del_proceso: "CO1.REQ.OLD" } }),
  );
  await app.navigate({ tender: "CO1.REQ.NEW", tab: "documents" });
  expect(app.element.textContent).toContain("New tender");
  await act(async () =>
    resolveOld({ output: { data: [{ ...row, name: "Old tender" }] } }),
  );
  expect(app.element.textContent).toContain("New tender");
  expect(app.element.textContent).not.toContain("Old tender");
  await app.dispose();
});

it("does not let a late route-read retry overwrite newer browser navigation", async () => {
  const app = harness({});
  app.route.get.mockRejectedValueOnce(new Error("route unavailable"));
  let resolveRetry!: (value: Record<string, string>) => void;
  app.route.get.mockImplementationOnce(
    () => new Promise((resolve) => (resolveRetry = resolve)),
  );
  app.detail.mockImplementation((_id, request) => {
    const processId = (request as { input: { id_del_proceso: string } }).input
      .id_del_proceso;
    return Promise.resolve({
      output: {
        data: [{ ...row, process_id: processId, name: `Tender ${processId}` }],
      },
    });
  });
  await app.mount();
  const retry = [...app.element.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Retry",
  );
  expect(retry).toBeDefined();
  await act(async () => retry!.click());
  await app.navigate({ tender: "CO1.REQ.NEW", tab: "documents" });
  expect(app.element.textContent).toContain("Tender CO1.REQ.NEW");
  await act(async () =>
    resolveRetry({ tender: "CO1.REQ.OLD", tab: "summary" }),
  );
  expect(app.element.textContent).toContain("Tender CO1.REQ.NEW");
  expect(app.element.textContent).not.toContain("Tender CO1.REQ.OLD");
  await app.dispose();
});

it("ignores an older route write failure after a newer tab navigation", async () => {
  const app = harness({ tender: row.process_id, tab: "summary" });
  let rejectOld!: (reason: Error) => void;
  app.route.set.mockImplementationOnce(
    () => new Promise((_, reject) => (rejectOld = reject)),
  );
  await app.mount();
  const documents = [...app.element.querySelectorAll('[role="tab"]')].find(
    (tab) => tab.textContent?.includes("Documents"),
  );
  await act(async () =>
    documents!.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  const requirements = [...app.element.querySelectorAll('[role="tab"]')].find(
    (tab) => tab.textContent?.includes("Requirements"),
  );
  await act(async () =>
    requirements!.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  await act(async () => rejectOld(new Error("old route write failed")));
  expect(
    app.element.querySelector('[role="tab"][aria-selected="true"]')
      ?.textContent,
  ).toContain("Requirements");
  expect(app.element.textContent).not.toContain("Could not load this tender");
  await app.dispose();
});
