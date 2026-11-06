import { createSlateEditor } from "platejs";
import { expect, it } from "vitest";
import { navigateBlockEdge } from "./block-navigation";
const p = (text: string) => ({ type: "p", children: [{ text }] });
it("moves up and down between text blocks at their edges", () => {
  const editor = createSlateEditor({ value: [p("first"), p("second")] });
  editor.tf.select({ path: [1, 0], offset: 0 });
  expect(navigateBlockEdge(editor, -1)).toBe(true);
  expect(editor.selection?.focus).toEqual({ path: [0, 0], offset: 5 });
  expect(navigateBlockEdge(editor, 1)).toBe(true);
  expect(editor.selection?.focus).toEqual({ path: [1, 0], offset: 0 });
});
it("leaves normal line movement and selections to the browser", () => {
  const editor = createSlateEditor({ value: [p("first"), p("second")] });
  editor.tf.select({ path: [0, 0], offset: 2 });
  expect(navigateBlockEdge(editor, 1)).toBe(false);
  editor.tf.select({
    anchor: { path: [0, 0], offset: 0 },
    focus: { path: [1, 0], offset: 0 },
  });
  expect(navigateBlockEdge(editor, -1)).toBe(false);
});
it("skips non-editable cards and gives an edge code block an exit paragraph", () => {
  const editor = createSlateEditor({
    value: [p("first"), { type: "issue", children: [{ text: "" }] }, p("last")],
  });
  editor.tf.select({ path: [0, 0], offset: 5 });
  expect(navigateBlockEdge(editor, 1)).toBe(true);
  expect(editor.selection?.focus.path).toEqual([2, 0]);
  for (const direction of [-1, 1] as const) {
    const code = createSlateEditor({
      value: [{ type: "code_block", children: [{ text: "" }] }],
    });
    code.tf.select({ path: [0, 0], offset: 0 });
    expect(navigateBlockEdge(code, direction)).toBe(true);
    expect(code.children[direction < 0 ? 0 : 1].type).toBe("p");
  }
});

it("skips private ticket summary blocks while crossing block edges", () => {
  const editor = createSlateEditor({
    value: [
      p("first"),
      { type: "ticket_summary", children: [{ text: "" }] },
      p("last"),
    ],
  });
  editor.tf.select({ path: [0, 0], offset: 5 });
  expect(navigateBlockEdge(editor, 1)).toBe(true);
  expect(editor.selection?.focus.path).toEqual([2, 0]);
});
