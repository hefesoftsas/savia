import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PlateEditor } from "platejs/react";
import type { Value } from "platejs";
import { PageEditor } from "./editor";
import { PagesClient } from "./client";
import { ApiClient } from "@/api/api-client";

const { editorRef } = vi.hoisted(() => ({
  editorRef: { current: null as unknown },
}));
vi.mock("platejs/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("platejs/react")>();
  return {
    ...actual,
    usePlateEditor: (...args: Parameters<typeof actual.usePlateEditor>) => {
      const editor = actual.usePlateEditor(...args);
      editorRef.current = editor;
      return editor;
    },
  };
});

const api = new ApiClient({
  baseUrl: "https://savia.test",
  tokenSource: { getAccessToken: async () => null },
  fetcher: async () => Response.json({ error: {} }, { status: 403 }),
});
afterEach(() => {
  cleanup();
  editorRef.current = null;
});

function mountEditor(initialValue: Value, onChange = vi.fn()) {
  render(
    <PageEditor
      pageId="one"
      api={api}
      pages={new PagesClient(api)}
      readOnly={false}
      initialValue={initialValue}
      onChange={onChange}
    />,
  );
  const editor = editorRef.current as PlateEditor;
  const textbox = screen.getByRole("textbox", { name: "Page content" });
  textbox.focus();
  return { editor, textbox, onChange };
}
function select(editor: PlateEditor, path: number[], offset: number) {
  act(() => editor.tf.select({ path, offset }));
}
function latestValue(onChange: ReturnType<typeof vi.fn>) {
  return onChange.mock.calls.at(-1)?.[0] as Value;
}

it("keeps code Enter and Tab inside the code node, then exits with Ctrl+Enter", async () => {
  const { editor, textbox, onChange } = mountEditor([
    {
      type: "code_block",
      language: "typescript",
      children: [{ text: "alpha beta" }],
    },
  ]);
  select(editor, [0, 0], 5);
  fireEvent.keyDown(textbox, { key: "Enter" });
  await waitFor(() =>
    expect(
      (latestValue(onChange)[0] as { children: Array<{ text: string }> })
        .children[0].text,
    ).toBe("alpha\n beta"),
  );

  select(editor, [0, 0], 6);
  fireEvent.keyDown(textbox, { key: "Tab" });
  await waitFor(() =>
    expect(
      (latestValue(onChange)[0] as { children: Array<{ text: string }> })
        .children[0].text,
    ).toBe("alpha\n   beta"),
  );

  select(editor, [0, 0], 6);
  fireEvent.keyDown(textbox, { key: "Enter", ctrlKey: true });
  await waitFor(() =>
    expect(latestValue(onChange).map((node) => node.type)).toEqual([
      "code_block",
      "p",
    ]),
  );
});

it("splits numbered and todo content at the caret, resets new todo state, and exits empty items", async () => {
  const { editor, textbox, onChange } = mountEditor([
    { type: "numbered", children: [{ text: "abcd" }] },
    { type: "todo", checked: true, children: [{ text: "wxyz" }] },
    { type: "todo", checked: true, children: [{ text: "" }] },
  ]);

  select(editor, [0, 0], 2);
  fireEvent.keyDown(textbox, { key: "Enter" });
  await waitFor(() => {
    const value = latestValue(onChange) as Array<{
      type: string;
      children: Array<{ text: string }>;
    }>;
    expect(
      value.slice(0, 2).map((node) => [node.type, node.children[0].text]),
    ).toEqual([
      ["numbered", "ab"],
      ["numbered", "cd"],
    ]);
  });

  select(editor, [2, 0], 2);
  fireEvent.keyDown(textbox, { key: "Enter" });
  await waitFor(() => {
    const todo = latestValue(onChange)[2] as {
      type: string;
      checked?: boolean;
      children: Array<{ text: string }>;
    };
    const next = latestValue(onChange)[3] as {
      type: string;
      checked?: boolean;
      children: Array<{ text: string }>;
    };
    expect(todo).toMatchObject({
      type: "todo",
      checked: true,
      children: [{ text: "wx" }],
    });
    expect(next).toMatchObject({
      type: "todo",
      checked: false,
      children: [{ text: "yz" }],
    });
  });

  select(editor, [4, 0], 0);
  fireEvent.keyDown(textbox, { key: "Enter" });
  await waitFor(() => {
    const value = latestValue(onChange);
    expect(value[4]).toMatchObject({ type: "p", children: [{ text: "" }] });
    expect(value[4]).not.toHaveProperty("checked");
  });
});

it("moves Tab through table cells and appends a row at the last cell", async () => {
  const { editor, textbox, onChange } = mountEditor([
    {
      type: "table",
      children: [
        {
          type: "table_row",
          children: [
            {
              type: "table_cell",
              children: [{ type: "p", children: [{ text: "a" }] }],
            },
            {
              type: "table_cell",
              children: [{ type: "p", children: [{ text: "b" }] }],
            },
          ],
        },
      ],
    },
  ]);
  select(editor, [0, 0, 0, 0, 0], 0);
  fireEvent.keyDown(textbox, { key: "Tab" });
  expect(editor.selection?.focus.path).toEqual([0, 0, 1, 0, 0]);

  select(editor, [0, 0, 1, 0, 0], 1);
  fireEvent.keyDown(textbox, { key: "Tab" });
  await waitFor(() => {
    expect(
      (latestValue(onChange)[0] as { children: unknown[] }).children,
    ).toHaveLength(2);
    expect(editor.selection?.focus.path).toEqual([0, 1, 0, 0, 0]);
  });
});

it("does not treat keystrokes on the code language control as code edits", async () => {
  const { editor, onChange } = mountEditor([
    { type: "code_block", language: "plain", children: [{ text: "keep" }] },
  ]);
  select(editor, [0, 0], 4);
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Code language" }), {
    key: "Enter",
  });
  await waitFor(() => {
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.children).toHaveLength(1);
    expect(
      (editor.children[0] as { children: Array<{ text: string }> }).children[0]
        .text,
    ).toBe("keep");
  });
});

it("keeps table controls attached to the table after inserting content before it", async () => {
  const { editor } = mountEditor([
    {
      type: "table",
      children: [
        {
          type: "table_row",
          children: [
            {
              type: "table_cell",
              children: [{ type: "p", children: [{ text: "a" }] }],
            },
            {
              type: "table_cell",
              children: [{ type: "p", children: [{ text: "b" }] }],
            },
          ],
        },
      ],
    },
  ]);
  act(() =>
    editor.tf.insertNodes(
      { type: "p", children: [{ text: "before" }] },
      { at: [0] },
    ),
  );
  expect((editor.children[1] as { type: string }).type).toBe("table");
  await fireEvent.click(screen.getByRole("button", { name: "Add row" }));
  await waitFor(() =>
    expect(
      (editor.children[1] as { children: unknown[] }).children,
    ).toHaveLength(2),
  );
  await fireEvent.click(screen.getByRole("button", { name: "Add column" }));
  await waitFor(() => {
    const rows = (
      editor.children[1] as { children: Array<{ children: unknown[] }> }
    ).children;
    expect(rows.map((row) => row.children.length)).toEqual([3, 3]);
  });
});
