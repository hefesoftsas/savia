import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileJson,
  Folder,
  FolderOpen,
} from "lucide-react";

type FileNode<Name extends string> =
  | { kind: "file"; id: string; name: Name; label: string }
  | {
      kind: "folder";
      id: string;
      path: string;
      label: string;
      children: FileNode<Name>[];
    };

const ROOT_ID = "project:root";

function selectedAncestorIds(selected: string): string[] {
  const segments = selected.split("/").filter(Boolean);
  return segments.slice(0, -1).map((_, index) => {
    const path = segments.slice(0, index + 1).join("/");
    return `folder:${path}`;
  });
}

function buildNodes<Name extends string>(names: Name[]): FileNode<Name>[] {
  type MutableNode = {
    folders: Map<string, MutableNode>;
    files: Array<{ name: Name; label: string }>;
  };
  const root: MutableNode = { folders: new Map(), files: [] };

  for (const name of names) {
    const segments = name.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    let parent = root;
    for (const segment of segments.slice(0, -1)) {
      let child = parent.folders.get(segment);
      if (!child) {
        child = { folders: new Map(), files: [] };
        parent.folders.set(segment, child);
      }
      parent = child;
    }
    parent.files.push({ name, label: segments.at(-1)! });
  }

  function materialize(node: MutableNode, prefix: string): FileNode<Name>[] {
    const folders = [...node.folders.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([label, child]) => {
        const path = prefix ? `${prefix}/${label}` : label;
        return {
          kind: "folder" as const,
          id: `folder:${path}`,
          path,
          label,
          children: materialize(child, path),
        };
      });
    const files = node.files
      .sort((left, right) => left.label.localeCompare(right.label))
      .map(({ name, label }) => ({
        kind: "file" as const,
        id: `file:${name}`,
        name,
        label,
      }));
    return [...folders, ...files];
  }

  return materialize(root, "");
}

