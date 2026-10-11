import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { render } from "./locale-test-render";
import { PluginEditorExtensionsPanel } from "../plugin-editor-extensions-panel";
import type { PluginEditorExtensionClient } from "../plugin-editor-extension-client";

afterEach(cleanup);

it("filters the verified catalog and enables then disables an extension by ID", () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <PluginEditorExtensionsPanel enabled={[]} onChange={onChange} />,
    { locale: "en" },
  );

  expect(
    screen.getByRole("heading", { name: "Extensions" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Catalog of VS Code web extensions/),
  ).toBeInTheDocument();
  expect(screen.getByText("Prettier")).toBeInTheDocument();
  expect(screen.getByText("React snippets")).toBeInTheDocument();

  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search extensions" }),
    {
      target: { value: "useState" },
    },
  );
  expect(screen.getByText("React snippets")).toBeInTheDocument();
  expect(screen.queryByText("Prettier")).not.toBeInTheDocument();

  fireEvent.click(
    screen.getByRole("button", { name: "Enable React snippets" }),
  );
  expect(onChange).toHaveBeenLastCalledWith(["savia.react-snippets"]);

  rerender(
    <PluginEditorExtensionsPanel
      enabled={["savia.react-snippets"]}
      onChange={onChange}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Enabled");
  fireEvent.click(
    screen.getByRole("button", { name: "Disable React snippets" }),
  );
  expect(onChange).toHaveBeenLastCalledWith([]);
});

