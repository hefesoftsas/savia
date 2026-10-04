import { createPlatePlugin } from "platejs/react";

type RichNode = Record<string, unknown> & {
  type?: string;
  text?: string;
  children?: RichNode[];
};

const BODY_BLOCKS = new Set([
  "p",
  "paragraph",
  "h1",
  "h2",
  "h3",
  "heading-one",
  "heading-two",
  "heading-three",
  "ul",
  "ol",
  "li",
  "bullet",
  "bulleted-list",
  "numbered-list",
  "list-item",
  "blockquote",
  "code",
  "bulletedList",
  "numberedList",
  "listItem",
  "numbered",
  "code_block",
  "todo",
  "divider",
  "callout",
  "toggle",
  "table",
  "issue",
  "collection",
  "attachment",
  "ticket_summary",
  "a",
  "link",
]);

const isNode = (value: unknown): value is RichNode =>
  !!value && typeof value === "object" && !Array.isArray(value);

function textValue(node: RichNode): string {
  if (typeof node.text === "string") return node.text;
  return (node.children ?? []).map(textValue).join("");
}

function cleanLeaf(node: RichNode): RichNode {
  const leaf: RichNode = {
    text: typeof node.text === "string" ? node.text : "",
  };
  for (const key of [
    "id",
    "bold",
    "italic",
    "underline",
    "strikethrough",
    "code",
  ]) {
    if (node[key] !== undefined) leaf[key] = node[key];
  }
  return leaf;
}

function inlineFrom(node: RichNode): RichNode[] {
  if (typeof node.text === "string") return [cleanLeaf(node)];
  if (
    ["a", "link"].includes(String(node.type)) &&
    typeof (node.url ?? node.href) === "string" &&
    (node.children ?? []).every(
      (child) => typeof child.text === "string" || isInlineLink(child),
    )
  ) {
    return [
      {
        ...(typeof node.id === "string" ? { id: node.id } : {}),
        type: node.type,
        ...(typeof node.url === "string" ? { url: node.url } : {}),
        ...(typeof node.href === "string" ? { href: node.href } : {}),
        children: (node.children ?? []).flatMap(inlineFrom),
      },
    ];
  }
  const content = textValue(node);
  return content ? [{ text: content }] : [{ text: "" }];
}

function isInlineLink(node: RichNode): boolean {
  return (
    ["a", "link"].includes(String(node.type)) &&
    typeof (node.url ?? node.href) === "string" &&
    (node.children ?? []).every(
      (child) => typeof child.text === "string" || isInlineLink(child),
    )
  );
}

function paragraphFrom(node: RichNode): RichNode {
  const children =
    node.type === "p" && Array.isArray(node.children)
      ? node.children.flatMap(inlineFrom)
      : inlineFrom(node);
  return {
    ...(typeof node.id === "string" ? { id: node.id } : {}),
    type: "p",
    children: children.length ? children : [{ text: "" }],
  };
}

function cellFrom(node: RichNode): RichNode {
  const paragraphs =
    node.type === "table_cell" && Array.isArray(node.children)
      ? node.children.map(paragraphFrom)
      : [paragraphFrom(node)];
  return {
    ...(typeof node.id === "string" ? { id: node.id } : {}),
    type: "table_cell",
    children: paragraphs.length
      ? paragraphs
      : [{ type: "p", children: [{ text: "" }] }],
  };
}

function rowFrom(node: RichNode): RichNode {
  let cells =
    node.type === "table_row" && Array.isArray(node.children)
      ? node.children.map(cellFrom)
      : [cellFrom(node)];
  if (cells.length === 0) cells = [cellFrom({ type: "table_cell" })];
  if (cells.length > 10) {
    const last = cells[9];
    cells = [
      ...cells.slice(0, 9),
      {
        ...last,
        children: [
          ...(last.children as RichNode[]),
          ...cells.slice(10).flatMap((cell) => cell.children as RichNode[]),
        ],
      },
    ];
  }
  return {
    ...(typeof node.id === "string" ? { id: node.id } : {}),
    type: "table_row",
    children: cells,
  };
}

