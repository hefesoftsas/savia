// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "./locale-test-render";
import PluginIde from "../plugin-ide";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  requestResponse: vi.fn(),
  publish: vi.fn(),
  compile: vi.fn(),
  pack: vi.fn(),
}));
vi.mock("@/features/assistant/assistant-context", () => ({
  useAppServices: () => ({
    apiClient: {
      post: mocks.post,
      requestResponse: mocks.requestResponse,
    },
  }),
}));

function sseResponse(frames: unknown[], status = 200) {
  const text = frames
    .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
    .join("");
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function sseSuccess(
  message: string,
  files: Record<string, string>,
  usage = { input: 120, output: 45 },
) {
  const mid = Math.ceil(message.length / 2);
  return sseResponse([
    { type: "message", delta: message.slice(0, mid) },
    { type: "message", delta: message.slice(mid) },
    { type: "usage", ...usage },
    { type: "result", message, files },
  ]);
}

function sseErrorResponse(
  code: string,
  message: string,
  details?: unknown,
  status = 502,
) {
  return new Response(JSON.stringify({ error: { code, message, details } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function streamController() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const send = (frame: unknown) =>
    controller.enqueue(
      new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`),
    );
  return { response, send, close: () => controller.close() };
}

function streamPayload(callIndex = 0) {
  return JSON.parse(
    String(mocks.requestResponse.mock.calls[callIndex][1].body),
  );
}
vi.mock("../api", () => ({ pluginApi: mocks.publish }));
vi.mock("../monaco-code-editor", () => ({
  MonacoCodeEditor: ({ value, onChange, ariaLabel, readOnly }: any) => (
    <textarea
      aria-label={ariaLabel}
      value={value}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));
vi.mock("../plugin-ide-project", () => ({
  createPluginProject: () => ({
    "entry.tsx": "export function render() {}",
    "savia-extension.json": '{"id":"custom.demo","version":"1.0.0"}',
    "store.json": "{}",
    "preview.json": "{}",
  }),
  compilePluginProject: mocks.compile,
  packagePluginProject: mocks.pack,
  serializePluginProject: JSON.stringify,
  parsePluginProject: JSON.parse,
}));
vi.mock("../plugin-ide-preview", () => ({
  createPluginPreviewDocument: (
    _entry: string,
    _fixtures: unknown,
    _store: unknown,
    session: string,
  ) => session,
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function previewReady() {
  const frame = screen.getByTitle(
    "Vista previa del plugin",
  ) as HTMLIFrameElement;
  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: {
        type: "savia-plugin-ide",
        session: frame.getAttribute("srcdoc"),
        kind: "ready",
        message: "",
      },
    }),
  );
}

it("publishes only a successfully previewed revision and invalidates it after edits", async () => {
  mocks.compile.mockResolvedValue({
    entryJs: "compiled",
    fixtures: {},
    store: {},
  });
  mocks.pack.mockResolvedValue({
    entryJs: "compiled",
    manifest: { id: "custom.demo", version: "1.0.0" },
    blob: new Blob(["zip"]),
  });
  mocks.publish.mockResolvedValue({
    data: { id: "custom.demo", version: "1.0.0" },
  });
  render(<PluginIde tenantId={2} onClose={vi.fn()} onPublished={vi.fn()} />);
  expect(
    screen.getByRole("button", { name: "Publicar en el store" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Ejecutar vista previa" }),
  );
  await screen.findByTitle("Vista previa del plugin");
  previewReady();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Publicar en el store" }),
    ).toBeEnabled(),
  );
  fireEvent.change(
    screen.getByLabelText("entry.tsx", { selector: "textarea" }),
    {
      target: { value: "export function render() { return () => {}; }" },
    },
  );
  expect(
    screen.getByRole("button", { name: "Publicar en el store" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Ejecutar vista previa" }),
  );
  await screen.findByTitle("Vista previa del plugin");
  previewReady();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Publicar en el store" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Publicar en el store" }));
  expect(await screen.findByText(/custom.demo · 1.0.0/)).toBeInTheDocument();
  expect(mocks.publish).toHaveBeenCalledWith(
    "/plugin-store/upload",
    "POST",
    expect.any(FormData),
  );
});

it("keeps AI changes as a proposal until applied and supports undo", async () => {
  const files = {
    "entry.tsx": "export function render() { /* proposed */ }",
    "savia-extension.json": '{"id":"custom.demo","version":"1.0.0"}',
    "store.json": "{}",
    "preview.json": "{}",
  };
  mocks.requestResponse.mockResolvedValue(sseSuccess("Added a report", files));
  render(<PluginIde tenantId={2} onClose={vi.fn()} onPublished={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Describe tu plugin"), {
    target: { value: "Create a report" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Enviar a la IA" }));
  await screen.findByRole("button", { name: "Aplicar cambios" });
  expect(
    screen.getByLabelText("entry.tsx", { selector: "textarea" }),
  ).toHaveValue("export function render() {}");
  fireEvent.click(screen.getByRole("button", { name: "Aplicar cambios" }));
  expect(
    screen.getByLabelText("entry.tsx", { selector: "textarea" }),
  ).toHaveValue(files["entry.tsx"]);
  fireEvent.click(
    screen.getByRole("button", { name: "Deshacer cambios de IA" }),
  );
  expect(
    screen.getByLabelText("entry.tsx", { selector: "textarea" }),
  ).toHaveValue("export function render() {}");
});

it("preserves editable source and reports upload failures without claiming publication", async () => {
  mocks.compile.mockResolvedValue({
    entryJs: "compiled",
    fixtures: {},
    store: {},
  });
  mocks.pack.mockResolvedValue({
    entryJs: "compiled",
    manifest: { id: "custom.demo", version: "1.0.0" },
    blob: new Blob(["zip"]),
  });
  mocks.publish.mockRejectedValue(new Error("Version already exists"));
  render(<PluginIde tenantId={2} onClose={vi.fn()} onPublished={vi.fn()} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Ejecutar vista previa" }),
  );
  await screen.findByTitle("Vista previa del plugin");
  previewReady();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Publicar en el store" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Publicar en el store" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Version already exists",
  );
  expect(
    screen.getByLabelText("entry.tsx", { selector: "textarea" }),
  ).toHaveValue("export function render() {}");
});

it("ignores readiness messages from another frame and blocks publication after runtime errors", async () => {
  mocks.compile.mockResolvedValue({
    entryJs: "compiled",
    fixtures: {},
    store: {},
  });
  render(<PluginIde tenantId={2} onClose={vi.fn()} onPublished={vi.fn()} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Ejecutar vista previa" }),
  );
  const frame = (await screen.findByTitle(
    "Vista previa del plugin",
  )) as HTMLIFrameElement;
  const data = {
    type: "savia-plugin-ide",
    session: frame.getAttribute("srcdoc"),
    kind: "ready",
    message: "",
  };
  fireEvent(window, new MessageEvent("message", { source: window, data }));
  expect(
    screen.getByRole("button", { name: "Publicar en el store" }),
  ).toBeDisabled();
  previewReady();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Publicar en el store" }),
    ).toBeEnabled(),
  );
  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: { ...data, kind: "error", message: "Render failed" },
    }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Render failed");
  expect(
    screen.getByRole("button", { name: "Publicar en el store" }),
  ).toBeDisabled();
  previewReady();
  expect(
    screen.getByRole("button", { name: "Publicar en el store" }),
  ).toBeDisabled();
});

it("discards a cancelled AI response even if the transport completes later", async () => {
  let finish!: (value: unknown) => void;
  mocks.requestResponse.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<PluginIde tenantId={2} onClose={vi.fn()} onPublished={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Describe tu plugin"), {
    target: { value: "Create a report" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Enviar a la IA" }));
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
  finish(
    sseSuccess("Late response", {
      "entry.tsx": "export function render() {}",
      "savia-extension.json": "{}",
      "store.json": "{}",
      "preview.json": "{}",
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Enviar a la IA" }),
    ).toBeEnabled(),
  );
  expect(screen.queryByText("Late response")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Aplicar cambios" }),
  ).not.toBeInTheDocument();
});

it("does not upload if preview fails while the package is being prepared", async () => {
  mocks.compile.mockResolvedValue({
    entryJs: "compiled",
    fixtures: {},
    store: {},
  });
  let finish!: (value: unknown) => void;
  mocks.pack.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<PluginIde tenantId={2} onClose={vi.fn()} onPublished={vi.fn()} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Ejecutar vista previa" }),
  );
  const frame = (await screen.findByTitle(
    "Vista previa del plugin",
  )) as HTMLIFrameElement;
  previewReady();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Publicar en el store" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Publicar en el store" }));
  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: {
        type: "savia-plugin-ide",
        session: frame.getAttribute("srcdoc"),
        kind: "error",
        message: "Late render error",
      },
    }),
  );
  finish({
    entryJs: "compiled",
    manifest: { id: "custom.demo", version: "1.0.0" },
    blob: new Blob(["zip"]),
  });
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("El proyecto cambió"),
  );
  expect(mocks.publish).not.toHaveBeenCalled();
});

it("switches focused views and file selection without discarding source", () => {
  render(<PluginIde tenantId={2} onClose={vi.fn()} onPublished={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Código", exact: true }));
  expect(
    screen.getByRole("button", { name: "Código", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  fireEvent.change(
    screen.getByLabelText("entry.tsx", { selector: "textarea" }),
    {
      target: { value: "export function render() { /* edited */ }" },
    },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Archivos", exact: true }),
  );
  fireEvent.click(
    screen.getByRole("treeitem", { name: "preview.json", hidden: true }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Chat", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Código", exact: true }));
  fireEvent.click(
    screen.getByRole("button", { name: "Archivos", exact: true }),
  );
  fireEvent.click(
    screen.getByRole("treeitem", { name: "entry.tsx", hidden: true }),
  );
  expect(
    screen.getByLabelText("entry.tsx", { selector: "textarea" }),
  ).toHaveValue("export function render() { /* edited */ }");
});

it("shows the user message while generating and retries failure without duplicating history", async () => {
  let fail!: (reason: Error) => void;
  mocks.requestResponse.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  render(<PluginIde tenantId={2} onClose={vi.fn()} onPublished={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Chat", exact: true }));
  fireEvent.change(screen.getByLabelText("Describe tu plugin"), {
    target: { value: "Build a counter" },
  });
  fireEvent.keyDown(screen.getByLabelText("Describe tu plugin"), {
    key: "Enter",
  });
  expect(screen.getByText("Build a counter")).toBeInTheDocument();
  expect(screen.getByText("Generando propuesta…")).toBeInTheDocument();
  expect(screen.getByLabelText("Describe tu plugin")).toHaveValue("");
  await waitFor(() => expect(mocks.requestResponse).toHaveBeenCalled());
  fail(new Error("The model is temporarily unavailable"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The model is temporarily unavailable",
  );
  mocks.requestResponse.mockResolvedValue(
    sseSuccess("Ready", {
      "entry.tsx": "export function render() {}",
      "savia-extension.json": "{}",
      "store.json": "{}",
      "preview.json": "{}",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  await screen.findByText("Ready");
  expect(screen.getAllByText("Build a counter")).toHaveLength(1);
  expect(streamPayload(1)).toMatchObject({
    prompt: "Build a counter",
    history: [],
  });
});

it("keeps a pending proposal when a follow-up request fails and sends its code as context", async () => {
  const proposed = {
    "entry.tsx": "export function render() { /* proposal */ }",
    "savia-extension.json": "{}",
    "store.json": "{}",
    "preview.json": "{}",
  };
  mocks.requestResponse.mockResolvedValueOnce(
    sseSuccess("First proposal", proposed),
  );
  render(<PluginIde tenantId={2} onClose={vi.fn()} onPublished={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Chat", exact: true }));
  fireEvent.change(screen.getByLabelText("Describe tu plugin"), {
    target: { value: "Build a counter" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Enviar a la IA" }));
  await screen.findByRole("button", { name: "Aplicar cambios" });
  mocks.requestResponse.mockRejectedValueOnce(new Error("Try again later"));
  fireEvent.change(screen.getByLabelText("Describe tu plugin"), {
    target: { value: "Add a title" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Enviar a la IA" }));
  await screen.findByRole("alert");
  expect(streamPayload(1).files).toEqual(proposed);
  fireEvent.click(screen.getByRole("button", { name: "Aplicar cambios" }));
  expect(
    screen.getByLabelText("entry.tsx", { selector: "textarea" }),
  ).toHaveValue(proposed["entry.tsx"]);
});

it("moves editor tab selection with arrow keys", () => {
  render(<PluginIde tenantId={2} onClose={vi.fn()} onPublished={vi.fn()} />);
  const code = screen.getByRole("tab", { name: "entry.tsx" });
  code.focus();
  fireEvent.keyDown(code, { key: "ArrowRight" });
  const preview = screen.getByRole("tab", { name: "Vista previa" });
  expect(preview).toHaveFocus();
  expect(preview).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(preview, { key: "Home" });
  expect(code).toHaveFocus();
  expect(code).toHaveAttribute("aria-selected", "true");
});

it("runs preview while AI is pending without clearing the generation state", async () => {
  mocks.requestResponse.mockReturnValue(new Promise(() => {}));
  mocks.compile.mockResolvedValue({
    entryJs: "compiled",
    fixtures: {},
    store: {},
  });
  render(<PluginIde tenantId={2} onClose={vi.fn()} onPublished={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Chat", exact: true }));
  fireEvent.change(screen.getByLabelText("Describe tu plugin"), {
    target: { value: "Build a board" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Enviar a la IA" }));
  const run = screen.getByRole("button", { name: "Ejecutar vista previa" });
  expect(run).toBeEnabled();
  fireEvent.click(run);
  await screen.findByTitle("Vista previa del plugin");
  previewReady();
  fireEvent.click(screen.getByRole("button", { name: "Chat", exact: true }));
  expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Publicar en el store" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(
    screen.getByRole("button", { name: "Publicar en el store" }),
  ).toBeEnabled();
});

it("shows localized validation failure with file diagnostics and allows retry", async () => {
  mocks.requestResponse.mockResolvedValue(
    sseErrorResponse(
      "PLUGIN_AUTHORING_INVALID_OUTPUT",
      "Generated files failed validation",
      [
        {
          file: "store.json",
          path: "collections.0",
          message: "Invalid collection declaration",
        },
      ],
    ),
  );
  render(<PluginIde tenantId={2} onClose={vi.fn()} onPublished={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Chat", exact: true }));
  fireEvent.change(screen.getByLabelText("Describe tu plugin"), {
    target: { value: "Build a board" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Enviar a la IA" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(
    "La IA no consiguió generar archivos válidos",
  );
  expect(alert).toHaveTextContent(
    "store.json (collections.0): Invalid collection declaration",
  );
  expect(screen.getByRole("button", { name: "Reintentar" })).toBeEnabled();
  expect(
    screen.getByRole("button", { name: "Ejecutar vista previa" }),
  ).toBeEnabled();
});

it("streams the assistant message live and records token usage", async () => {
  const first = streamController();
  mocks.requestResponse.mockResolvedValue(first.response);
  render(<PluginIde tenantId={2} onClose={vi.fn()} onPublished={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Describe tu plugin"), {
    target: { value: "Build a board" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Enviar a la IA" }));
  first.send({ type: "message", delta: "Drafting" });
  await screen.findByText("Drafting");
  first.send({ type: "usage", input: 120, output: 5 });
  first.send({
    type: "result",
    message: "Drafting the board",
    files: {
      "entry.tsx": "export function render() {}",
      "savia-extension.json": "{}",
      "store.json": "{}",
      "preview.json": "{}",
    },
  });
  first.close();
  await screen.findByRole("button", { name: "Aplicar cambios" });
  expect(await screen.findByText("Drafting the board")).toBeInTheDocument();
  expect(screen.getByText("↑120")).toBeInTheDocument();
  expect(screen.getByText("↓5")).toBeInTheDocument();
  const payload = streamPayload(0);
  expect(payload.prompt).toBe("Build a board");
  for (const entry of payload.history) {
    expect(Object.keys(entry).sort()).toEqual(["content", "role"]);
  }
});

it("queues follow-ups while generating and sends them in order", async () => {
  const first = streamController();
  mocks.requestResponse.mockResolvedValueOnce(first.response);
  mocks.requestResponse.mockResolvedValueOnce(
    sseSuccess("Second done", {
      "entry.tsx": "export function render() {}",
      "savia-extension.json": "{}",
      "store.json": "{}",
      "preview.json": "{}",
    }),
  );
  render(<PluginIde tenantId={2} onClose={vi.fn()} onPublished={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Describe tu plugin"), {
    target: { value: "First request" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Enviar a la IA" }));
  fireEvent.change(screen.getByLabelText("Describe tu plugin"), {
    target: { value: "Second request" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Encolar mensaje" }));
  expect(screen.getByText("Tú · En cola")).toBeInTheDocument();
  expect(screen.getByLabelText("Describe tu plugin")).toHaveValue("");
  first.send({
    type: "result",
    message: "First done",
    files: {
      "entry.tsx": "export function render() {}",
      "savia-extension.json": "{}",
      "store.json": "{}",
      "preview.json": "{}",
    },
  });
  first.close();
  await waitFor(() => expect(mocks.requestResponse).toHaveBeenCalledTimes(2));
  expect(streamPayload(0).prompt).toBe("First request");
  expect(streamPayload(1).prompt).toBe("Second request");
  await screen.findByText("Second done");
  expect(screen.queryByText("Tú · En cola")).not.toBeInTheDocument();
});

it("carries each successful proposal and conversation into the next queued request", async () => {
  const first = streamController();
  const second = streamController();
  const third = streamController();
  const firstFiles = {
    "entry.tsx": "export function render() { /* first */ }",
    "savia-extension.json": "{}",
    "store.json": "{}",
    "preview.json": "{}",
  };
  const secondFiles = {
    ...firstFiles,
    "entry.tsx": "export function render() { /* second */ }",
  };
  mocks.requestResponse.mockResolvedValueOnce(first.response);
  mocks.requestResponse.mockResolvedValueOnce(second.response);
  mocks.requestResponse.mockResolvedValueOnce(third.response);
  render(<PluginIde tenantId={2} onClose={vi.fn()} onPublished={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Describe tu plugin"), {
    target: { value: "First request" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Enviar a la IA" }));
  for (const prompt of ["Second request", "Third request"]) {
    fireEvent.change(screen.getByLabelText("Describe tu plugin"), {
      target: { value: prompt },
    });
    fireEvent.click(screen.getByRole("button", { name: "Encolar mensaje" }));
  }
  first.send({ type: "result", message: "First done", files: firstFiles });
  first.close();

  await waitFor(() => expect(mocks.requestResponse).toHaveBeenCalledTimes(2));
  expect(streamPayload(1)).toMatchObject({
    prompt: "Second request",
    files: firstFiles,
    history: [
      { role: "user", content: "First request" },
      { role: "assistant", content: "First done" },
    ],
  });
  second.send({ type: "result", message: "Second done", files: secondFiles });
  second.close();
  await waitFor(() => expect(mocks.requestResponse).toHaveBeenCalledTimes(3));
  expect(streamPayload(2)).toMatchObject({
    prompt: "Third request",
    files: secondFiles,
    history: [
      { role: "user", content: "First request" },
      { role: "assistant", content: "First done" },
      { role: "user", content: "Second request" },
      { role: "assistant", content: "Second done" },
    ],
  });
  third.send({ type: "result", message: "Third done", files: secondFiles });
  third.close();
  await screen.findByText("Third done");
});

it("drains queued work after cancelling the current generation", async () => {
  const first = streamController();
  mocks.requestResponse.mockResolvedValueOnce(first.response);
  mocks.requestResponse.mockResolvedValueOnce(
    sseSuccess("Queued result", {
      "entry.tsx": "export function render() {}",
      "savia-extension.json": "{}",
      "store.json": "{}",
      "preview.json": "{}",
    }),
  );
  render(<PluginIde tenantId={2} onClose={vi.fn()} onPublished={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Describe tu plugin"), {
    target: { value: "Current request" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Enviar a la IA" }));
  fireEvent.change(screen.getByLabelText("Describe tu plugin"), {
    target: { value: "Queued request" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Encolar mensaje" }));
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));

  await waitFor(() => expect(mocks.requestResponse).toHaveBeenCalledTimes(2));
  expect(streamPayload(1).prompt).toBe("Queued request");
  await screen.findByText("Queued result");
});

it("keeps a full-queue prompt in the composer instead of discarding it", async () => {
  mocks.requestResponse.mockReturnValue(new Promise(() => {}));
  render(<PluginIde tenantId={2} onClose={vi.fn()} onPublished={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Describe tu plugin"), {
    target: { value: "Current request" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Enviar a la IA" }));
  for (let index = 1; index <= 5; index += 1) {
    const composer = screen.getByLabelText("Describe tu plugin");
    fireEvent.change(composer, { target: { value: `Queued ${index}` } });
    fireEvent.click(screen.getByRole("button", { name: "Encolar mensaje" }));
  }
  const composer = screen.getByLabelText("Describe tu plugin");
  fireEvent.change(composer, { target: { value: "Keep this prompt" } });
  fireEvent.click(screen.getByRole("button", { name: "Encolar mensaje" }));
  expect(composer).toHaveValue("Keep this prompt");
});
