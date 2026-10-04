import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "./locale-test-render";
import Workspace from "../plugin-project-workspace";
import { setStudioRuntime } from "../runtime";
const mocks = vi.hoisted(() => ({
  identity: vi.fn().mockResolvedValue({ id: "alice" }),
}));
vi.mock("@/features/assistant/assistant-context", () => ({
  useAppServices: () => ({
    apiClient: {},
    authSession: { getIdentity: mocks.identity },
  }),
}));
vi.mock("../plugin-ide", () => ({
  default: ({
    initialFiles,
    onDraftChange,
    onClose,
    saveStatus,
    backLabel,
  }: any) => (
    <div>
      <p data-testid="save-status">{saveStatus}</p>
      <textarea
        aria-label="source"
        defaultValue={initialFiles["entry.tsx"]}
        onChange={(event) =>
          onDraftChange({
            files: { ...initialFiles, "entry.tsx": event.target.value },
            history: [],
          })
        }
      />
      <button type="button" aria-label={backLabel} onClick={onClose}>
        Close editor
      </button>
    </div>
  ),
}));
const files = {
  "entry.tsx": "original",
  "savia-extension.json": "{}",
  "store.json": "{}",
  "preview.json": "{}",
};
const id = "d67c9667-4df6-48be-a94a-c2e28c88ea6b";
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});
it("resumes server drafts and saves through the original tenant transport after navigation", async () => {
  const calls: { path: string; body: any }[] = [];
  const transport = vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({
      path,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (path === "/api/plugin-projects")
      return Response.json({
        data: [{ id, label: "Draft", updatedAt: "today" }],
      });
    if (path.endsWith("/registry")) return Response.json({ canPublish: false });
    return Response.json({
      data: { id, files, history: [], version: init?.method === "PUT" ? 2 : 1 },
    });
  });
  setStudioRuntime({ embedded: true, tenantId: 1, pluginTransport: transport });
  const view = render(
    <Workspace tenantId={1} onClose={() => {}} onPublished={() => {}} />,
  );
  fireEvent.click(await screen.findByText("Draft"));
  fireEvent.change(await screen.findByLabelText("source"), {
    target: { value: "recovered edit" },
  });
  expect(screen.getByTestId("save-status")).toHaveTextContent("Guardando");
  await waitFor(() =>
    expect(
      localStorage.getItem(`savia:plugin-project:alice:1:${id}`),
    ).toContain("recovered edit"),
  );
  const other = vi.fn();
  setStudioRuntime({ embedded: true, tenantId: 2, pluginTransport: other });
  view.unmount();
  await waitFor(() =>
    expect(
      calls.some((call) => call.body?.files["entry.tsx"] === "recovered edit"),
    ).toBe(true),
  );
  expect(other).not.toHaveBeenCalled();
});
it("flushes editor changes and returns to the project list when the IDE closes", async () => {
  const writes: any[] = [];
  setStudioRuntime({
    embedded: true,
    tenantId: 1,
    pluginTransport: async (path, init) => {
      if (path === "/api/plugin-projects")
        return Response.json({ data: [{ id, label: "Draft" }] });
      if (path.endsWith("/registry"))
        return Response.json({ canPublish: false });
      if (init?.method === "PUT") {
        writes.push(JSON.parse(String(init.body)));
        return Response.json({
          data: { id, files, history: [], version: 2 },
        });
      }
      return Response.json({ data: { id, files, history: [], version: 1 } });
    },
  });
  render(<Workspace tenantId={1} onClose={() => {}} onPublished={() => {}} />);
  fireEvent.click(await screen.findByText("Draft"));
  fireEvent.change(await screen.findByLabelText("source"), {
    target: { value: "edited before close" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Volver a proyectos" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].files["entry.tsx"]).toBe("edited before close");
  expect(await screen.findByText("Tus proyectos de plugins")).toBeVisible();
});
it("loads the selected release source into a new project and clears the deep link", async () => {
  const calls: string[] = [];
  setStudioRuntime({
    embedded: true,
    tenantId: 1,
    pluginTransport: async (path, init) => {
      calls.push(path);
      if (path === "/api/plugin-projects") return Response.json({ data: [] });
      if (path.startsWith("/api/plugin-store/custom.demo/source?"))
        return Response.json({ data: { files, history: [] } });
      if (path.endsWith("/registry"))
        return Response.json({ canPublish: false });
      if (init?.method === "PUT") {
        return Response.json({
          data: {
            id: "new-draft",
            label: "Demo source",
            files: JSON.parse(String(init.body)).files,
            history: [],
            version: 1,
            updatedAt: "today",
          },
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  });
  const sourceOpened = vi.fn();
  render(
    <Workspace
      tenantId={1}
      source={{ id: "custom.demo", version: "1.0.0" }}
      onSourceOpened={sourceOpened}
      onClose={() => {}}
      onPublished={() => {}}
    />,
  );
  expect(await screen.findByLabelText("source")).toHaveValue("original");
  expect(
    calls.some(
      (path) => path === "/api/plugin-store/custom.demo/source?version=1.0.0",
    ),
  ).toBe(true);
  expect(sourceOpened).toHaveBeenCalledOnce();
});
it("lists and reopens a newly created project after returning from the IDE", async () => {
  const draftId = "new-draft";
  let exists = false;
  setStudioRuntime({
    embedded: true,
    tenantId: 1,
    pluginTransport: async (path, init) => {
      if (path === "/api/plugin-projects")
        return Response.json({
          data: exists
            ? [{ id: draftId, label: "New draft", updatedAt: "today" }]
            : [],
        });
      if (path === `/api/plugin-projects/${draftId}` && init?.method !== "PUT")
        return Response.json({
          data: {
            id: draftId,
            label: "New draft",
            files,
            history: [],
            version: 1,
          },
        });
      if (path.endsWith("/registry"))
        return Response.json({ canPublish: false });
      if (init?.method === "PUT") {
        exists = true;
        return Response.json({
          data: {
            id: draftId,
            label: "New draft",
            files,
            history: [],
            version: 1,
            updatedAt: "today",
          },
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  });
  render(<Workspace tenantId={1} onClose={() => {}} onPublished={() => {}} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Nuevo proyecto" }),
  );
  expect(await screen.findByLabelText("source")).toHaveValue("original");
  fireEvent.click(screen.getByRole("button", { name: "Volver a proyectos" }));
  fireEvent.click(await screen.findByRole("button", { name: "New draft" }));
  expect(await screen.findByLabelText("source")).toHaveValue("original");
});
it("recovers unsaved local content for the same owner and version", async () => {
  localStorage.setItem(
    `savia:plugin-project:alice:1:${id}`,
    JSON.stringify({
      files: { ...files, "entry.tsx": "offline edit" },
      history: [],
      version: 1,
    }),
  );
  setStudioRuntime({
    embedded: true,
    tenantId: 1,
    pluginTransport: async (path) =>
      Response.json(
        path === "/api/plugin-projects"
          ? { data: [{ id, label: "Draft" }] }
          : path.endsWith("/registry")
            ? { canPublish: false }
            : { data: { id, files, history: [], version: 1 } },
      ),
  });
  render(<Workspace tenantId={1} onClose={() => {}} onPublished={() => {}} />);
  fireEvent.click(await screen.findByText("Draft"));
  expect(await screen.findByLabelText("source")).toHaveValue("offline edit");
});
it("recovers a stale local version into a new project without overwriting the newer server draft", async () => {
  localStorage.setItem(
    `savia:plugin-project:alice:1:${id}`,
    JSON.stringify({
      files: { ...files, "entry.tsx": "stale local edit" },
      history: [],
      version: 1,
    }),
  );
  const writes: any[] = [];
  setStudioRuntime({
    embedded: true,
    tenantId: 1,
    pluginTransport: async (path, init) => {
      if (path === "/api/plugin-projects")
        return Response.json({ data: [{ id, label: "Draft" }] });
      if (path.endsWith("/registry"))
        return Response.json({ canPublish: false });
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        writes.push({ path, ...body });
        return Response.json({
          data: { ...body, id: path.split("/").pop(), version: 1 },
        });
      }
      return Response.json({ data: { id, files, history: [], version: 2 } });
    },
  });
  render(<Workspace tenantId={1} onClose={() => {}} onPublished={() => {}} />);
  fireEvent.click(await screen.findByText("Draft"));
  expect(await screen.findByLabelText("source")).toHaveValue(
    "stale local edit",
  );
  expect(writes).toHaveLength(1);
  expect(writes[0].path).not.toContain(id);
  expect(writes[0].version).toBe(0);
});
it("does not load another account’s browser recovery", async () => {
  localStorage.setItem(
    `savia:plugin-project:bob:1:${id}`,
    JSON.stringify({
      files: { ...files, "entry.tsx": "private bob draft" },
      history: [],
      version: 1,
    }),
  );
  setStudioRuntime({
    embedded: true,
    tenantId: 1,
    pluginTransport: async (path) =>
      Response.json(
        path === "/api/plugin-projects"
          ? { data: [{ id, label: "Draft" }] }
          : path.endsWith("/registry")
            ? { canPublish: false }
            : { data: { id, files, history: [], version: 1 } },
      ),
  });
  render(<Workspace tenantId={1} onClose={() => {}} onPublished={() => {}} />);
  fireEvent.click(await screen.findByText("Draft"));
  expect(await screen.findByLabelText("source")).toHaveValue("original");
});
it("closes on identity changes so reopening captures a fresh identity and request controller", async () => {
  const transport = vi.fn(async (path: string, _init?: RequestInit) =>
    Response.json(
      path === "/api/plugin-projects"
        ? { data: [{ id, label: "Draft" }] }
        : path.endsWith("/registry")
          ? { canPublish: false }
          : { data: { id, files, history: [], version: 1 } },
    ),
  );
  setStudioRuntime({ embedded: true, tenantId: 1, pluginTransport: transport });
  const close = vi.fn();
  const first = render(
    <Workspace tenantId={1} onClose={close} onPublished={() => {}} />,
  );
  await screen.findByText("Draft");
  fireEvent(window, new Event("savia:identity-changed"));
  expect(close).toHaveBeenCalledOnce();
  first.unmount();
  render(<Workspace tenantId={1} onClose={close} onPublished={() => {}} />);
  await screen.findByText("Draft");
  const signals = transport.mock.calls
    .map((call) => (call[1] as RequestInit)?.signal)
    .filter(Boolean);
  expect(signals.at(-1)?.aborted).toBe(false);
});
