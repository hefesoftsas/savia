import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { render } from "./locale-test-render";
import type { StudioObject } from "@savia/studio-shared/metadata";
import type { PageRun } from "../request-page-api";
import { setStudioRuntime } from "../runtime";
import RequestPage from "../request-page";

const state = vi.hoisted(() => ({
  callbacks: null as any,
  status: "live",
  durable: false,
}));
const requestPageApi = vi.hoisted(() => vi.fn());
const executeRequestPageAction = vi.hoisted(() => vi.fn());
vi.mock("@/realtime/use-realtime", () => ({
  useRealtimeTopics: (options: any) => {
    state.callbacks = options;
    return { status: state.status, lastEvent: null };
  },
}));
vi.mock("@/realtime/use-durable-realtime", () => ({
  useDurableRealtime: () => state.durable,
}));
vi.mock("../request-page-api", () => ({
  requestPageApi,
  executeRequestPageAction,
}));
vi.mock("../dynamic-form", () => ({
  default: ({
    onSave,
    submitLabel,
  }: {
    onSave: (values: Record<string, unknown>) => void;
    submitLabel: string;
  }) => (
    <button type="button" onClick={() => void onSave({})}>
      {submitLabel}
    </button>
  ),
}));
vi.mock("../lookup-actions", () => ({ LookupActions: () => null }));

afterEach(() => {
  cleanup();
  setStudioRuntime({ embedded: false });
  state.callbacks = null;
  state.status = "live";
  state.durable = false;
  vi.useRealTimers();
  requestPageApi.mockReset();
  executeRequestPageAction.mockReset();
});

const config = {
  studio: {
    requestPage: {
      version: 1,
      source: "savia-request",
      actions: [
        {
          id: "quote",
          operationId: "quote",
          label: "Cotizar",
          kind: "submit",
          input: {},
        },
      ],
    },
  },
};
function page(name: string): StudioObject {
  return {
    name,
    label: name,
    description: "",
    config,
  } as unknown as StudioObject;
}
function run(pageName: string, label: string): PageRun {
  return {
    id: `${pageName}-run`,
    tenantId: "0",
    pageName,
    actionId: "quote",
    label,
    mode: "mock",
    status: "complete",
    values: {},
    result: null,
    error: null,
    createdAt: "2026-10-30T00:00:00Z",
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

it.each(["live", "unavailable"])(
  "does not poll pending page runs while realtime is %s",
  async (status) => {
  vi.useFakeTimers();
  state.status = status;
  state.durable = false;
  const running = {
    ...run("first_page", "En curso"),
    status: "running" as const,
    createdAt: new Date().toISOString(),
  };
  requestPageApi.mockResolvedValue({ data: [running] });
  render(<RequestPage object={page("first_page")} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(requestPageApi).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300_000);
  });
  expect(requestPageApi).toHaveBeenCalledTimes(1);
  },
);

it("does not poll a pending page while its durable realtime connection is live", async () => {
  vi.useFakeTimers();
  state.durable = true;
  const running = {
    ...run("first_page", "En curso"),
    status: "running" as const,
    createdAt: new Date().toISOString(),
  };
  requestPageApi.mockResolvedValue({ data: [running] });
  render(<RequestPage object={page("first_page")} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(requestPageApi).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300_000);
  });
  expect(requestPageApi).toHaveBeenCalledTimes(1);
});

it("loads the page's runs from a principal realtime hint", async () => {
  requestPageApi
    .mockResolvedValueOnce({ data: [] })
    .mockResolvedValueOnce({ data: [run("first_page", "Actualizado remoto")] });
  render(<RequestPage object={page("first_page")} />);
  await waitFor(() =>
    expect(screen.queryByText("Cargando resultados…")).toBeNull(),
  );
  expect(state.callbacks.topics).toEqual(["request-pages"]);

  await act(async () =>
    state.callbacks.onEvent({
      topic: "request-pages",
      type: "updated",
      collection: "first_page",
    }),
  );
  await waitFor(() =>
    expect(screen.getByText("Actualizado remoto")).toBeTruthy(),
  );
});

it("drops an old page read and runs a catch-up read after a scope switch", async () => {
  const oldRead = deferred<{ data: PageRun[] }>();
  requestPageApi
    .mockResolvedValueOnce({
      data: [run("first_page", "Página actual antigua")],
    })
    .mockReturnValueOnce(oldRead.promise)
    .mockResolvedValueOnce({
      data: [run("second_page", "Solo página actual")],
    });
  const view = render(<RequestPage object={page("first_page")} />);
  await waitFor(() => expect(requestPageApi).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(screen.getByText("Página actual antigua")).toBeTruthy(),
  );

  await act(async () =>
    state.callbacks.onEvent({
      topic: "request-pages",
      type: "updated",
      collection: "first_page",
    }),
  );
  await waitFor(() => expect(requestPageApi).toHaveBeenCalledTimes(2));

  view.rerender(<RequestPage object={page("second_page")} />);
  expect(screen.queryByText("Página actual antigua")).toBeNull();
  expect(screen.queryByText("Página anterior")).toBeNull();
  await act(async () => {
    oldRead.resolve({ data: [run("first_page", "Página anterior")] });
  });
  await waitFor(() =>
    expect(screen.getByText("Solo página actual")).toBeTruthy(),
  );
  expect(screen.queryByText("Página anterior")).toBeNull();
  expect(requestPageApi).toHaveBeenCalledTimes(3);
  expect(requestPageApi.mock.calls[2][0]).toContain("pageName=second_page");
});

it("ignores a late action result after the page scope switches", async () => {
  const delayedAction = deferred<PageRun>();
  requestPageApi.mockResolvedValue({ data: [] });
  executeRequestPageAction.mockReturnValue(delayedAction.promise);
  const view = render(<RequestPage object={page("first_page")} />);
  await waitFor(() =>
    expect(screen.queryByText("Cargando resultados…")).toBeNull(),
  );

  fireEvent.click(screen.getByRole("button", { name: "Ejecutar" }));
  await waitFor(() => expect(executeRequestPageAction).toHaveBeenCalledOnce());
  expect(screen.getByRole("button", { name: "Cotizando…" })).toBeTruthy();
  view.rerender(<RequestPage object={page("second_page")} />);
  expect(screen.getByRole("button", { name: "Ejecutar" })).toBeTruthy();
  await act(async () => {
    delayedAction.resolve(run("first_page", "Ejecución tardía"));
  });

  expect(screen.queryByText("Ejecución tardía")).toBeNull();
  expect(requestPageApi.mock.calls.at(-1)?.[0]).toContain(
    "pageName=second_page",
  );
});
