import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
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

it("explains filtered Marketplace candidates and keeps paging across empty filtered pages", async () => {
  const search = vi
    .fn()
    .mockResolvedValueOnce({
      results: [],
      offset: 0,
      totalSize: 60,
      nextOffset: 20,
    })
    .mockResolvedValueOnce({
      results: [],
      offset: 20,
      totalSize: 60,
      nextOffset: 40,
    })
    .mockResolvedValueOnce({
      results: [],
      offset: 40,
      totalSize: 60,
      nextOffset: null,
    });
  const client = {
    search,
    list: vi.fn().mockResolvedValue([]),
  } as unknown as PluginEditorExtensionClient;

  render(
    <PluginEditorExtensionsPanel
      enabled={[]}
      onChange={vi.fn()}
      client={client}
    />,
    { locale: "en" },
  );

  expect(
    await screen.findByText(/filtered for compatibility with this web editor/i),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      /inspect a version to verify the complete package before installing/i,
    ),
  ).toBeInTheDocument();
  expect(
    await screen.findByText(
      "No candidates are available for this editor on this page.",
    ),
  ).toBeInTheDocument();
  const loadMore = screen.getByRole("button", { name: "Load more" });
  expect(loadMore).toBeEnabled();

  fireEvent.click(loadMore);
  await waitFor(() =>
    expect(search).toHaveBeenLastCalledWith("", 20, expect.any(AbortSignal)),
  );
  expect(
    await screen.findByText(
      "No candidates are available for this editor on this page.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();

  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await waitFor(() =>
    expect(search).toHaveBeenLastCalledWith("", 40, expect.any(AbortSignal)),
  );
  expect(await screen.findByText("No extensions found.")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Load more" }),
  ).not.toBeInTheDocument();
});

it("does not label Marketplace search results as fully verified before inspection", async () => {
  const client = {
    search: vi.fn().mockResolvedValue({
      results: [
        {
          publisher: "Acme",
          name: "browser-tool",
          version: "1.0.0",
          displayName: "Browser tool",
          description: "A web extension",
          license: "MIT",
        },
      ],
      offset: 0,
      totalSize: 1,
      nextOffset: null,
    }),
    list: vi.fn().mockResolvedValue([]),
  } as unknown as PluginEditorExtensionClient;

  render(
    <PluginEditorExtensionsPanel
      enabled={[]}
      onChange={vi.fn()}
      client={client}
    />,
    { locale: "en" },
  );

  expect(await screen.findByText("Browser tool")).toBeInTheDocument();
  expect(
    screen.queryByText("Compatible with this editor."),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(/verify the complete package before installing/i),
  ).toBeInTheDocument();
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

  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search extensions" }),
    {
      target: { value: "example" },
    },
  );
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
    search: vi.fn().mockResolvedValue({ results: [], nextOffset: null }),
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
    search: vi.fn().mockResolvedValue({ results: [], nextOffset: null }),
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
    search: vi.fn().mockResolvedValue({ results: [], nextOffset: null }),
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

it.each([false, true])(
  "updates an enabled version from Marketplace with initial list pending=%s",
  async (pendingList) => {
    const old = installedExample;
    const next = {
      ...old,
      installationId: "65f9f290-f225-4b2b-b924-fb16a9c47f3c",
      version: "2.0.0",
      sha256: "b".repeat(64),
    };
    const change = vi.fn().mockResolvedValue(undefined);
    const client = {
      list: vi
        .fn()
        .mockImplementationOnce(() =>
          pendingList ? new Promise(() => {}) : Promise.resolve([old]),
        )
        .mockResolvedValue([old]),
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
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search extensions" }),
      {
        target: { value: "example" },
      },
    );
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
  },
);

it("browses on opening and searches automatically from Installed using one field", async () => {
  const search = vi.fn().mockResolvedValue({
    results: [
      {
        publisher: "Acme",
        name: "react-tool",
        version: "1.0.0",
        displayName: "React tool",
      },
    ],
    nextOffset: null,
  });
  const client = {
    search,
    list: vi.fn().mockResolvedValue([]),
  } as unknown as PluginEditorExtensionClient;
  render(
    <PluginEditorExtensionsPanel
      enabled={[]}
      onChange={vi.fn()}
      client={client}
      runtimeAvailable
    />,
    { locale: "en" },
  );
  await waitFor(() =>
    expect(search).toHaveBeenCalledWith("", 0, expect.any(AbortSignal)),
  );
  expect(screen.getAllByRole("searchbox")).toHaveLength(1);
  expect(screen.queryByText("Prettier")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Installed" }));
  expect(screen.getByText("Prettier")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "react" },
  });
  await waitFor(() =>
    expect(search).toHaveBeenCalledWith("react", 0, expect.any(AbortSignal)),
  );
  expect(screen.getByRole("tab", { name: "Marketplace" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(await screen.findByText("React tool")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
  await waitFor(() =>
    expect(search.mock.calls.filter(([q]) => q === "")).toHaveLength(2),
  );
});

it("ignores an aborted search result after the query changes", async () => {
  let finishOld!: (value: unknown) => void;
  const search = vi.fn().mockImplementation((query: string) =>
    query === "old"
      ? new Promise((resolve) => {
          finishOld = resolve;
        })
      : Promise.resolve({
          results: [
            {
              publisher: "Acme",
              name: "new-tool",
              version: "1",
              displayName: "Current result",
            },
          ],
          nextOffset: null,
        }),
  );
  const client = {
    search,
    list: vi.fn().mockResolvedValue([]),
  } as unknown as PluginEditorExtensionClient;
  render(
    <PluginEditorExtensionsPanel
      enabled={[]}
      onChange={vi.fn()}
      client={client}
    />,
    { locale: "en" },
  );
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "old" } });
  await waitFor(() => expect(finishOld).toBeDefined());
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "new" } });
  await waitFor(() =>
    expect(search).toHaveBeenCalledWith("new", 0, expect.any(AbortSignal)),
  );
  await act(async () => {
    finishOld({
      results: [
        {
          publisher: "Acme",
          name: "stale",
          version: "1",
          displayName: "Stale result",
        },
      ],
      nextOffset: null,
    });
  });
  expect(await screen.findByText("Current result")).toBeInTheDocument();
  expect(screen.queryByText("Stale result")).not.toBeInTheDocument();
});

