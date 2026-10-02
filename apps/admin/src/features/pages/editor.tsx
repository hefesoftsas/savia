import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Plate,
  PlateContent,
  PlateElement,
  createPlatePlugin,
  usePlateEditor,
  type PlateElementProps,
} from "platejs/react";
import { type Value } from "platejs";
import {
  BasicBlocksPlugin,
  BasicMarksPlugin,
} from "@platejs/basic-nodes/react";
import { LinkPlugin } from "@platejs/link/react";
import type { ApiClient } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useMessages } from "@/i18n/core";
import { pagesMessages } from "./messages";
import { editorMessages } from "./editor-messages";
import { parseIssueLink } from "@savia/studio-shared/issue-links";
import { IssueCard } from "./issue-card";
import { CollectionBlock, type CollectionReference } from "./collection-block";
import { richBlockPlugins, richBlockTemplate } from "./rich-blocks";
import { RichBlockNormalizationPlugin } from "./rich-block-normalization";
import { PagesClient } from "./client";
import {
  Code,
  ArrowUpToLine,
  ArrowDownToLine,
  GripVertical,
  Trash2,
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  Plus,
  Quote,
  Type,
  Paperclip,
  Search,
  Table2,
} from "lucide-react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  listWidgetCollections,
  listWidgetTenants,
} from "@/features/my-day-widgets/data";
import type {
  WidgetCollection,
  WidgetTenant,
} from "@/features/my-day-widgets/types";
import "./editor.css";
import { navigateBlockEdge } from "./block-navigation";
import { codeLanguage, fencedCodePaste } from "./code-input";

const EditorContext = createContext<{
  api: ApiClient;
  pages: PagesClient;
  pageId: string;
  issueProviders: Array<"jira" | "linear">;
} | null>(null);
function useEditorContext() {
  const value = useContext(EditorContext);
  if (!value) throw new Error("Missing page editor context");
  return value;
}

function nodeAtPath(root: unknown[], path: number[]) {
  let node: unknown = root[path[0]];
  for (const index of path.slice(1)) {
    const children = (node as { children?: unknown[] } | undefined)?.children;
    node = children?.[index];
  }
  return node as { type?: string; children?: unknown[] } | undefined;
}
function ancestorPath(root: unknown[], path: number[], type: string) {
  for (let length = path.length; length > 0; length--) {
    const candidate = path.slice(0, length);
    if (nodeAtPath(root, candidate)?.type === type) return candidate;
  }
  return undefined;
}

function normalizeCommandSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}
function IssueElement(props: PlateElementProps) {
  const { api, issueProviders } = useEditorContext();
  const url = String(props.element.url ?? "");
  const issue = parseIssueLink(url);
  return (
    <PlateElement {...props}>
      <div contentEditable={false}>
        {issue && issueProviders.includes(issue.provider) ? (
          <IssueCard url={url} api={api} />
        ) : issue ? (
          <a
            href={issue.url}
            target="_blank"
            rel="noopener noreferrer"
            className="page-issue-link"
          >
            {issue?.identifier ?? url}
          </a>
        ) : (
          <span>{url}</span>
        )}
      </div>
      {props.children}
    </PlateElement>
  );
}
function CollectionElement(props: PlateElementProps) {
  const { api } = useEditorContext();
  const e = props.element;
  return (
    <PlateElement {...props}>
      <div contentEditable={false}>
        <CollectionBlock
          api={api}
          reference={{
            domain: String(e.domain),
            collection: String(e.collection),
            mode: e.mode === "pipeline" ? "pipeline" : "table",
            ...(e.viewId ? { viewId: String(e.viewId) } : {}),
          }}
        />
      </div>
      {props.children}
    </PlateElement>
  );
}
function AttachmentElement(props: PlateElementProps) {
  const { pages, pageId } = useEditorContext(),
    t = useMessages(pagesMessages);
  const [source, setSource] = useState<string>(),
    [failed, setFailed] = useState(false);
  const fileId = String(props.element.fileId),
    mime = String(props.element.mimeType ?? "");
  useEffect(() => {
    let active = true,
      objectUrl: string | undefined;
    setSource(undefined);
    setFailed(false);
    void pages
      .file(pageId, fileId)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [pages, pageId, fileId]);
  return (
    <PlateElement {...props}>
      <div contentEditable={false} className="my-4">
        {source && /^image\/(png|jpeg|webp|gif)$/.test(mime) && (
          <img
            className="mb-2 max-h-96 max-w-full rounded-md object-contain"
            src={source}
            alt={String(props.element.name ?? "")}
          />
        )}
        {source ? (
          <a
            href={source}
            download={String(props.element.name)}
            className="underline"
          >
            {String(props.element.name)} · {t("Download")}
          </a>
        ) : (
          <p role={failed ? "alert" : "status"}>
            {t(failed ? "Unavailable" : "Loading")}
          </p>
        )}
      </div>
      {props.children}
    </PlateElement>
  );
}
function LinkElement(props: PlateElementProps) {
  const url = String(props.element.url ?? "");
  const valid = /^(https?:\/\/|mailto:)/i.test(url);
  return (
    <a
      {...props.attributes}
      href={valid ? url : undefined}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-4"
      onClick={(event) => event.stopPropagation()}
    >
      {props.children}
    </a>
  );
}
const plugins = [
  BasicBlocksPlugin,
  BasicMarksPlugin,
  LinkPlugin.configure({
    options: { allowedSchemes: ["https", "http", "mailto"] },
    node: { component: LinkElement },
  }),
  createPlatePlugin({
    key: "issue",
    node: { isElement: true, isVoid: true, component: IssueElement },
  }),
  createPlatePlugin({
    key: "collection",
    node: { isElement: true, isVoid: true, component: CollectionElement },
  }),
  createPlatePlugin({
    key: "attachment",
    node: { isElement: true, isVoid: true, component: AttachmentElement },
  }),
  ...richBlockPlugins,
  RichBlockNormalizationPlugin,
];
const emptyIssueProviders: Array<"jira" | "linear"> = [];

export const PageEditor = memo(function PageEditor({
  pageId,
  initialValue,
  readOnly,
  api,
  pages,
  onChange,
  onPendingUpload,
  issueProviders = emptyIssueProviders,
}: {
  pageId: string;
  initialValue: Value;
  readOnly: boolean;
  api: ApiClient;
  pages: PagesClient;
  onChange(value: Value): void;
  onPendingUpload?(pending: boolean): void;
  issueProviders?: Array<"jira" | "linear">;
}) {
  const context = useMemo(
    () => ({ api, pages, pageId, issueProviders }),
    [api, pages, pageId, issueProviders],
  );
  const t = useMessages(pagesMessages);
  const te = useMessages(editorMessages);
  const editor = usePlateEditor({
    plugins,
    override: {
      components: {
        p: (props: PlateElementProps) => <PlateElement {...props} as="p" />,
        h1: (props: PlateElementProps) => <PlateElement {...props} as="h1" />,
        h2: (props: PlateElementProps) => <PlateElement {...props} as="h2" />,
        h3: (props: PlateElementProps) => <PlateElement {...props} as="h3" />,
        blockquote: (props: PlateElementProps) => (
          <PlateElement {...props} as="blockquote" />
        ),
      },
    },
    value: initialValue.length
      ? initialValue
      : [{ type: "p", children: [{ text: "" }] }],
  });
  const [insert, setInsert] = useState<"issue" | "collection" | null>(null),
    [url, setUrl] = useState("");
  const [issueProviderToInsert, setIssueProviderToInsert] = useState<
    "jira" | "linear" | null
  >(null);
  const [slashMenu, setSlashMenu] = useState(false),
    [commandQuery, setCommandQuery] = useState("");
  const [slashPoint, setSlashPoint] = useState({ x: 0, y: 0 });
  const insertPath = useRef<number | undefined>(undefined);
  const slashMenuRef = useRef<HTMLDivElement | null>(null);
  const editorContentRef = useRef<HTMLDivElement | null>(null);
  const slashSelection = useRef(editor.selection);
  const returnFocusToEditor = useRef(true);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [selectionTools, setSelectionTools] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [insertPoint, setInsertPoint] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [hoverBlock, setHoverBlock] = useState<{
    index: number;
    y: number;
  } | null>(null);
  useEffect(() => {
    if (readOnly || !hoverBlock || slashMenu || insert) return;
    const node = editor.children[hoverBlock.index];
    const element = node && editor.api.toDOMNode(node);
    if (!element) return;
    element.setAttribute("data-block-highlighted", "true");
    return () => element.removeAttribute("data-block-highlighted");
  }, [editor, hoverBlock, readOnly, slashMenu, insert]);
  const blockControlsRef = useRef<HTMLDivElement | null>(null);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  function keepBlockControls() {
    clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = undefined;
  }
  function scheduleHideBlockControls() {
    keepBlockControls();
    hideControlsTimer.current = setTimeout(() => {
      if (
        !draggedBlock.current &&
        !blockControlsRef.current?.contains(document.activeElement)
      )
        setHoverBlock(null);
    }, 400);
  }
  useEffect(() => () => clearTimeout(hideControlsTimer.current), []);
  const [dropLine, setDropLine] = useState<number | null>(null);
  const draggedBlock = useRef<(typeof editor.children)[number] | null>(null);
  function blockAtTarget(target: EventTarget | null) {
    if (!(target instanceof Element)) return null;
    const textbox = editorContentRef.current?.querySelector('[role="textbox"]');
    if (!textbox || !textbox.contains(target)) return null;
    let element = target;
    while (element.parentElement && element.parentElement !== textbox)
      element = element.parentElement;
    if (element.getAttribute("data-slate-node") !== "element") return null;
    // Slate caches DOM/node paths; do not scan every sibling on pointer movement.
    const node = editor.api.toSlateNode(element);
    const path = node && editor.api.findPath(node);
    return path?.length === 1 ? { index: path[0], element } : null;
  }
  function showBlockControls(target: EventTarget | null) {
    if (readOnly || draggedBlock.current) return;
    keepBlockControls();
    if (blockControlsRef.current?.contains(document.activeElement)) return;
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const block =
      blockAtTarget(target) ??
      (target instanceof Element && target.getAttribute("role") === "textbox"
        ? blockAtTarget(
            anchor instanceof Element
              ? anchor
              : (anchor?.parentElement ?? null),
          )
        : null);
    const shell = editorContentRef.current?.closest(".page-editor-shell");
    if (block && shell)
      setHoverBlock((previous) => {
        const y =
          block.element.getBoundingClientRect().top -
          shell.getBoundingClientRect().top;
        return previous?.index === block.index && previous.y === y
          ? previous
          : { index: block.index, y };
      });
  }
  function moveBlock(from: number, to: number) {
    if (readOnly || from === to || to < 0 || to >= editor.children.length)
      return;
    editor.tf.moveNodes({ at: [from], to: [to] });
    setHoverBlock(null);
    const point = editor.api.start([to]);
    if (point) editor.tf.select(point);
    editor.tf.focus();
  }
  function insertBesideBlock(direction: "above" | "below") {
    if (readOnly || !hoverBlock) return;
    const index = hoverBlock.index + (direction === "below" ? 1 : 0);
    editor.tf.insertNodes(
      { type: "p", children: [{ text: "" }] },
      { at: [index] },
    );
    editor.tf.select({ path: [index, 0], offset: 0 });
    setHoverBlock(null);
    editor.tf.focus();
  }
  function deleteHoveredBlock() {
    if (readOnly || !hoverBlock) return;
    const index = hoverBlock.index;
    editor.tf.withoutNormalizing(() => {
      editor.tf.removeNodes({ at: [index] });
      if (!editor.children.length)
        editor.tf.insertNodes(
          { type: "p", children: [{ text: "" }] },
          { at: [0] },
        );
    });
    setHoverBlock(null);
    editor.tf.focus();
  }
  const commandSearchRef = useRef<HTMLInputElement | null>(null);
  function rememberInsertPath() {
    const block = editor.api.block();
    insertPath.current = block
      ? Number(block[1][0])
      : editor.children.length - 1;
  }
  function currentBlockIsEmpty() {
    const block = editor.api.block();
    if (block) return editor.api.string(block[1]).length === 0;
    const current = (block?.[0] ?? editor.children.at(-1)) as
      { children?: Array<{ text?: string }> } | undefined;
    return Boolean(
      current?.children?.every(
        (child) => typeof child.text === "string" && child.text.length === 0,
      ),
    );
  }
  type Command = {
    id: string;
    label: string;
    icon: typeof Type;
    action: () => void;
    aliases?: string[];
  };
  const commands: Command[] = [
    {
      id: "text",
      label: t("Text"),
      icon: Type,
      action: () => applySlashBlock("p"),
    },
    {
      id: "h1",
      label: te("Title 1"),
      icon: Heading1,
      action: () => applySlashBlock("h1"),
      aliases: ["título 1", "titulo 1"],
    },
    {
      id: "h2",
      label: te("Title 2"),
      icon: Heading2,
      action: () => applySlashBlock("h2"),
      aliases: ["título 2", "titulo 2"],
    },
    {
      id: "h3",
      label: te("Title 3"),
      icon: Heading3,
      action: () => applySlashBlock("h3"),
      aliases: ["título 3", "titulo 3"],
    },
    {
      id: "quote",
      label: t("Quote"),
      icon: Quote,
      action: () => applySlashBlock("blockquote"),
    },
    {
      id: "bullet",
      label: t("List"),
      icon: List,
      action: () => applySlashBlock("bullet"),
    },
    {
      id: "numbered",
      label: te("Numbered list"),
      icon: List,
      action: () => applySlashBlock("numbered"),
      aliases: [
        "numbered list",
        "ordered list",
        "numerada",
        "lista numerada",
        "lista ordenada",
        "lista numerada",
      ],
    },
    {
      id: "code_block",
      label: te("Code"),
      icon: Type,
      action: () => applySlashBlock("code_block"),
      aliases: [
        "code",
        "código",
        "codigo",
        "código",
        "código fuente",
        "source",
      ],
    },
    {
      id: "todo",
      label: te("To-do"),
      icon: List,
      action: () => applySlashBlock("todo"),
      aliases: ["todo", "to-do", "task", "tarea", "tarefa"],
    },
    {
      id: "callout",
      label: te("Callout"),
      icon: Quote,
      action: () => applySlashBlock("callout"),
      aliases: ["callout", "note", "nota", "aviso"],
    },
    {
      id: "toggle",
      label: te("Toggle"),
      icon: List,
      action: () => applySlashBlock("toggle"),
      aliases: ["toggle", "disclosure", "desplegable", "expandir", "recolher"],
    },
    {
      id: "table",
      label: te("Table"),
      icon: Table2,
      action: () => applySlashBlock("table"),
      aliases: ["table", "tabla", "tabela", "grid"],
    },
    {
      id: "divider",
      label: te("Divider"),
      icon: Plus,
      action: () => applySlashBlock("divider"),
      aliases: ["divider", "horizontal rule", "separador", "divisor", "linha"],
    },
    {
      id: "collection",
      label: t("Collection"),
      icon: Table2,
      action: () => openSlashInsert("collection"),
    },
    {
      id: "attachment",
      label: t("Attachment"),
      icon: Paperclip,
      action: () => {
        setSlashMenu(false);
        returnFocusToEditor.current = false;
        fileInput.current?.click();
      },
    },
    ...issueProviders.map((provider) => ({
      id: `issue-${provider}`,
      label: te(provider === "jira" ? "Jira issue" : "Linear issue"),
      icon: Type,
      action: () => openSlashInsert("issue", provider),
    })),
  ];
  function selectedPathFlags() {
    const path = editor.api.block()?.[1] ?? [];
    let nodes: unknown[] = editor.children;
    let insideTableCell = false;
    let inToggleSummary = false;
    let current: { type?: string; children?: unknown[] } | undefined;
    path.forEach((index, depth) => {
      current = nodes[index] as typeof current;
      if (current?.type === "table_cell") insideTableCell = true;
      if (current?.type === "toggle" && path[depth + 1] === 0)
        inToggleSummary = true;
      nodes = current?.children ?? [];
    });
    return { insideTableCell, inToggleSummary };
  }
  const flags = selectedPathFlags();
  const filteredCommands = commands.filter(
    (command) =>
      ((!flags.insideTableCell && !flags.inToggleSummary) ||
        command.id === "text") &&
      [command.label, ...(command.aliases ?? [])].some((label) =>
        normalizeCommandSearch(label).includes(
          normalizeCommandSearch(commandQuery.trim()),
        ),
      ),
  );
  function applySlashBlock(type: string) {
    if (slashSelection.current) editor.tf.select(slashSelection.current);
    const selected = editor.api.block();
    if (
      selected &&
      [
        "code_block",
        "todo",
        "numbered",
        "callout",
        "toggle",
        "table",
        "divider",
      ].includes(type)
    ) {
      const path = selected[1];
      const original = selected[0] as {
        children?: Array<{ text?: string; [key: string]: unknown }>;
      };
      const sourceChildren = original.children ?? [{ text: "" }];
      const preserveInBlock = [
        "code_block",
        "todo",
        "numbered",
        "callout",
      ].includes(type);
      const originalText = editor.api.string(path);
      const node = richBlockTemplate(type) as {
        type: string;
        children: unknown[];
        [key: string]: unknown;
      };
      if (preserveInBlock)
        node.children =
          type === "code_block" ? [{ text: originalText }] : sourceChildren;
      if (type === "toggle" && originalText.length > 0) {
        node.children[0] = { type: "p", children: sourceChildren };
        node.children.push({ type: "p", children: [{ text: "" }] });
      }
      const insertAfter =
        ["table", "divider"].includes(type) && originalText.length > 0;
      const targetPath = insertAfter
        ? [...path.slice(0, -1), path[path.length - 1] + 1]
        : path;
      editor.tf.withoutNormalizing(() => {
        if (insertAfter) {
          editor.tf.insertNodes(
            [node as never, { type: "p", children: [{ text: "" }] }],
            { at: targetPath },
          );
        } else {
          editor.tf.removeNodes({ at: path });
          editor.tf.insertNodes(
            [node as never, { type: "p", children: [{ text: "" }] }],
            { at: path },
          );
        }
      });
      const nextSiblingPath = [
        ...targetPath.slice(0, -1),
        targetPath[targetPath.length - 1] + 1,
      ];
      const focusPath =
        type === "divider"
          ? [...nextSiblingPath, 0]
          : type === "toggle"
            ? [...targetPath, 0, 0]
            : type === "table"
              ? [...targetPath, 0, 0, 0, 0]
              : [...targetPath, 0];
      editor.tf.select({ path: focusPath, offset: 0 });
    } else if (selected) {
      editor.tf.unsetNodes(["language", "checked"], { at: selected[1] });
      editor.tf.setNodes({ type }, { at: selected[1] });
    }
    slashSelection.current = editor.selection;
    returnFocusToEditor.current = true;
    setSlashMenu(false);
    setCommandQuery("");
  }
  function openSlashInsert(
    kind: "issue" | "collection",
    provider?: "jira" | "linear",
  ) {
    returnFocusToEditor.current = false;
    setSlashMenu(false);
    setCommandQuery("");
    setIssueProviderToInsert(provider ?? null);
    setInsert(kind);
  }
  function focusEditor() {
    window.requestAnimationFrame(() => {
      if (slashSelection.current) editor.tf.select(slashSelection.current);
      editor.tf.focus();
      editorContentRef.current
        ?.querySelector<HTMLElement>('[role="textbox"]')
        ?.focus();
    });
  }
  function append(node: { type: string; [key: string]: unknown }) {
    const at = Math.max(
      0,
      Math.min(
        insertPath.current ?? editor.children.length - 1,
        editor.children.length,
      ),
    );
    editor.tf.insertNodes(
      [
        { ...node, children: [{ text: "" }] },
        { type: "p", children: [{ text: "" }] },
      ],
      { at: [at + 1] },
    );
    setInsert(null);
    setSlashMenu(false);
    setUrl("");
    setError("");
    focusEditor();
  }
  function openCommandPicker(point?: { x: number; y: number }) {
    rememberInsertPath();
    if (!editor.selection) {
      const block = editor.api.block();
      const index = block
        ? Number(block[1][0])
        : Math.max(0, editor.children.length - 1);
      editor.tf.select({ path: [index, 0], offset: 0 });
    }
    slashSelection.current = editor.selection;
    setCommandQuery("");
    returnFocusToEditor.current = true;
    if (point) setSlashPoint(point);
    else {
      const selection = window.getSelection();
      const range =
        selection && selection.rangeCount ? selection.getRangeAt(0) : undefined;
      const rangeRect = range?.getBoundingClientRect?.();
      const hasPosition = (rect?: DOMRect) =>
        Boolean(
          rect &&
          (rect.width > 0 ||
            rect.height > 0 ||
            rect.left !== 0 ||
            rect.top !== 0 ||
            rect.bottom !== 0),
        );
      let rect = hasPosition(rangeRect) ? rangeRect : undefined;
      if (!rect && selection?.anchorNode) {
        const anchorElement =
          selection.anchorNode instanceof Element
            ? selection.anchorNode
            : selection.anchorNode.parentElement;
        const block = anchorElement?.closest<HTMLElement>(
          '[data-slate-node="element"]',
        );
        const blockRect = block?.getBoundingClientRect();
        if (hasPosition(blockRect)) rect = blockRect;
      }
      if (!rect) {
        const [, path] = editor.api.block() ?? [];
        const selectedBlock =
          path &&
          editorContentRef.current
            ?.querySelector('[role="textbox"]')
            ?.children.item(Number(path[0]));
        const blockRect = selectedBlock?.getBoundingClientRect();
        if (hasPosition(blockRect)) rect = blockRect;
      }
      if (!rect) {
        const contentRect = editorContentRef.current?.getBoundingClientRect();
        if (hasPosition(contentRect)) rect = contentRect;
      }
      setSlashPoint({ x: rect?.left ?? 0, y: rect?.bottom ?? 0 });
    }
    setSlashMenu(true);
  }
  function refreshEditorControls() {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
    const rect = range?.getBoundingClientRect?.() ?? {
      left: 0,
      top: 0,
      width: 0,
      bottom: 0,
    };
    if (
      selection &&
      selection.rangeCount &&
      !selection.isCollapsed &&
      editorContentRef.current?.contains(selection.anchorNode)
    ) {
      const bounds = editorContentRef.current.getBoundingClientRect();
      const x = Math.max(8, rect.left + rect.width / 2 - bounds.left);
      const y = Math.max(0, rect.top - bounds.top - 44);
      setSelectionTools((previous) =>
        previous?.x === x && previous.y === y ? previous : { x, y },
      );
      setInsertPoint(null);
      return;
    }
    setSelectionTools(null);
    if (
      selection &&
      selection.rangeCount &&
      editorContentRef.current?.contains(selection.anchorNode)
    ) {
      const bounds = editorContentRef.current.getBoundingClientRect();
      const y = Math.max(0, rect.top - bounds.top);
      setInsertPoint((previous) =>
        previous?.y === y ? previous : { x: 0, y },
      );
    }
  }
  const controlsFrame = useRef<number | undefined>(undefined);
  function scheduleEditorControls() {
    if (controlsFrame.current !== undefined)
      cancelAnimationFrame(controlsFrame.current);
    controlsFrame.current = requestAnimationFrame(() => {
      controlsFrame.current = undefined;
      refreshEditorControls();
      const anchor = window.getSelection()?.anchorNode;
      showBlockControls(
        anchor instanceof Element ? anchor : (anchor?.parentElement ?? null),
      );
    });
  }
  const scheduleControlsRef = useRef(scheduleEditorControls);
  scheduleControlsRef.current = scheduleEditorControls;
  useEffect(() => {
    const onResize = () => scheduleControlsRef.current();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (controlsFrame.current !== undefined)
        cancelAnimationFrame(controlsFrame.current);
    };
  }, []);
  return (
    <EditorContext.Provider value={context}>
      <Plate
        editor={editor}
        readOnly={readOnly}
        onValueChange={({ value }) => onChange(value)}
        onSelectionChange={scheduleEditorControls}
      >
        <div
          className="page-editor-shell"
          onMouseMove={(event) => showBlockControls(event.target)}
          onMouseEnter={keepBlockControls}
          onMouseLeave={scheduleHideBlockControls}
          onDragOverCapture={(event) => {
            if (readOnly || !draggedBlock.current) return;
            const block = blockAtTarget(event.target);
            if (!block) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            const rect = block.element.getBoundingClientRect();
            const shell = event.currentTarget.getBoundingClientRect();
            setDropLine(
              (event.clientY < rect.top + rect.height / 2
                ? rect.top
                : rect.bottom) - shell.top,
            );
          }}
          onDropCapture={(event) => {
            if (readOnly || !draggedBlock.current) return;
            event.preventDefault();
            event.stopPropagation();
            const block = blockAtTarget(event.target);
            const from = editor.children.findIndex(
              (node) => node === draggedBlock.current,
            );
            if (block && from >= 0) {
              const rect = block.element.getBoundingClientRect();
              const boundary =
                block.index +
                (event.clientY >= rect.top + rect.height / 2 ? 1 : 0);
              moveBlock(from, boundary - (from < boundary ? 1 : 0));
            }
            draggedBlock.current = null;
            setDropLine(null);
            setHoverBlock(null);
          }}
        >
          {!readOnly && (
            <>
              {hoverBlock && !slashMenu && !insert && (
                <div
                  className="page-editor-block-controls"
                  ref={blockControlsRef}
                  role="toolbar"
                  aria-label={te("Block actions")}
                  onMouseEnter={keepBlockControls}
                  onFocusCapture={keepBlockControls}
                  onBlurCapture={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget))
                      scheduleHideBlockControls();
                  }}
                  style={{ top: hoverBlock.y }}
                  contentEditable={false}
                >
                  <button
                    type="button"
                    draggable
                    aria-label={te("Move block")}
                    title={te("Move block hint")}
                    onClick={() => {
                      const point = editor.api.start([hoverBlock.index]);
                      if (point) editor.tf.select(point);
                      editor.tf.focus();
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key === "ArrowUp" ||
                        event.key === "ArrowDown"
                      ) {
                        event.preventDefault();
                        moveBlock(
                          hoverBlock.index,
                          hoverBlock.index + (event.key === "ArrowUp" ? -1 : 1),
                        );
                      }
                    }}
                    onDragStart={(event) => {
                      draggedBlock.current = editor.children[hoverBlock.index];
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData(
                        "application/x-savia-page-block",
                        "move",
                      );
                    }}
                    onDragEnd={() => {
                      draggedBlock.current = null;
                      setDropLine(null);
                      setHoverBlock(null);
                    }}
                  >
                    <GripVertical size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={te("Write above")}
                    title={te("Write above")}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertBesideBlock("above")}
                  >
                    <ArrowUpToLine size={15} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={te("Write below")}
                    title={te("Write below")}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertBesideBlock("below")}
                  >
                    <ArrowDownToLine size={15} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={te("Delete block")}
                    title={te("Delete block")}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={deleteHoveredBlock}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              )}
              {dropLine !== null && (
                <div
                  className="page-editor-drop-line"
                  style={{ top: dropLine }}
                />
              )}
              {insertPoint && !hoverBlock && !slashMenu && !insert && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="page-editor-gutter-trigger"
                  aria-label={t("Insert")}
                  title={t("Insert")}
                  style={{ top: insertPoint.y }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    openCommandPicker({ x: rect.left, y: rect.bottom });
                  }}
                >
                  <Plus aria-hidden="true" />
                </Button>
              )}
              {selectionTools && (
                <div
                  className="page-editor-selection-tools"
                  role="toolbar"
                  aria-label={te("Formatting")}
                  style={{ left: selectionTools.x, top: selectionTools.y }}
                  onMouseDown={(event) => event.preventDefault()}
                >
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t("Bold")}
                    title={t("Bold")}
                    onClick={() => editor.tf.toggleMark("bold")}
                  >
                    <Bold aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t("Italic")}
                    title={t("Italic")}
                    onClick={() => editor.tf.toggleMark("italic")}
                  >
                    <Italic aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={te("Inline code")}
                    title={te("Inline code")}
                    onClick={() => editor.tf.toggleMark("code")}
                  >
                    <Code aria-hidden="true" />
                  </Button>
                </div>
              )}
              <input
                ref={fileInput}
                type="file"
                hidden
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setUploading(true);
                  onPendingUpload?.(true);
                  setError("");
                  try {
                    const saved = await pages.upload(pageId, file);
                    append({
                      type: "attachment",
                      fileId: saved.id,
                      name: saved.name,
                      mimeType: saved.mimeType,
                    });
                  } catch {
                    setError(t("Unavailable"));
                  } finally {
                    setUploading(false);
                    onPendingUpload?.(false);
                    event.target.value = "";
                  }
                }}
              />
            </>
          )}
          {error && !insert && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <div
            ref={editorContentRef}
            onKeyDownCapture={(event) => {
              if (readOnly) return;
              const target = event.target as HTMLElement;
              if (
                target.closest(
                  'input, select, button, [contenteditable="false"]',
                )
              )
                return;
              if (
                (event.key === "ArrowUp" || event.key === "ArrowDown") &&
                !event.shiftKey &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.altKey &&
                navigateBlockEdge(editor, event.key === "ArrowUp" ? -1 : 1)
              ) {
                event.preventDefault();
                event.stopPropagation();
                return;
              }
              const activeBlock = editor.api.block();
              const activeNode = activeBlock?.[0] as
                { type?: string } | undefined;
              const activePath = activeBlock?.[1];
              if (
                activeNode?.type === "p" &&
                activePath &&
                editor.selection &&
                editor.api.isCollapsed() &&
                editor.api.isEnd(editor.selection.focus, activePath)
              ) {
                const text = editor.api.string(activePath);
                const fence = /^```([\w+-]*)$/.exec(text);
                const shortcut =
                  event.key === " "
                    ? (
                        {
                          "#": "h1",
                          "##": "h2",
                          "###": "h3",
                          ">": "blockquote",
                          "-": "bullet",
                          "*": "bullet",
                          "1.": "numbered",
                          "[]": "todo",
                          "[ ]": "todo",
                        } as Record<string, string>
                      )[text]
                    : undefined;
                if (
                  (fence && (event.key === "Enter" || event.key === " ")) ||
                  shortcut
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  editor.tf.withoutNormalizing(() => {
                    editor.tf.delete({
                      at: {
                        anchor: editor.api.start(activePath)!,
                        focus: editor.selection!.focus,
                      },
                    });
                    editor.tf.setNodes(
                      fence
                        ? {
                            type: "code_block",
                            language: codeLanguage(fence[1]),
                          }
                        : {
                            type: shortcut!,
                            ...(shortcut === "todo" ? { checked: false } : {}),
                          },
                      { at: activePath },
                    );
                  });
                  return;
                }
              }
              if (
                (event.metaKey || event.ctrlKey) &&
                event.key.toLowerCase() === "e"
              ) {
                event.preventDefault();
                event.stopPropagation();
                editor.tf.toggleMark("code");
                return;
              }
              if (
                activeNode &&
                activePath &&
                activeNode.type === "code_block"
              ) {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  event.stopPropagation();
                  const nextPath = [
                    ...activePath.slice(0, -1),
                    activePath[activePath.length - 1] + 1,
                  ];
                  editor.tf.insertNodes(
                    { type: "p", children: [{ text: "" }] },
                    { at: nextPath },
                  );
                  editor.tf.select({ path: [...nextPath, 0], offset: 0 });
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  editor.tf.insertText("\n");
                  return;
                }
                if (event.key === "Tab") {
                  event.preventDefault();
                  event.stopPropagation();
                  editor.tf.insertText("  ");
                  return;
                }
              }
              if (
                activeNode &&
                activePath &&
                ["bullet", "numbered", "todo"].includes(activeNode.type ?? "")
              ) {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.shiftKey) {
                    editor.tf.insertText("\n");
                    return;
                  }
                  if (editor.api.string(activePath).length === 0) {
                    if (activeNode.type === "todo")
                      editor.tf.unsetNodes(["checked"], { at: activePath });
                    editor.tf.setNodes({ type: "p" }, { at: activePath });
                  } else {
                    const nextPath = [
                      ...activePath.slice(0, -1),
                      activePath[activePath.length - 1] + 1,
                    ];
                    editor.tf.insertBreak();
                    if (activeNode.type === "todo")
                      editor.tf.setNodes({ checked: false }, { at: nextPath });
                  }
                  return;
                }
              }
              const cellPath =
                activePath &&
                ancestorPath(editor.children, activePath, "table_cell");
              if (cellPath && activePath) {
                if (event.key === "Backspace" || event.key === "Delete") {
                  const focus = editor.selection?.focus;
                  if (
                    focus &&
                    editor.api.isCollapsed() &&
                    ((event.key === "Backspace" &&
                      editor.api.isStart(focus, cellPath)) ||
                      (event.key === "Delete" &&
                        editor.api.isEnd(focus, cellPath)))
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                  }
                }
                if (event.key === "Tab") {
                  event.preventDefault();
                  event.stopPropagation();
                  const tablePath = cellPath.slice(0, -2);
                  const table = nodeAtPath(editor.children, tablePath) as {
                    children: Array<{ children: unknown[] }>;
                  };
                  const rows = table.children;
                  const rowCount = rows.length;
                  const rowIndex = cellPath[cellPath.length - 2];
                  const cellIndex = cellPath[cellPath.length - 1];
                  let nextRow = rowIndex;
                  let nextCell = cellIndex + (event.shiftKey ? -1 : 1);
                  if (nextCell < 0) {
                    nextRow--;
                    nextCell = (rows[nextRow]?.children.length ?? 1) - 1;
                  }
                  if (nextCell >= (rows[rowIndex]?.children.length ?? 0)) {
                    nextRow++;
                    nextCell = 0;
                  }
                  if (nextRow >= rowCount && !event.shiftKey && rowCount < 20) {
                    const columns = rows[0]?.children.length ?? 1;
                    editor.tf.insertNodes(
                      {
                        type: "table_row",
                        children: Array.from({ length: columns }, () => ({
                          type: "table_cell",
                          children: [{ type: "p", children: [{ text: "" }] }],
                        })),
                      },
                      { at: [...tablePath, rowCount] },
                    );
                    nextRow = rowCount;
                    nextCell = 0;
                  }
                  if (nextRow >= 0 && nextRow < Math.min(20, rowCount + 1))
                    editor.tf.select({
                      path: [...tablePath, nextRow, nextCell, 0, 0],
                      offset: 0,
                    });
                  return;
                }
              }
              if (
                activePath &&
                (event.key === "Backspace" || event.key === "Delete")
              ) {
                const togglePath = ancestorPath(
                  editor.children,
                  activePath,
                  "toggle",
                );
                if (togglePath) {
                  const childIndex = activePath[togglePath.length];
                  const focus = editor.selection?.focus;
                  if (
                    focus &&
                    editor.api.isCollapsed() &&
                    ((event.key === "Backspace" &&
                      childIndex <= 1 &&
                      editor.api.isStart(focus, [...togglePath, childIndex])) ||
                      (event.key === "Delete" &&
                        childIndex === 0 &&
                        editor.api.isEnd(focus, [...togglePath, 0])))
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                  }
                }
              }
              if (
                event.key === "/" &&
                (!activeNode?.type || activeNode.type === "p") &&
                !event.ctrlKey &&
                !event.metaKey &&
                currentBlockIsEmpty()
              ) {
                event.preventDefault();
                openCommandPicker();
              }
            }}
          >
            <PlateContent
              className="page-editor-content"
              aria-label={t("Content")}
              placeholder={readOnly ? "" : t("Write")}
              onPasteCapture={(event) => {
                const rawValue = event.clipboardData.getData("text/plain");
                const activeBlock = editor.api.block();
                if (!readOnly && activeBlock?.[0].type === "code_block") {
                  event.preventDefault();
                  event.stopPropagation();
                  editor.tf.insertText(rawValue);
                  return;
                }
                const fenced =
                  !readOnly &&
                  (!activeBlock ||
                    (activeBlock[0].type === "p" &&
                      editor.api.string(activeBlock[1]) === ""))
                    ? fencedCodePaste(rawValue)
                    : null;
                if (fenced) {
                  event.preventDefault();
                  event.stopPropagation();
                  const path = activeBlock?.[1] ?? [editor.children.length];
                  const blocks = [
                    ...fenced,
                    { type: "p", children: [{ text: "" }] },
                  ];
                  editor.tf.withoutNormalizing(() => {
                    if (activeBlock) editor.tf.removeNodes({ at: path });
                    editor.tf.insertNodes(blocks, { at: path });
                  });
                  editor.tf.select({
                    path: [
                      ...path.slice(0, -1),
                      path[path.length - 1] + blocks.length - 1,
                      0,
                    ],
                    offset: 0,
                  });
                  return;
                }
                const value = rawValue.trim();
                if (
                  readOnly ||
                  !/^(https?:\/\/|mailto:)/i.test(value) ||
                  /\s/.test(value)
                )
                  return;
                try {
                  const parsed = new URL(value);
                  if (
                    !["https:", "http:", "mailto:"].includes(parsed.protocol) ||
                    parsed.username ||
                    parsed.password
                  )
                    return;
                } catch {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                const issue = parseIssueLink(value);
                if (
                  issue &&
                  issueProviders.includes(issue.provider) &&
                  (!activeBlock ||
                    (activeBlock[0].type === "p" &&
                      editor.api.string(activeBlock[1]) === ""))
                ) {
                  const path = activeBlock?.[1] ?? [editor.children.length];
                  editor.tf.withoutNormalizing(() => {
                    if (activeBlock) editor.tf.removeNodes({ at: path });
                    editor.tf.insertNodes(
                      [
                        {
                          type: "issue",
                          url: issue.url,
                          children: [{ text: "" }],
                        },
                        { type: "p", children: [{ text: "" }] },
                      ],
                      { at: path },
                    );
                  });
                  editor.tf.select({
                    path: [...path.slice(0, -1), path[path.length - 1] + 1, 0],
                    offset: 0,
                  });
                  return;
                }
                const link = {
                  type: "a",
                  url: value,
                  children: [{ text: value }],
                };
                if (editor.selection)
                  editor.tf.insertNodes([link, { text: "" }]);
                else
                  editor.tf.insertNodes(
                    { type: "p", children: [link, { text: "" }] },
                    { at: [editor.children.length] },
                  );
              }}
            />
          </div>
          <Popover open={slashMenu} onOpenChange={setSlashMenu}>
            <PopoverAnchor asChild>
              <span
                aria-hidden="true"
                className="page-editor-slash-anchor"
                style={{ left: slashPoint.x, top: slashPoint.y }}
              />
            </PopoverAnchor>
            <PopoverContent
              ref={slashMenuRef}
              align="start"
              side="bottom"
              className="page-editor-slash-menu"
              aria-label={t("Insert")}
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                commandSearchRef.current?.focus();
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (returnFocusToEditor.current) focusEditor();
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  returnFocusToEditor.current = true;
                  setSlashMenu(false);
                  setCommandQuery("");
                } else if (
                  event.key === "ArrowDown" ||
                  event.key === "ArrowUp"
                ) {
                  event.preventDefault();
                  const buttons = Array.from(
                    slashMenuRef.current?.querySelectorAll<HTMLButtonElement>(
                      "[data-command-item]",
                    ) ?? [],
                  );
                  const current = buttons.indexOf(
                    document.activeElement as HTMLButtonElement,
                  );
                  const delta = event.key === "ArrowDown" ? 1 : -1;
                  const next =
                    current < 0
                      ? delta > 0
                        ? 0
                        : buttons.length - 1
                      : (current + delta + buttons.length) % buttons.length;
                  buttons[next]?.focus();
                } else if (
                  event.key === "Enter" &&
                  document.activeElement === commandSearchRef.current
                ) {
                  event.preventDefault();
                  filteredCommands[0]?.action();
                }
              }}
            >
              <p className="page-editor-slash-label">{t("Insert")}</p>
              <div className="page-editor-command-search">
                <Search aria-hidden="true" />
                <Input
                  ref={commandSearchRef}
                  value={commandQuery}
                  aria-label={te("Search commands")}
                  placeholder={te("Search commands")}
                  onChange={(event) => setCommandQuery(event.target.value)}
                />
              </div>
              <div
                className="page-editor-command-list"
                role="listbox"
                aria-label={t("Insert")}
              >
                {filteredCommands.map(({ id, label, icon: Icon, action }) => (
                  <Button
                    key={id}
                    data-command-item
                    role="option"
                    aria-selected="false"
                    type="button"
                    variant="ghost"
                    onClick={action}
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    <Icon aria-hidden="true" /> {label}
                  </Button>
                ))}
                {!filteredCommands.length && (
                  <p className="page-editor-empty-commands">
                    {te("No commands found")}
                  </p>
                )}
              </div>
            </PopoverContent>
          </Popover>
          <Dialog
            open={insert !== null}
            onOpenChange={(open) => {
              if (!open) {
                setInsert(null);
                setError("");
                returnFocusToEditor.current = true;
                focusEditor();
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {insert === "issue"
                    ? te(
                        issueProviderToInsert === "jira"
                          ? "Jira issue"
                          : "Linear issue",
                      )
                    : t("Collection")}
                </DialogTitle>
                <DialogDescription>
                  {insert === "issue"
                    ? te(
                        issueProviderToInsert === "jira"
                          ? "Jira issue hint"
                          : "Linear issue hint",
                      )
                    : t("Write")}
                </DialogDescription>
              </DialogHeader>
              {insert === "issue" && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const link = parseIssueLink(url);
                    if (!link || link.provider !== issueProviderToInsert) {
                      setError(t("Invalid link"));
                      return;
                    }
                    if (!issueProviders.includes(link.provider)) {
                      setError(te("Provider not connected"));
                      return;
                    }
                    append({ type: "issue", url: link.url });
                  }}
                  className="space-y-4"
                >
                  <Input
                    aria-label={t("Link")}
                    autoFocus
                    type="url"
                    required
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                  />
                  {error && <p role="alert">{error}</p>}
                  <Button type="submit">{t("Insert")}</Button>
                </form>
              )}
              {insert === "collection" && (
                <CollectionPicker
                  api={api}
                  onInsert={(reference) =>
                    append({ type: "collection", ...reference })
                  }
                />
              )}
            </DialogContent>
          </Dialog>
        </div>
      </Plate>
    </EditorContext.Provider>
  );
});
function CollectionPicker({
  api,
  onInsert,
}: {
  api: ApiClient;
  onInsert(reference: CollectionReference): void;
}) {
  const t = useMessages(pagesMessages);
  const [tenants, setTenants] = useState<WidgetTenant[]>([]),
    [collections, setCollections] = useState<WidgetCollection[]>([]);
  const [domain, setDomain] = useState(""),
    [collection, setCollection] = useState(""),
    [viewId, setViewId] = useState("");
  const [mode, setMode] = useState<"table" | "pipeline">("table"),
    [views, setViews] = useState<Array<{ id: string; name: string }>>([]),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void listWidgetTenants(api)
      .then((value) => {
        if (active) setTenants(value);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [api]);
  useEffect(() => {
    let active = true;
    setCollections([]);
    setCollection("");
    if (domain)
      void listWidgetCollections(api, domain)
        .then((value) => {
          if (active) setCollections(value);
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    return () => {
      active = false;
    };
  }, [api, domain]);
  useEffect(() => {
    let active = true;
    setViews([]);
    setViewId("");
    if (collection)
      void api
        .get<{ data: Array<{ id: string; name: string }> }>(
          `${domain}/api/views/${encodeURIComponent(collection)}`,
        )
        .then(({ data }) => {
          if (active) setViews(data);
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    return () => {
      active = false;
    };
  }, [api, domain, collection]);
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onInsert({ domain, collection, mode, ...(viewId ? { viewId } : {}) });
      }}
    >
      <label className="block text-sm">
        {t("Workspace")}
        <select
          className="page-select"
          required
          value={domain}
          onChange={(event) => {
            setDomain(event.target.value);
            setFailed(false);
          }}
        >
          <option value="">{t("Choose")}</option>
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.apiBasePath}>
              {tenant.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        {t("Collection")}
        <select
          className="page-select"
          required
          value={collection}
          onChange={(event) => setCollection(event.target.value)}
        >
          <option value="">{t("Choose")}</option>
          {collections.map((item) => (
            <option key={item.name} value={item.name}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        {t("View")}
        <select
          className="page-select"
          value={viewId}
          onChange={(event) => setViewId(event.target.value)}
        >
          <option value="">{t("All records")}</option>
          {views.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        {t("Table")} / {t("Board")}
        <select
          className="page-select"
          value={mode}
          onChange={(event) => setMode(event.target.value as typeof mode)}
        >
          <option value="table">{t("Table")}</option>
          <option value="pipeline">{t("Board")}</option>
        </select>
      </label>
      {failed && <p role="alert">{t("Unavailable")}</p>}
      <Button type="submit" disabled={!collection}>
        {t("Insert")}
      </Button>
    </form>
  );
}
