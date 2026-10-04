// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "./locale-test-render";
import PluginIde from "../plugin-ide";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  publish: vi.fn(),
  compile: vi.fn(),
  pack: vi.fn(),
}));
vi.mock("@/features/assistant/assistant-context", () => ({
  useAppServices: () => ({ apiClient: { post: mocks.post } }),
}));
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
  fireEvent.change(screen.getByLabelText("entry.tsx"), {
    target: { value: "export function render() { return () => {}; }" },
  });
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
  mocks.post.mockResolvedValue({ message: "Added a report", files });
  render(<PluginIde tenantId={2} onClose={vi.fn()} onPublished={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Describe tu plugin"), {
    target: { value: "Create a report" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Enviar a la IA" }));
  await screen.findByRole("button", { name: "Aplicar cambios" });
  expect(screen.getByLabelText("entry.tsx")).toHaveValue(
    "export function render() {}",
  );
  fireEvent.click(screen.getByRole("button", { name: "Aplicar cambios" }));
  expect(screen.getByLabelText("entry.tsx")).toHaveValue(files["entry.tsx"]);
  fireEvent.click(
    screen.getByRole("button", { name: "Deshacer cambios de IA" }),
  );
  expect(screen.getByLabelText("entry.tsx")).toHaveValue(
    "export function render() {}",
  );
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
  expect(screen.getByLabelText("entry.tsx")).toHaveValue(
    "export function render() {}",
  );
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
  mocks.post.mockImplementation(
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
  finish({ message: "Late response", files: {} });
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
