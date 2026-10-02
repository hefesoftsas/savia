import { describe, expect, it } from "vitest";
import {
  BasicBlocksPlugin,
  BasicMarksPlugin,
} from "@platejs/basic-nodes/react";
import { LinkPlugin } from "@platejs/link/react";
import { createPlateEditor, createPlatePlugin } from "platejs/react";
import type { Value } from "platejs";
import { richBlockPlugins } from "./rich-blocks";
import { RichBlockNormalizationPlugin } from "./rich-block-normalization";

function editorWith(value: unknown[]) {
  return createPlateEditor({
    plugins: [
      BasicBlocksPlugin,
      BasicMarksPlugin,
      LinkPlugin,
      ...richBlockPlugins,
      createPlatePlugin({ key: "issue", node: { isElement: true } }),
      RichBlockNormalizationPlugin,
    ],
    value: value as Value,
  });
}

function normalizeRootChildren(editor: ReturnType<typeof editorWith>) {
  editor.children.forEach((node, index) =>
    (editor as any).normalizeNode([node, [index]]),
  );
  editor.tf.normalize();
}

function visibleText(node: any): string {
  if (typeof node.text === "string") return node.text;
  return (node.children ?? []).map(visibleText).join("");
}

describe("rich block normalization", () => {
  it("repairs a row after a cross-cell deletion without losing the remaining cells", () => {
    const editor = editorWith([
      {
        type: "table",
        children: [
          {
            type: "table_row",
            children: [
              {
                type: "table_cell",
                children: [{ type: "p", children: [{ text: "A" }] }],
              },
              {
                type: "table_cell",
                children: [{ type: "p", children: [{ text: "B" }] }],
              },
            ],
          },
          {
            type: "table_row",
            children: [
              {
                type: "table_cell",
                children: [{ type: "p", children: [{ text: "C" }] }],
              },
              {
                type: "table_cell",
                children: [{ type: "p", children: [{ text: "D" }] }],
              },
            ],
          },
        ],
      },
    ]);

    editor.tf.removeNodes({ at: [0, 0, 1] });
    normalizeRootChildren(editor);

    const table = editor.children[0] as any;
    expect(table.children).toHaveLength(2);
    expect(table.children.map((row: any) => row.children.length)).toEqual([
      2, 2,
    ]);
    expect(table.children[0].children[0].children[0].children[0].text).toBe(
      "A",
    );
    expect(table.children[1].children[1].children[0].children[0].text).toBe(
      "D",
    );
  });

  it("repairs malformed tables and toggles while preserving visible content", () => {
    const editor = editorWith([
      {
        type: "table",
        children: [
          { type: "p", children: [{ text: "Moved into a cell" }] },
          {
            type: "table_row",
            children: [
              {
                type: "table_cell",
                children: [{ type: "p", children: [{ text: "Existing" }] }],
              },
            ],
          },
        ],
      },
      {
        type: "toggle",
        children: [
          {
            type: "issue",
            url: "https://example.test/issue/1",
            children: [{ text: "Summary" }],
          },
        ],
      },
      {
        type: "code_block",
        language: "typescript",
        checked: true,
        children: [{ type: "p", children: [{ text: "const x = 1;" }] }],
      },
      {
        type: "p",
        language: "javascript",
        checked: true,
        children: [{ text: "Ordinary" }],
      },
    ]);
    normalizeRootChildren(editor);

    const [table, toggle, code, paragraph] = editor.children as any[];
    expect(table.children).toHaveLength(2);
    expect(table.children.map((row: any) => row.children.length)).toEqual([
      1, 1,
    ]);
    expect(visibleText(table.children[0])).toContain("Moved into a cell");
    expect(toggle.children[0]).toMatchObject({
      type: "p",
      children: [{ text: "Summary" }],
    });
    expect(toggle.children.length).toBeGreaterThanOrEqual(2);
    expect(code).not.toHaveProperty("checked");
    expect(
      code.children.every((child: any) => typeof child.text === "string"),
    ).toBe(true);
    expect(paragraph).not.toHaveProperty("checked");
    expect(paragraph).not.toHaveProperty("language");
  });

  it("keeps tables within supported row and column bounds without dropping text", () => {
    const editor = editorWith([
      {
        type: "table",
        children: Array.from({ length: 21 }, (_, row) => ({
          type: "table_row",
          children: Array.from({ length: 11 }, (_, column) => ({
            type: "table_cell",
            children: [{ type: "p", children: [{ text: `${row}:${column}` }] }],
          })),
        })),
      },
    ]);
    normalizeRootChildren(editor);

    const table = editor.children[0] as any;
    expect(table.children).toHaveLength(20);
    expect(table.children.every((row: any) => row.children.length === 10)).toBe(
      true,
    );
    const persistedText = JSON.stringify(table).match(/20:10/)?.[0];
    expect(persistedText).toBe("20:10");
  });

  it("repairs orphan table rows and cells into content paragraphs", () => {
    const editor = editorWith([
      {
        type: "table_row",
        children: [
          {
            type: "table_cell",
            children: [{ type: "p", children: [{ text: "Orphan content" }] }],
          },
        ],
      },
    ]);
    normalizeRootChildren(editor);

    expect(editor.children[0]).toMatchObject({
      type: "p",
      children: [{ text: "Orphan content" }],
    });
  });
});