export function PluginFileTree<Name extends string>({
  names,
  selected,
  projectName,
  label,
  onSelect,
  filterActive = false,
}: {
  names: Name[];
  selected: string;
  projectName: string;
  label: string;
  onSelect: (name: Name) => void;
  filterActive?: boolean;
}) {
  const nodes = useMemo(() => buildNodes(names), [names]);
  const validNodeIds = useMemo(() => {
    const ids = new Set([ROOT_ID]);
    function collect(items: FileNode<Name>[]) {
      for (const node of items) {
        ids.add(node.id);
        if (node.kind === "folder") collect(node.children);
      }
    }
    collect(nodes);
    return ids;
  }, [nodes]);
  const [rootExpanded, setRootExpanded] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(selectedAncestorIds(selected)),
  );
  const [focused, setFocused] = useState(
    names.includes(selected as Name) ? `file:${selected}` : ROOT_ID,
  );
  const tree = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      for (const id of selectedAncestorIds(selected)) next.add(id);
      return next;
    });
    setFocused((current) => {
      if (!filterActive && !rootExpanded) return ROOT_ID;
      if (names.includes(selected as Name)) return `file:${selected}`;
      return validNodeIds.has(current) ? current : ROOT_ID;
    });
  }, [filterActive, names, rootExpanded, selected, validNodeIds]);

  useEffect(() => {
    setRootExpanded(true);
  }, [selected]);

  function isExpanded(id: string) {
    return id === ROOT_ID
      ? filterActive || rootExpanded
      : filterActive || expandedFolders.has(id);
  }

  function setNodeExpanded(id: string, value: boolean) {
    if (id === ROOT_ID) {
      setRootExpanded(value);
      return;
    }
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function focus(id: string) {
    setFocused(id);
    Array.from(
      tree.current?.querySelectorAll<HTMLElement>(
        '[role="treeitem"][data-tree-id]',
      ) ?? [],
    )
      .find((item) => item.dataset.treeId === id)
      ?.focus();
  }

  function parentId(id: string): string {
    if (id === ROOT_ID) return ROOT_ID;
    if (id.startsWith("file:")) {
      const path = id.slice("file:".length);
      const parentPath = path.split("/").slice(0, -1).join("/");
      return parentPath ? `folder:${parentPath}` : ROOT_ID;
    }
    const path = id.slice("folder:".length);
    const parentPath = path.split("/").slice(0, -1).join("/");
    return parentPath ? `folder:${parentPath}` : ROOT_ID;
  }

  function renderNodes(items: FileNode<Name>[], level: number) {
    return items.map((node) => {
      if (node.kind === "folder") {
        const expanded = isExpanded(node.id);
        return (
          <div
            key={node.id}
            role="treeitem"
            aria-label={node.path}
            aria-expanded={expanded}
            aria-level={level}
            data-tree-id={node.id}
            data-depth={level - 1}
            tabIndex={focused === node.id ? 0 : -1}
            className="plugin-file-tree-folder"
            onFocus={(event) => {
              event.stopPropagation();
              setFocused(node.id);
            }}
          >
            <div
              className="plugin-file-tree-row"
              data-depth={level - 1}
              style={{ "--tree-depth": level - 1 } as CSSProperties}
              onClick={(event) => {
                event.stopPropagation();
                focus(node.id);
                setNodeExpanded(node.id, !expanded);
              }}
            >
              {expanded ? <ChevronDown /> : <ChevronRight />}
              {expanded ? <FolderOpen /> : <Folder />}
              <span title={node.path}>{node.label}</span>
            </div>
            {expanded && (
              <div role="group" aria-label={node.path}>
                {renderNodes(node.children, level + 1)}
              </div>
            )}
          </div>
        );
      }
      return (
        <div
          key={node.id}
          role="treeitem"
          aria-label={node.name}
          aria-level={level}
          aria-selected={node.name === selected}
          title={node.name}
          data-tree-id={node.id}
          data-name={node.name}
          data-depth={level - 1}
          tabIndex={focused === node.id ? 0 : -1}
          className="plugin-file-tree-file"
          onFocus={(event) => {
            event.stopPropagation();
            setFocused(node.id);
          }}
          onClick={(event) => {
            event.stopPropagation();
            focus(node.id);
            onSelect(node.name);
          }}
        >
          <div
            className="plugin-file-tree-row"
            data-depth={level - 1}
            style={{ "--tree-depth": level - 1 } as CSSProperties}
          >
            {node.name.endsWith(".json") ? <FileJson /> : <FileCode2 />}
            <span title={node.name}>{node.label}</span>
          </div>
        </div>
      );
    });
  }

  const rootIsExpanded = isExpanded(ROOT_ID);

  return (
    <div
      ref={tree}
      role="tree"
      aria-label={label}
      className="plugin-file-tree"
      onKeyDown={(event) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>(
          '[role="treeitem"][data-tree-id]',
        );
        const id = target?.dataset.treeId;
        if (!target || !id || !tree.current?.contains(target)) return;
        const items = Array.from(
          tree.current.querySelectorAll<HTMLElement>(
            '[role="treeitem"][data-tree-id]',
          ),
        );
        const index = items.indexOf(target);
        const isFolder = id === ROOT_ID || id.startsWith("folder:");
        const expanded = isExpanded(id);
        const children = target.querySelector<HTMLElement>(
          ':scope > [role="group"] > [role="treeitem"]',
        );

        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const delta = event.key === "ArrowDown" ? 1 : -1;
          focus(
            items[Math.max(0, Math.min(items.length - 1, index + delta))]
              ?.dataset.treeId ?? id,
          );
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          const next = event.key === "Home" ? items[0] : items.at(-1);
          if (next?.dataset.treeId) focus(next.dataset.treeId);
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          if (isFolder && expanded) setNodeExpanded(id, false);
          else if (id !== ROOT_ID) focus(parentId(id));
        } else if (event.key === "ArrowRight" && isFolder) {
          event.preventDefault();
          if (!expanded) setNodeExpanded(id, true);
          else if (children?.dataset.treeId) focus(children.dataset.treeId);
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (isFolder) setNodeExpanded(id, !expanded);
          else onSelect(target.dataset.name as Name);
        }
      }}
    >
      <div
        role="treeitem"
        aria-expanded={rootIsExpanded}
        aria-level={1}
        aria-label={projectName}
        data-tree-id={ROOT_ID}
        data-depth={0}
        tabIndex={focused === ROOT_ID ? 0 : -1}
        className="plugin-file-tree-root"
        onFocus={(event) => {
          event.stopPropagation();
          setFocused(ROOT_ID);
        }}
      >
        <div
          className="plugin-file-tree-row"
          data-depth={0}
          style={{ "--tree-depth": 0 } as CSSProperties}
          onClick={(event) => {
            event.stopPropagation();
            focus(ROOT_ID);
            setRootExpanded(!rootIsExpanded);
          }}
        >
          {rootIsExpanded ? <ChevronDown /> : <ChevronRight />}
          {rootIsExpanded ? <FolderOpen /> : <Folder />}
          <span>{projectName}</span>
        </div>
        {rootIsExpanded && (
          <div role="group" aria-label={projectName}>
            {renderNodes(nodes, 2)}
          </div>
        )}
      </div>
    </div>
  );
}