it("disables catalog actions and localizes the panel", () => {
  render(
    <PluginEditorExtensionsPanel enabled={[]} onChange={vi.fn()} disabled />,
    { locale: "pt" },
  );

  expect(
    screen.getByRole("heading", { name: "Extensões" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("searchbox", { name: "Buscar extensões" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Ativar Prettier" }),
  ).toBeDisabled();
});

const compatibleInspection = {
  inspectionId: "inspection-1",
  metadata: {
    id: "Acme.example",
    publisher: "Acme",
    name: "example",
    version: "1.0.0",
    sha256: "a".repeat(64),
    license: "MIT",
    compressedBytes: 12,
    expandedBytes: 24,
    dependencies: [],
    compatibility: { supported: true, reason: null },
  },
  manifestSummary: {
    description: "Example extension",
    categories: [],
    contributes: {},
  },
};
const installedExample = {
  ...compatibleInspection.metadata,
  installationId: "f3286d10-a0b8-48c8-ad88-c6adbe54fa01",
  source: "open-vsx" as const,
  createdAt: "2026-10-11T00:00:00.000Z",
};

it("searches, inspects, installs explicitly, and persists enable and disable changes", async () => {
  const onInstalledChange = vi.fn().mockResolvedValue(undefined);
  const client = {
    search: vi.fn().mockResolvedValue({
      results: [
        {
          publisher: "Acme",
          name: "example",
          version: "1.0.0",
          displayName: "Example",
          description: "A browser tool",
          license: "MIT",
        },
      ],
      offset: 0,
      totalSize: 1,
      nextOffset: null,
    }),
    inspectMarketplace: vi.fn().mockResolvedValue(compatibleInspection),
    install: vi.fn().mockResolvedValue(installedExample),
    list: vi.fn().mockResolvedValue([installedExample]),
    uninstall: vi.fn().mockResolvedValue(undefined),
  } as unknown as PluginEditorExtensionClient;
  const { rerender } = render(
    <PluginEditorExtensionsPanel
      enabled={[]}
      onChange={vi.fn()}
      client={client}
      installedReferences={[]}
      onInstalledChange={onInstalledChange}
      runtimeAvailable
    />,
    { locale: "en" },
  );

  fireEvent.change(screen.getByRole("searchbox", { name: "Search Open VSX" }), {
    target: { value: "example" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(await screen.findByText("A browser tool")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Inspect version" }));
  expect(
    await screen.findByText("Compatible with this editor."),
  ).toBeInTheDocument();
  expect(client.install).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Install" }));
  await waitFor(() =>
    expect(client.install).toHaveBeenCalledWith("inspection-1"),
  );
  await screen.findByRole("tab", { name: "Installed" });

  fireEvent.click(await screen.findByRole("button", { name: "Enable" }));
  await waitFor(() =>
    expect(onInstalledChange).toHaveBeenLastCalledWith([
      {
        installationId: installedExample.installationId,
        sha256: installedExample.sha256,
      },
    ]),
  );
  rerender(
    <PluginEditorExtensionsPanel
      enabled={[]}
      onChange={vi.fn()}
      client={client}
      installedReferences={[
        {
          installationId: installedExample.installationId,
          sha256: installedExample.sha256,
        },
      ]}
      onInstalledChange={onInstalledChange}
      runtimeAvailable
    />,
  );
  expect(screen.getByText("Enabled")).toBeInTheDocument();
  expect(screen.queryByText("Activation pending")).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Disable" }));
  await waitFor(() => expect(onInstalledChange).toHaveBeenLastCalledWith([]));
});

it("shows activation pending until the reference synchronization finishes", async () => {
  let finishChange!: () => void;
  const onInstalledChange = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishChange = resolve;
      }),
  );
  const client = {
    list: vi.fn().mockResolvedValue([installedExample]),
  } as unknown as PluginEditorExtensionClient;
  const { rerender } = render(
    <PluginEditorExtensionsPanel
      enabled={[]}
      onChange={vi.fn()}
      client={client}
      installedReferences={[]}
      onInstalledChange={onInstalledChange}
      runtimeAvailable
    />,
    { locale: "en" },
  );
  fireEvent.click(screen.getByRole("tab", { name: "Installed" }));
  fireEvent.click(await screen.findByRole("button", { name: "Enable" }));
  await waitFor(() => expect(onInstalledChange).toHaveBeenCalledTimes(1));

  rerender(
    <PluginEditorExtensionsPanel
      enabled={[]}
      onChange={vi.fn()}
      client={client}
      installedReferences={[
        {
          installationId: installedExample.installationId,
          sha256: installedExample.sha256,
        },
      ]}
      onInstalledChange={onInstalledChange}
      runtimeAvailable
    />,
    { locale: "en" },
  );
  expect(screen.getByText("Activation pending")).toBeInTheDocument();
  expect(screen.queryByText("Enabled")).not.toBeInTheDocument();

  finishChange();
  await waitFor(() => expect(screen.getByText("Enabled")).toBeInTheDocument());
  expect(screen.queryByText("Activation pending")).not.toBeInTheDocument();
});

it("shows incompatibility reasons, blocks installation without the isolated runtime, and validates uploads", async () => {
  const client = {
    search: vi.fn(),
    inspectUpload: vi.fn().mockResolvedValue({
      ...compatibleInspection,
      metadata: {
        ...compatibleInspection.metadata,
        compatibility: { supported: false, reason: "desktop-only" },
      },
    }),
    list: vi.fn().mockResolvedValue([]),
  } as unknown as PluginEditorExtensionClient;
  render(
    <PluginEditorExtensionsPanel
      enabled={[]}
      onChange={vi.fn()}
      client={client}
      runtimeAvailable={false}
    />,
    { locale: "pt" },
  );
  expect(screen.getByText(/runtime isolado do editor/)).toBeInTheDocument();
  const upload = screen.getByLabelText("Enviar VSIX");
  fireEvent.change(upload, {
    target: { files: [new File(["zip"], "sample.vsix")] },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /Incompatível: requer uma extensão de desktop ou Node/,
  );
  expect(screen.getByRole("button", { name: "Instalar" })).toBeDisabled();
  fireEvent.change(upload, {
    target: { files: [new File(["zip"], "sample.txt")] },
  });
  expect(
    await screen.findByText("Selecione um arquivo VSIX de até 20 MiB."),
  ).toBeInTheDocument();
  expect(client.inspectUpload).toHaveBeenCalledTimes(1);
});

it("disables a persisted project reference before removing its package", async () => {
  const onInstalledChange = vi.fn().mockResolvedValue(undefined);
  const calls: string[] = [];
  const client = {
    list: vi.fn().mockResolvedValue([installedExample]),
    uninstall: vi.fn(async () => {
      calls.push("uninstall");
    }),
  } as unknown as PluginEditorExtensionClient;
  onInstalledChange.mockImplementation(async () => {
    calls.push("disable");
  });
  render(
    <PluginEditorExtensionsPanel
      enabled={[]}
      onChange={vi.fn()}
      client={client}
      installedReferences={[
        {
          installationId: installedExample.installationId,
          sha256: installedExample.sha256,
        },
      ]}
      onInstalledChange={onInstalledChange}
      runtimeAvailable
    />,
    { locale: "en" },
  );
  fireEvent.click(screen.getByRole("tab", { name: "Installed" }));
  fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
  await waitFor(() => expect(calls).toEqual(["disable", "uninstall"]));
});

it("updates an enabled version directly from Marketplace before the Installed tab has been opened", async () => {
  const old = installedExample;
  const next = {
    ...old,
    installationId: "65f9f290-f225-4b2b-b924-fb16a9c47f3c",
    version: "2.0.0",
    sha256: "b".repeat(64),
  };
  const change = vi.fn().mockResolvedValue(undefined);
  const client = {
    list: vi.fn().mockResolvedValue([old]),
    search: vi.fn().mockResolvedValue({
      results: [
        {
          publisher: old.publisher,
          name: old.name,
          version: next.version,
          displayName: "Example",
          description: null,
          license: "MIT",
        },
      ],
      offset: 0,
      totalSize: 1,
      nextOffset: null,
    }),
    inspectMarketplace: vi
      .fn()
      .mockResolvedValue({ ...compatibleInspection, metadata: next }),
    install: vi.fn().mockResolvedValue(next),
  } as unknown as PluginEditorExtensionClient;
  render(
    <PluginEditorExtensionsPanel
      enabled={[]}
      onChange={vi.fn()}
      client={client}
      installedReferences={[
        { installationId: old.installationId, sha256: old.sha256 },
      ]}
      onInstalledChange={change}
      runtimeAvailable
    />,
    { locale: "en" },
  );
  fireEvent.change(screen.getByRole("searchbox", { name: "Search Open VSX" }), {
    target: { value: "example" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Inspect version" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: /Update|Install/ }),
  );
  await waitFor(() =>
    expect(change).toHaveBeenCalledWith([
      { installationId: next.installationId, sha256: next.sha256 },
    ]),
  );
});
