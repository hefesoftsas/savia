import { useState } from "react";
import { codeFenceInputRule } from "./code-input";
import {
  PlateElement,
  useEditorRef,
  usePath,
  useReadOnly,
  createPlatePlugin,
  type PlateElementProps,
} from "platejs/react";
import { useMessages } from "@/i18n/core";
import { editorMessages } from "./editor-messages";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Copy, Minus, Plus, X } from "lucide-react";

export const CODE_LANGUAGES = [
  "plain",
  "javascript",
  "typescript",
  "json",
  "bash",
  "sql",
  "html",
  "css",
  "python",
  "yaml",
] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

// Memoized element views can retain their old path when a sibling is inserted.
// Resolve controls against the current document at the time of interaction.
function findBlockPath(
  nodes: unknown[],
  element: unknown,
  parent: number[] = [],
): number[] | undefined {
  const elementId = (element as { id?: unknown }).id;
  for (const [index, value] of nodes.entries()) {
    if (!value || typeof value !== "object") continue;
    const node = value as { id?: unknown; children?: unknown[] };
    const path = [...parent, index];
    if (node === element || (elementId && node.id === elementId)) return path;
    if (node.children) {
      const nested = findBlockPath(node.children, element, path);
      if (nested) return nested;
    }
  }
}

export function richBlockTemplate(type: string): Record<string, unknown> {
  if (type === "code_block")
    return { type, language: "plain", children: [{ text: "" }] };
  if (type === "todo")
    return { type, checked: false, children: [{ text: "" }] };
  if (type === "numbered") return { type, children: [{ text: "" }] };
  if (type === "divider") return { type, children: [{ text: "" }] };
  if (type === "callout") return { type, children: [{ text: "" }] };
  if (type === "toggle")
    return {
      type,
      children: [
        { type: "p", children: [{ text: "" }] },
        { type: "p", children: [{ text: "" }] },
      ],
    };
  if (type === "table")
    return {
      type,
      children: [
        {
          type: "table_row",
          children: [
            {
              type: "table_cell",
              children: [{ type: "p", children: [{ text: "" }] }],
            },
            {
              type: "table_cell",
              children: [{ type: "p", children: [{ text: "" }] }],
            },
          ],
        },
        {
          type: "table_row",
          children: [
            {
              type: "table_cell",
              children: [{ type: "p", children: [{ text: "" }] }],
            },
            {
              type: "table_cell",
              children: [{ type: "p", children: [{ text: "" }] }],
            },
          ],
        },
      ],
    };
  return { type: "p", children: [{ text: "" }] };
}

function CodeBlockElement(props: PlateElementProps) {
  const editor = useEditorRef();
  const path = usePath();
  const currentPath = () =>
    findBlockPath(editor.children, props.element) ?? path;
  const readOnly = useReadOnly();
  const t = useMessages(editorMessages);
  const language = String(props.element.language ?? "plain");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  return (
    <PlateElement {...props} as="pre" className="page-code-block">
      <div className="page-code-toolbar" contentEditable={false}>
        <span>{t("Code")}</span>
        <label
          className="sr-only"
          htmlFor={`page-code-language-${path.join("-")}`}
        >
          {t("Code language")}
        </label>
        <select
          id={`page-code-language-${path.join("-")}`}
          aria-label={t("Code language")}
          value={
            CODE_LANGUAGES.includes(language as CodeLanguage)
              ? language
              : "plain"
          }
          disabled={readOnly}
          onChange={(event) =>
            editor.tf.setNodes(
              { language: event.target.value },
              { at: currentPath() },
            )
          }
        >
          {CODE_LANGUAGES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={t(
            copyState === "copied"
              ? "Code copied"
              : copyState === "failed"
                ? "Copy unavailable"
                : "Copy code",
          )}
          onClick={async () => {
            try {
              if (!navigator.clipboard?.writeText)
                throw new Error("Clipboard unavailable");
              await navigator.clipboard.writeText(
                editor.api.string(currentPath()),
              );
              setCopyState("copied");
            } catch {
              setCopyState("failed");
            }
          }}
        >
          <Copy aria-hidden="true" />
          {copyState !== "idle" && (
            <span>
              {t(copyState === "copied" ? "Code copied" : "Copy unavailable")}
            </span>
          )}
        </Button>
      </div>
      <code>{props.children}</code>
    </PlateElement>
  );
}
function TodoElement(props: PlateElementProps) {
  const editor = useEditorRef();
  const path = usePath();
  const currentPath = () =>
    findBlockPath(editor.children, props.element) ?? path;
  const readOnly = useReadOnly();
  const t = useMessages(editorMessages);
  return (
    <PlateElement {...props} as="div" className="page-todo">
      <input
        type="checkbox"
        aria-label={t("Mark task complete")}
        checked={Boolean(props.element.checked)}
        disabled={readOnly}
        contentEditable={false}
        onChange={(event) =>
          editor.tf.setNodes(
            { checked: event.target.checked },
            { at: currentPath() },
          )
        }
      />
      <div
        className={
          props.element.checked ? "page-todo-text is-checked" : "page-todo-text"
        }
      >
        {props.children}
      </div>
    </PlateElement>
  );
}
function NumberedElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="p" className="page-numbered">
      {props.children}
    </PlateElement>
  );
}

function BulletElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="p" className="page-bullet">
      {props.children}
    </PlateElement>
  );
}

function CalloutElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="div" className="page-callout">
      {props.children}
    </PlateElement>
  );
}
function DividerElement(props: PlateElementProps) {
  const t = useMessages(editorMessages);
  return (
    <PlateElement {...props} as="div" className="page-divider">
      <hr aria-label={t("Divider")} contentEditable={false} />
      {props.children}
    </PlateElement>
  );
}
function ToggleElement(props: PlateElementProps) {
  const [expanded, setExpanded] = useState(true);
  const t = useMessages(editorMessages);
  return (
    <PlateElement
      {...props}
      as="section"
      className={expanded ? "page-toggle" : "page-toggle is-collapsed"}
    >
      <button
        type="button"
        className="page-toggle-trigger"
        aria-expanded={expanded}
        aria-label={t(expanded ? "Collapse toggle" : "Expand toggle")}
        contentEditable={false}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? (
          <ChevronDown aria-hidden="true" />
        ) : (
          <ChevronRight aria-hidden="true" />
        )}
      </button>
      <div className="page-toggle-content">{props.children}</div>
    </PlateElement>
  );
}

function TableElement(props: PlateElementProps) {
  const editor = useEditorRef();
  const path = usePath();
  const currentPath = () =>
    findBlockPath(editor.children, props.element) ?? path;
  const readOnly = useReadOnly();
  const t = useMessages(editorMessages);
  const rowCount = Array.isArray(props.element.children)
    ? props.element.children.length
    : 0;
  const columnCount = Array.isArray(
    (props.element.children?.[0] as { children?: unknown[] } | undefined)
      ?.children,
  )
    ? (props.element.children[0] as { children: unknown[] }).children.length
    : 0;
  const row = () => ({
    type: "table_row",
    children: Array.from({ length: columnCount }, () => ({
      type: "table_cell",
      children: [{ type: "p", children: [{ text: "" }] }],
    })),
  });
  const columnCell = () => ({
    type: "table_cell",
    children: [{ type: "p", children: [{ text: "" }] }],
  });
  return (
    <PlateElement {...props} as="div" className="page-table-block">
      {!readOnly && (
        <div className="page-table-controls" contentEditable={false}>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={rowCount >= 20}
            onClick={() =>
              editor.tf.insertNodes(row(), { at: [...currentPath(), rowCount] })
            }
          >
            <Plus aria-hidden="true" />
            {t("Add row")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={rowCount <= 1}
            onClick={() =>
              editor.tf.removeNodes({ at: [...currentPath(), rowCount - 1] })
            }
          >
            <Minus aria-hidden="true" />
            {t("Remove row")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={columnCount >= 10}
            onClick={() =>
              editor.tf.withoutNormalizing(() => {
                Array.from({ length: rowCount }, (_, index) =>
                  editor.tf.insertNodes(columnCell(), {
                    at: [...currentPath(), index, columnCount],
                  }),
                );
              })
            }
          >
            <Plus aria-hidden="true" />
            {t("Add column")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={columnCount <= 1}
            onClick={() =>
              editor.tf.withoutNormalizing(() => {
                Array.from({ length: rowCount }, (_, index) =>
                  editor.tf.removeNodes({
                    at: [...currentPath(), index, columnCount - 1],
                  }),
                );
              })
            }
          >
            <X aria-hidden="true" />
            {t("Remove column")}
          </Button>
        </div>
      )}
      <table>
        <tbody>{props.children}</tbody>
      </table>
    </PlateElement>
  );
}
function TableRowElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="tr">
      {props.children}
    </PlateElement>
  );
}
function TableCellElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="td">
      {props.children}
    </PlateElement>
  );
}

export const richBlockPlugins = [
  createPlatePlugin({
    key: "code_block",
    inputRules: [codeFenceInputRule],
    node: { isElement: true, component: CodeBlockElement },
  }),
  createPlatePlugin({
    key: "todo",
    node: { isElement: true, component: TodoElement },
  }),
  createPlatePlugin({
    key: "bullet",
    node: { isElement: true, component: BulletElement },
  }),
  createPlatePlugin({
    key: "numbered",
    node: { isElement: true, component: NumberedElement },
  }),
  createPlatePlugin({
    key: "callout",
    node: { isElement: true, component: CalloutElement },
  }),
  createPlatePlugin({
    key: "divider",
    node: { isElement: true, isVoid: true, component: DividerElement },
  }),
  createPlatePlugin({
    key: "toggle",
    node: { isElement: true, component: ToggleElement },
  }),
  createPlatePlugin({
    key: "table",
    node: { isElement: true, component: TableElement },
  }),
  createPlatePlugin({
    key: "table_row",
    node: { isElement: true, component: TableRowElement },
  }),
  createPlatePlugin({
    key: "table_cell",
    node: { isElement: true, component: TableCellElement },
  }),
];