it("filters installed packages and bundled tools when selecting Installed", async () => {
  const client = {
    search: vi.fn().mockResolvedValue({ results: [], nextOffset: null }),
    list: vi.fn().mockResolvedValue([installedExample]),
  } as unknown as PluginEditorExtensionClient;
  render(
    <PluginEditorExtensionsPanel
      enabled={[]}
      onChange={vi.fn()}
      client={client}
    />,
    { locale: "en" },
  );
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "example" },
  });
  fireEvent.click(screen.getByRole("tab", { name: "Installed" }));
  expect(await screen.findByText("example")).toBeInTheDocument();
  expect(screen.queryByText("Prettier")).not.toBeInTheDocument();
  expect(screen.queryByText("React snippets")).not.toBeInTheDocument();
});

it("keeps a VSIX inspection visible when the initial catalog response arrives late", async () => {
  let finishSearch!: (result: unknown) => void;
  const client = {
    search: vi.fn(
      () =>
        new Promise((resolve) => {
          finishSearch = resolve;
        }),
    ),
    list: vi.fn().mockResolvedValue([]),
    inspectUpload: vi.fn().mockResolvedValue(compatibleInspection),
  } as unknown as PluginEditorExtensionClient;
  render(
    <PluginEditorExtensionsPanel
      enabled={[]}
      onChange={vi.fn()}
      client={client}
      runtimeAvailable
    />,
    { locale: "en" },
  );
  await waitFor(() => expect(finishSearch).toBeDefined());
  fireEvent.change(screen.getByLabelText("Upload VSIX"), {
    target: { files: [new File(["zip"], "sample.vsix")] },
  });
  expect(
    await screen.findByText("Compatible with this editor."),
  ).toBeInTheDocument();
  await act(async () => {
    finishSearch({ results: [], nextOffset: null });
  });
  expect(screen.getByRole("button", { name: "Install" })).toBeEnabled();
});

it("switches extension tabs with arrow keys and exposes the selected panel", async () => {
  const client = {
    search: vi.fn().mockResolvedValue({ results: [], nextOffset: null }),
    list: vi.fn().mockResolvedValue([]),
  } as unknown as PluginEditorExtensionClient;
  render(
    <PluginEditorExtensionsPanel
      enabled={[]}
      onChange={vi.fn()}
      client={client}
    />,
    { locale: "en" },
  );
  const marketplace = screen.getByRole("tab", { name: "Marketplace" });
  marketplace.focus();
  fireEvent.keyDown(marketplace, { key: "ArrowRight" });
  const installed = screen.getByRole("tab", { name: "Installed" });
  expect(installed).toHaveFocus();
  expect(installed).toHaveAttribute("aria-selected", "true");
  expect(
    screen.getByRole("tabpanel", { name: "Installed" }),
  ).toBeInTheDocument();
  fireEvent.keyDown(installed, { key: "ArrowLeft" });
  expect(marketplace).toHaveFocus();
  expect(marketplace).toHaveAttribute("aria-selected", "true");
});

