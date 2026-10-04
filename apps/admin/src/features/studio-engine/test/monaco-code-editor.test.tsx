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
}));
vi.mock("../monaco-cdn", () => ({
  loadMonacoFromCdn: mocks.load,
  resolveMonacoTheme: () => "vs",
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function monaco() {
  return {
    Uri: { parse: (value: string) => value },
    editor: {
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
