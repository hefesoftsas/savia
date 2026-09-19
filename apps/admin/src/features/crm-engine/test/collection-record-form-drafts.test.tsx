// @vitest-environment jsdom
import React from "react";
import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "../api";
import CollectionRecordForm from "../collection-record-form";
import {
  createRelatedRecordDraft,
  clearRelatedRecordDrafts,
} from "../related-record-drafts";
import { makeConfig } from "@savia/crm-shared/metadata";
const state = vi.hoisted(() => ({ scope: "", props: undefined as any }));
vi.mock("../runtime", () => ({
  getCrmRuntime: () => ({
    apiBasePath: "/v1/dynamic-crm/test",
    localWorkspace: state.scope
      ? { scope: state.scope, syncNow: async () => undefined }
      : undefined,
  }),
}));
vi.mock("../api", () => ({
  api: vi.fn(async (path: string) =>
    path === "/records/parents/parent"
      ? { data: { id: "parent", name: "Reloaded", _version: 12 } }
      : path === "/collection-relations"
        ? {
            data: [
              {
                id: "r1",
                sourceObject: "parents",
                targetObject: "children",
                storage: "local",
                cardinality: "one-to-many",
              },
            ],
          }
        : {
            data: [
              {
                definition: { id: "r1", storage: "local" },
                records: [{ id: "new-link" }],
                total: 1,
              },
            ],
          },
  ),
}));
vi.mock("../dynamic-form", () => ({
  default: (props: any) => {
    state.props = props;
    React.useEffect(() => props.onValuesChange?.(props.values), [props.values]);
    return (
      <>
        <input
          aria-label="name"
          value={props.values.name ?? ""}
          onChange={(event) =>
            props.onValuesChange({ ...props.values, name: event.target.value })
          }
        />
        <button onClick={() => void props.onSave({}).catch(() => {})}>
          Save
        </button>
      </>
    );
  },
}));
const object = {
  name: "parents",
  label: "Parents",
  description: "",
  config: makeConfig({
    name: { type: "Textbox", label: "Name" },
    children: {
      type: "Textbox",
      label: "Children",
      config: { collectionRelation: "r1", relationPresentation: "table" },
    },
  }),
};
const scope = (user = "user") =>
  JSON.stringify([
    JSON.stringify(["wrapper-drafts", user]),
    "/v1/dynamic-crm/test",
    { role: "editor" },
  ]);
