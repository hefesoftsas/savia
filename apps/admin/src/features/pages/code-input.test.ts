import { expect, it } from "vitest";
import { fencedCodePaste } from "./code-input";

it("preserves whitespace and embedded fences in copied code", () => {
  expect(fencedCodePaste("````ts\r\n  const x = `hi`;\r\n```\r\n````")).toEqual(
    [
      {
        type: "code_block",
        language: "typescript",
        children: [{ text: "  const x = `hi`;\n```" }],
      },
    ],
  );
});
it("keeps prose around multiple complete code snippets", () => {
  const blocks = fencedCodePaste(
    "Before\n```js\nconst x = 1;\n```\nAfter\n~~~py\nprint(1)\n~~~",
  );
  expect(blocks?.map((node) => node.type)).toEqual([
    "p",
    "code_block",
    "p",
    "code_block",
  ]);
});
it("leaves ordinary and unfinished clipboard text to the native paste handler", () => {
  expect(fencedCodePaste("Hello\nworld")).toBeNull();
  expect(fencedCodePaste("```js\nnot finished")).toBeNull();
});

// Exercise Plate transforms directly: jsdom typing does not implement beforeinput.
import { createPlateEditor } from "platejs/react";
import { richBlockPlugins } from "./rich-blocks";

it("creates code immediately on the third typed backtick without Enter", () => {
  const editor = createPlateEditor({
    plugins: richBlockPlugins,
    value: [{ type: "p", children: [{ text: "" }] }],
  });
  editor.tf.select({ path: [0, 0], offset: 0 });
  editor.tf.insertText("`");
  editor.tf.insertText("`");
  expect(editor.children[0].type).toBe("p");
  editor.tf.insertText("`");
  expect(editor.children[0]).toMatchObject({
    type: "code_block",
    language: "plain",
    children: [{ text: "" }],
  });
  editor.tf.insertText("const value = 1;");
  expect(editor.api.string([0])).toBe("const value = 1;");
});
it("keeps backticks literal inside prose and existing code", () => {
  for (const type of ["p", "code_block"]) {
    const editor = createPlateEditor({
      plugins: richBlockPlugins,
      value: [{ type, children: [{ text: "prefix " }] }],
    });
    editor.tf.select({ path: [0, 0], offset: 7 });
    for (const char of "```") editor.tf.insertText(char);
    expect(editor.children[0].type).toBe(type);
    expect(editor.api.string([0])).toBe("prefix ```");
  }
});