function tableRows(node: RichNode): RichNode[] {
  let rows = (node.children ?? []).map(rowFrom);
  if (rows.length === 0) rows = [rowFrom({ type: "table_row" })];
  if (rows.length > 20) {
    const last = rows[19];
    const lastCells = last.children as RichNode[];
    for (const overflowRow of rows.slice(20)) {
      const overflowCells = overflowRow.children as RichNode[];
      overflowCells.forEach((cell, index) => {
        const target = lastCells[Math.min(index, lastCells.length - 1)];
        target.children = [
          ...(target.children as RichNode[]),
          ...(cell.children as RichNode[]),
        ];
      });
    }
    rows = rows.slice(0, 20);
  }
  const width = Math.max(
    1,
    ...rows.map((row) => (row.children as RichNode[]).length),
  );
  for (const row of rows) {
    const cells = row.children as RichNode[];
    while (cells.length < width) cells.push(cellFrom({ type: "table_cell" }));
  }
  return rows;
}

function toggleChildren(node: RichNode): RichNode[] {
  const original = node.children ?? [];
  const summary = paragraphFrom(original[0] ?? { type: "p" });
  const body = original.slice(1).map((child) => {
    if (BODY_BLOCKS.has(String(child.type))) return child;
    return paragraphFrom(child);
  });
  if (body.length === 0) body.push(paragraphFrom({ type: "p" }));
  return [summary, ...body];
}

function codeChildren(node: RichNode): RichNode[] {
  const children = node.children ?? [];
  if (
    children.length > 0 &&
    children.every((child) => typeof child.text === "string")
  )
    return children.map(cleanLeaf);
  return children.length
    ? children.map((child, index) =>
        typeof child.text === "string"
          ? cleanLeaf(child)
          : {
              text: `${textValue(child)}${index < children.length - 1 ? "\n" : ""}`,
            },
      )
    : [{ text: "" }];
}

function sameChildren(left: RichNode[], right: RichNode[]): boolean {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (!isNode(value)) return value;
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  };
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

export const RichBlockNormalizationPlugin = createPlatePlugin({
  key: "richBlockNormalization",
}).overrideEditor(({ editor, tf: { normalizeNode } }) => ({
  transforms: {
    normalizeNode([node, path]) {
      if (!isNode(node)) {
        normalizeNode([node, path]);
        return;
      }
      if (
        (Object.hasOwn(node, "checked") && node.type !== "todo") ||
        (Object.hasOwn(node, "language") && node.type !== "code_block")
      ) {
        editor.tf.unsetNodes(
          [
            ...(node.type === "todo" ? [] : ["checked"]),
            ...(node.type === "code_block" ? [] : ["language"]),
          ],
          { at: path },
        );
        return;
      }
      if (
        node.type === "todo" &&
        Object.hasOwn(node, "checked") &&
        typeof node.checked !== "boolean"
      ) {
        editor.tf.setNodes({ checked: false }, { at: path });
        return;
      }
      if (
        node.type === "code_block" &&
        Object.hasOwn(node, "language") &&
        (typeof node.language !== "string" ||
          node.language.length > 32 ||
          !/^[A-Za-z][A-Za-z0-9_+-]{0,31}$/.test(node.language))
      ) {
        editor.tf.setNodes({ language: "plain" }, { at: path });
        return;
      }

      const parent = path.length ? editor.api.parent(path)?.[0] : undefined;
      if (
        (node.type === "table_row" && parent?.type !== "table") ||
        (node.type === "table_cell" && parent?.type !== "table_row")
      ) {
        const paragraph = paragraphFrom(node);
        editor.tf.withoutNormalizing(() => {
          editor.tf.setNodes({ type: "p" }, { at: path });
          editor.tf.replaceNodes(
            paragraph.children as Parameters<typeof editor.tf.replaceNodes>[0],
            { at: path, children: true },
          );
        });
        return;
      }

      let nextChildren: RichNode[] | undefined;
      if (node.type === "table") nextChildren = tableRows(node);
      else if (node.type === "table_row")
        nextChildren = rowFrom(node).children as RichNode[];
      else if (node.type === "table_cell")
        nextChildren = cellFrom(node).children as RichNode[];
      else if (node.type === "toggle") nextChildren = toggleChildren(node);
      else if (node.type === "code_block") nextChildren = codeChildren(node);

      if (
        nextChildren &&
        (!Array.isArray(node.children) ||
          !sameChildren(node.children, nextChildren))
      ) {
        editor.tf.replaceNodes(
          nextChildren as Parameters<typeof editor.tf.replaceNodes>[0],
          { at: path, children: true },
        );
        return;
      }
      normalizeNode([node, path]);
    },
  },
}));