it("keeps a newly installed package when the initial installed list responds late", async () => {
  let finishList!: (result: unknown) => void;
  const other = {
    ...installedExample,
    installationId: "other-installation",
    name: "existing-tool",
  };
  const client = {
    list: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishList = resolve;
          }),
      )
      .mockResolvedValue([other]),
    search: vi.fn().mockResolvedValue({
      results: [
        {
          publisher: "Acme",
          name: "example",
          version: "1.0.0",
          displayName: "Example",
        },
      ],
      nextOffset: null,
    }),
    inspectMarketplace: vi.fn().mockResolvedValue(compatibleInspection),
    install: vi.fn().mockResolvedValue(installedExample),
  } as unknown as PluginEditorExtensionClient;
  render(
    <PluginEditorExtensionsPanel
      enabled={[]}
      onChange={vi.fn()}
      client={client}
      runtimeAvailable
    />,
    { locale: "en" },
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Inspect version" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Install" }));
  expect(await screen.findByText("example")).toBeInTheDocument();
  await act(async () => {
    finishList([other]);
  });
  expect(screen.getByText("example")).toBeInTheDocument();
  expect(screen.getByText("existing-tool")).toBeInTheDocument();
});

it("does not reopen an old inspection after searching for another package", async () => {
  let finishInspection!: (result: unknown) => void;
  const client = {
    list: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue({
      results: [
        {
          publisher: "Acme",
          name: "example",
          version: "1.0.0",
          displayName: "Example",
        },
      ],
      nextOffset: null,
    }),
    inspectMarketplace: vi.fn(
      () =>
        new Promise((resolve) => {
          finishInspection = resolve;
        }),
    ),
  } as unknown as PluginEditorExtensionClient;
  render(
    <PluginEditorExtensionsPanel
      enabled={[]}
      onChange={vi.fn()}
      client={client}
      runtimeAvailable
    />,
    { locale: "en" },
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Inspect version" }),
  );
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "other" },
  });
  await act(async () => {
    finishInspection(compatibleInspection);
  });
  expect(
    screen.queryByText("Compatible with this editor."),
  ).not.toBeInTheDocument();
  expect(
    await screen.findByRole("button", { name: "Inspect version" }),
  ).toBeEnabled();
});

it("retries a failed installed list when opening Installed", async () => {
  const client = {
    list: vi
      .fn()
      .mockRejectedValueOnce(new Error("Temporary list failure"))
      .mockResolvedValue([installedExample]),
    search: vi.fn().mockResolvedValue({ results: [], nextOffset: null }),
  } as unknown as PluginEditorExtensionClient;
  render(
    <PluginEditorExtensionsPanel
      enabled={[]}
      onChange={vi.fn()}
      client={client}
    />,
    { locale: "en" },
  );
  await waitFor(() => expect(client.list).toHaveBeenCalledTimes(1));
  await act(async () => {});
  fireEvent.click(screen.getByRole("tab", { name: "Installed" }));
  expect(await screen.findByText("example")).toBeInTheDocument();
  expect(screen.queryByText("Temporary list failure")).not.toBeInTheDocument();
});

it("clears an unrelated upload error when starting a marketplace query", async () => {
  const client = {
    list: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue({ results: [], nextOffset: null }),
  } as unknown as PluginEditorExtensionClient;
  render(
    <PluginEditorExtensionsPanel
      enabled={[]}
      onChange={vi.fn()}
      client={client}
    />,
    { locale: "en" },
  );
  fireEvent.change(screen.getByLabelText("Upload VSIX"), {
    target: { files: [new File(["invalid"], "sample.txt")] },
  });
  expect(
    await screen.findByText("Choose a VSIX file up to 20 MiB."),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "react" },
  });
  expect(
    screen.queryByText("Choose a VSIX file up to 20 MiB."),
  ).not.toBeInTheDocument();
});

it("resumes a canceled manual search when returning to Marketplace", async () => {
  const result = {
    results: [
      {
        publisher: "Acme",
        name: "example",
        version: "1.0.0",
        displayName: "Example",
      },
    ],
    nextOffset: null,
  };
  const client = {
    list: vi.fn().mockResolvedValue([]),
    search: vi
      .fn()
      .mockResolvedValueOnce(result)
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue(result),
  } as unknown as PluginEditorExtensionClient;
  render(
    <PluginEditorExtensionsPanel
      enabled={[]}
      onChange={vi.fn()}
      client={client}
    />,
    { locale: "en" },
  );
  expect(await screen.findByText("Example")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  fireEvent.click(screen.getByRole("tab", { name: "Installed" }));
  fireEvent.click(screen.getByRole("tab", { name: "Marketplace" }));
  expect(await screen.findByText("Example")).toBeInTheDocument();
  expect(client.search).toHaveBeenCalledTimes(3);
});