const key = () => ({
  workspaceScope: state.scope,
  object: "parents",
  recordId: "parent",
});
function mount(
  save = vi.fn().mockResolvedValue({ id: "parent", _version: 10 }),
) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <CollectionRecordForm
        object={object}
        values={{ id: "parent", name: "Server", _version: 9 }}
        onSave={save}
      />
    </QueryClientProvider>,
  );
}
const stored = {
  values: {
    id: "parent",
    name: "Draft",
    _version: 3,
    children: [{ id: "child", _version: 2, data: { name: "Child draft" } }],
  },
  previous: { id: "parent", _version: 3 },
  previousIds: { r1: ["child"] },
  idempotencyKey: "stable-retry-key",
};
async function seed() {
  const draft = createRelatedRecordDraft(key());
  draft.schedule(stored);
  await draft.close();
}
afterEach(async () => {
  cleanup();
  await clearRelatedRecordDrafts("wrapper-drafts");
  vi.clearAllMocks();
});
it("restores the original parent, child and selection versions without rebasing and retains retry identity on failure", async () => {
  state.scope = scope();
  await seed();
  const save = vi
    .fn()
    .mockRejectedValue(new Error("Resolve the overlapping pending form first"));
  mount(save);
  await screen.findByDisplayValue("Draft");
  expect(state.props.values.children).toEqual(stored.values.children);
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][0]).toEqual({ name: "Draft" });
  expect(save.mock.calls[0][1]).toEqual(stored.previous);
  expect(save.mock.calls[0][2][0].previousIds).toEqual(["child"]);
  expect(save.mock.calls[0][3]).toEqual({ idempotencyKey: "stable-retry-key" });
  const reader = createRelatedRecordDraft(key());
  expect((await reader.read())?.value).toMatchObject({
    idempotencyKey: "stable-retry-key",
  });
  await reader.close();
  cleanup();
  mount(save);
  await screen.findByDisplayValue("Draft");
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1][3]).toEqual(save.mock.calls[0][3]);
});
it("clears durable state only after the local queue commits", async () => {
  state.scope = scope();
  await seed();
  let commit!: (record: unknown) => void;
  const save = vi.fn().mockImplementation(
    () =>
      new Promise((resolve) => {
        commit = resolve;
      }),
  );
  mount(save);
  await screen.findByDisplayValue("Draft");
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(save).toHaveBeenCalled());
  const pendingReader = createRelatedRecordDraft(key());
  expect(await pendingReader.read()).toBeDefined();
  await pendingReader.close();
  commit({ id: "parent", _version: 4, _localPending: true });
  await waitFor(() =>
    expect(screen.queryByText(/Borrador recuperado/)).not.toBeInTheDocument(),
  );
  const reader = createRelatedRecordDraft(key());
  expect(await reader.read()).toBeUndefined();
  await reader.close();
});
it("isolates users and supports explicit discard", async () => {
  state.scope = scope();
  await seed();
  state.scope = scope("other");
  mount();
  await screen.findByDisplayValue("Server");
  cleanup();
  state.scope = scope();
  mount();
  await screen.findByDisplayValue("Draft");
  fireEvent.click(screen.getByText("Descartar borrador y recargar"));
  await screen.findByDisplayValue("Reloaded");
  expect(state.props.values._version).toBe(12);
  expect(state.props.values.children).toEqual([{ id: "new-link" }]);
});
it("does not restore persisted drafts without an authenticated workspace", async () => {
  state.scope = scope();
  await seed();
  state.scope = "";
  mount();
  await screen.findByDisplayValue("Server");
  expect(screen.queryByText(/Borrador recuperado/)).not.toBeInTheDocument();
});
it("flushes edited parent and staged child rows on close before restoring", async () => {
  state.scope = scope();
  const view = mount();
  await screen.findByDisplayValue("Server");
  state.props.onValuesChange({
    id: "parent",
    name: "Unsaved",
    _version: 9,
    children: [{ clientId: "local-child", data: { name: "New child" } }],
  });
  view.unmount();
  mount();
  await screen.findByDisplayValue("Unsaved");
  expect(state.props.values.children).toEqual([
    { clientId: "local-child", data: { name: "New child" } },
  ]);
});

it("retains the draft if discard cannot reload the server baseline", async () => {
  state.scope = scope();
  await seed();
  mount();
  await screen.findByDisplayValue("Draft");
  vi.mocked(api).mockRejectedValueOnce(new Error("Reload offline"));
  fireEvent.click(screen.getByText("Descartar borrador y recargar"));
  await screen.findByText("Reload offline");
  expect(screen.getByDisplayValue("Draft")).toBeInTheDocument();
  const reader = createRelatedRecordDraft(key());
  expect((await reader.read())?.value).toMatchObject({
    idempotencyKey: "stable-retry-key",
  });
  await reader.close();
});

it("omits read-only parent defaults from new bundled submissions", async () => {
  state.scope = scope();
  const save = vi.fn().mockResolvedValue({ id: "created", _version: 1 });
  const withReadonly = {
    ...object,
    config: {
      ...object.config,
      fields: {
        ...object.config.fields,
        status: { type: "Textbox", label: "Status", readOnly: true },
      },
    },
  };
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <CollectionRecordForm
        object={withReadonly}
        values={{ name: "New parent", status: "System default" }}
        onSave={save}
      />
    </QueryClientProvider>,
  );
  await screen.findByDisplayValue("New parent");
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][0]).toEqual({ name: "New parent" });
});

it("restores an existing draft while live record links are offline", async () => {
  state.scope = scope();
  await seed();
  const implementation = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (path, ...args) => {
    if (path.startsWith("/record-links/")) throw new Error("Links offline");
    return implementation(path, ...args);
  });
  const save = vi.fn().mockRejectedValue(new Error("offline"));
  mount(save);
  await screen.findByDisplayValue("Draft");
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][2][0].previousIds).toEqual(["child"]);
  vi.mocked(api).mockImplementation(implementation);
});
