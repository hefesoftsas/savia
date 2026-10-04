// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, waitFor } from "@testing-library/react";
import { render } from "./locale-test-render";
import { MonacoCodeEditor } from "../monaco-code-editor";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  create: vi.fn(),
  options: vi.fn(),
  model: vi.fn(),
  applyTheme: vi.fn(),
}));
vi.mock("../monaco-cdn", () => ({
  loadMonacoFromCdn: mocks.load,
  resolveMonacoTheme: () => "vs",
  applyMonacoTheme: mocks.applyTheme,
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function monaco() {
  return {
    Uri: { parse: (value: string) => value },
    editor: {
      defineTheme: vi.fn(),
      setTheme: vi.fn(),
      createModel: mocks.model.mockImplementation((value: string) => ({
        value,
        dispose: vi.fn(),
      })),
      create: mocks.create.mockImplementation((_element, options) => {
        let value = options.model?.value ?? options.value;
        let changed = () => {};
        return {
          getValue: () => value,
          setValue: (next: string) => {
            value = next;
            changed();
          },
          updateOptions: mocks.options,
          dispose: vi.fn(),
          onDidChangeModelContent: (callback: () => void) => {
            changed = callback;
          },
          layout: () => {},
        };
      }),
    },
  };
}

it("does not report an AI/programmatic replacement as a manual edit", async () => {
  mocks.load.mockResolvedValue(monaco());
  const change = vi.fn();
  const view = render(
    <MonacoCodeEditor
      value="old"
      language="json"
      ariaLabel="code"
      onChange={change}
    />,
  );
  await waitFor(() => expect(mocks.create).toHaveBeenCalled());
  view.rerender(
    <MonacoCodeEditor
      value="new"
      language="json"
      ariaLabel="code"
      onChange={change}
    />,
  );
  expect(change).not.toHaveBeenCalled();
  expect(mocks.create.mock.results[0].value.getValue()).toBe("new");
});

it("initializes with the latest content if it changes during lazy loading", async () => {
  let resolve!: (value: unknown) => void;
  mocks.load.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const change = vi.fn();
  const view = render(
    <MonacoCodeEditor
      value="old"
      language="json"
      ariaLabel="code"
      onChange={change}
    />,
  );
  view.rerender(
    <MonacoCodeEditor
      value="newest"
      language="json"
      ariaLabel="code"
      onChange={change}
    />,
  );
  await act(async () => {
    resolve(monaco());
  });
  expect(mocks.create.mock.results[0].value.getValue()).toBe("newest");
});

it("changes read-only mode without discarding the editor and its undo history", async () => {
  mocks.load.mockResolvedValue(monaco());
  const change = vi.fn();
  const view = render(
    <MonacoCodeEditor
      value="source"
      language="json"
      ariaLabel="code"
      onChange={change}
    />,
  );
  await waitFor(() => expect(mocks.create).toHaveBeenCalled());
  view.rerender(
    <MonacoCodeEditor
      value="source"
      language="json"
      ariaLabel="code"
      onChange={change}
      readOnly
    />,
  );
  await act(async () => {});
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.options).toHaveBeenCalledWith({ readOnly: true });
});

it("refreshes the global editor palette and font without recreating Monaco", async () => {
  mocks.load.mockResolvedValue(monaco());
  document.documentElement.style.setProperty("--primary", "#123456");
  document.documentElement.style.setProperty(
    "--font-mono",
    "Test Mono, monospace",
  );
  const view = render(
    <div style={{ "--primary": "#ff0000" } as React.CSSProperties}>
      <MonacoCodeEditor
        value="source"
        language="json"
        ariaLabel="code"
        onChange={vi.fn()}
      />
    </div>,
  );
  await waitFor(() => expect(mocks.create).toHaveBeenCalled());
  document.documentElement.style.setProperty("--primary", "#abcdef");
  document.documentElement.style.setProperty(
    "--font-mono",
    "Changed Mono, monospace",
  );

  await waitFor(() =>
    expect(
      mocks.applyTheme.mock.calls.some((call) => call[1].primary === "#abcdef"),
    ).toBe(true),
  );

  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.applyTheme.mock.calls.at(-1)?.[1].primary).toBe("#abcdef");
  expect(mocks.options).toHaveBeenCalledWith({
    fontFamily: "Changed Mono, monospace",
  });
});

it("keeps multiple Monaco instances on the same root palette and observes its theme key", async () => {
  mocks.load.mockResolvedValue(monaco());
  document.documentElement.style.setProperty("--primary", "#123456");
  const view = render(
    <>
      <div style={{ "--primary": "#ff0000" } as React.CSSProperties}>
        <MonacoCodeEditor
          value="one"
          language="json"
          ariaLabel="first editor"
          onChange={vi.fn()}
        />
      </div>
      <div style={{ "--primary": "#00ff00" } as React.CSSProperties}>
        <MonacoCodeEditor
          value="two"
          language="json"
          ariaLabel="second editor"
          onChange={vi.fn()}
        />
      </div>
    </>,
  );
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(mocks.applyTheme).toHaveBeenCalledTimes(4));
  expect(
    mocks.applyTheme.mock.calls.every((call) => call[1].primary === "#123456"),
  ).toBe(true);

  document.documentElement.dataset.colorTheme = "violet";
  await waitFor(() => expect(mocks.applyTheme).toHaveBeenCalledTimes(6));

  expect(mocks.create).toHaveBeenCalledTimes(2);
  expect(
    mocks.applyTheme.mock.calls
      .slice(4)
      .every((call) => call[1].primary === "#123456"),
  ).toBe(true);
  view.unmount();
});
