import { useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileJson,
  FolderOpen,
} from "lucide-react";
import type { IdeFiles } from "./plugin-ide-project";

export function PluginFileTree({
  names,
  selected,
  projectName,
  label,
  onSelect,
}: {
  names: (keyof IdeFiles)[];
  selected: keyof IdeFiles;
  projectName: string;
  label: string;
  onSelect: (name: keyof IdeFiles) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [focused, setFocused] = useState<string>(selected);
  const tree = useRef<HTMLDivElement>(null);
  function focus(name: string) {
    setFocused(name);
    const items =
      tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]');
    Array.from(items ?? [])
      .find((item) => item.dataset.name === name)
      ?.focus();
  }
  return (
    <div
      ref={tree}
      role="tree"
      aria-label={label}
      className="plugin-file-tree"
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        const name = target.dataset.name;
        if (!name) return;
        const items = ["root", ...(expanded ? names : [])];
        const index = items.indexOf(name);
        if (event.key === "ArrowDown") {
          event.preventDefault();
          focus(items[Math.min(index + 1, items.length - 1)]);
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          focus(items[Math.max(index - 1, 0)]);
        }
        if (event.key === "Home") {
          event.preventDefault();
          focus("root");
        }
        if (event.key === "End") {
          event.preventDefault();
          focus(items.at(-1)!);
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          if (name === "root") setExpanded(false);
          else focus("root");
        }
        if (event.key === "ArrowRight" && name === "root") {
          event.preventDefault();
          if (expanded) focus(names[0]);
          else setExpanded(true);
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (name === "root") setExpanded(!expanded);
          else onSelect(name as keyof IdeFiles);
        }
      }}
    >
      <div
        role="treeitem"
        aria-expanded={expanded}
        aria-label={projectName}
        data-name="root"
        tabIndex={focused === "root" ? 0 : -1}
        onFocus={() => setFocused("root")}
      >
        <div
          className="plugin-file-tree-root"
          onClick={() => {
            setExpanded(!expanded);
            focus("root");
          }}
        >
          {expanded ? <ChevronDown /> : <ChevronRight />}
          <FolderOpen />
          <span>{projectName}</span>
        </div>
        {expanded && (
          <div role="group">
            {names.map((name) => (
              <div
                role="treeitem"
                aria-selected={name === selected}
                data-name={name}
                tabIndex={focused === name ? 0 : -1}
                key={name}
                className="plugin-file-tree-file"
                onFocus={(event) => {
                  event.stopPropagation();
                  setFocused(name);
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  focus(name);
                  onSelect(name);
                }}
              >
                {name.endsWith("tsx") ? <FileCode2 /> : <FileJson />}
                <span>{name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
