import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  FolderPlus,
  KeyRound,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInput,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { SidebarFlowsSkeleton } from "@/components/admin/page-skeletons";
import { useSaviaRequestWorkspace } from "./savia-request-provider";
import { DeleteDialog, type DeleteAction } from "./editor/delete-dialog";
import type { FlowSummary } from "./types";

type FolderNode = {
  name: string;
  path: string;
  children: FolderNode[];
  flows: FlowSummary[];
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
}

function buildTree(folders: string[], flows: FlowSummary[]) {
  const nodes = new Map<string, FolderNode>();
  const root: FolderNode = { name: "", path: "", children: [], flows: [] };
  nodes.set("", root);

  for (const path of [
    ...folders,
    ...flows.map((flow) => flow.folderPath ?? ""),
  ]) {
    if (!path) continue;
    const parts = path.split("/").filter(Boolean);
    let parent = root;
    let currentPath = "";
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let node = nodes.get(currentPath);
      if (!node) {
        node = { name: part, path: currentPath, children: [], flows: [] };
        nodes.set(currentPath, node);
        parent.children.push(node);
      }
      parent = node;
    }
  }

  for (const flow of flows) {
    nodes.get(flow.folderPath ?? "")?.flows.push(flow);
  }

  const sortNode = (node: FolderNode) => {
    node.children.sort((left, right) => left.name.localeCompare(right.name));
    node.flows.sort((left, right) => left.name.localeCompare(right.name));
    node.children.forEach(sortNode);
  };
  sortNode(root);
  return root;
}

function pathAncestors(path?: string) {
  if (!path) return [];
  const parts = path.split("/");
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

export function SaviaRequestSidebar({
  nested = false,
  onNavigate,
}: {
  nested?: boolean;
  onNavigate?(): void;
}) {
  const {
    active,
    api,
    busy,
    flow,
    flows,
    folders,
    refreshNavigation,
    selectFlow,
    openSecrets,
    view,
  } = useSaviaRequestWorkspace();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [folderFormOpen, setFolderFormOpen] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderPath, setFolderPath] = useState("");
  const [folderError, setFolderError] = useState("");
  const [deletion, setDeletion] = useState<DeleteAction | null>(null);
  const normalizedQuery = normalize(query.trim());
  const filteredFlows = useMemo(
    () =>
      flows.filter((candidate) =>
        normalizedQuery.length === 0
          ? true
          : normalize(
              `${candidate.name} ${candidate.folderPath ?? ""}`,
            ).includes(normalizedQuery),
      ),
    [flows, normalizedQuery],
  );
  const visibleFolders = useMemo(
    () =>
      normalizedQuery.length === 0
        ? folders
        : folders.filter((path) => normalize(path).includes(normalizedQuery)),
    [folders, normalizedQuery],
  );
  const tree = useMemo(
    () => buildTree(visibleFolders, filteredFlows),
    [filteredFlows, visibleFolders],
  );

  useEffect(() => {
    if (!flow) return;
    setExpanded((current) => {
      const next = new Set(current);
      for (const path of pathAncestors(flow.folderPath)) next.add(path);
      return next;
    });
  }, [flow]);

  if (!active) return null;

  const select = async (id: string) => {
    await selectFlow(id, 0);
    onNavigate?.();
  };
  const openSecretsScreen = () => {
    openSecrets();
    onNavigate?.();
  };
  const toggle = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const createFolder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const path = folderPath.trim();
    if (!path) {
      setFolderError("Escribe la ruta de la carpeta.");
      return;
    }
    setFolderError("");
    setCreatingFolder(true);
    try {
      await api.createFolder(path);
      await refreshNavigation();
      setExpanded((current) => new Set([...current, ...pathAncestors(path)]));
      setFolderPath("");
      setFolderFormOpen(false);
    } catch (exception) {
      setFolderError(
        exception instanceof Error
          ? exception.message
          : "No pudimos crear la carpeta.",
      );
    } finally {
      setCreatingFolder(false);
    }
  };
  const removeFolder = (path: string) => {
    setDeletion({
      title: "Eliminar carpeta",
      description: `¿Eliminar la carpeta «${path}»?`,
      run: async () => {
        await api.removeFolder(path);
        await refreshNavigation();
        setExpanded(
          (current) =>
            new Set(
              [...current].filter(
                (candidate) =>
                  candidate !== path && !candidate.startsWith(`${path}/`),
              ),
            ),
        );
      },
    });
  };

  return (
    <SidebarGroup
      className={cn(
        "py-2 group-data-[collapsible=icon]:hidden",
        nested
          ? "border-0 px-0"
          : "border-sidebar-border/70 border-t",
      )}
    >
      <div
        className={cn(
          "flex h-8 items-center justify-between",
          nested ? "px-1.5" : "px-1",
        )}
      >
        {nested ? (
          <p className="px-1 text-[0.68rem] font-semibold tracking-[0.08em] text-muted-foreground/80 uppercase">
            Flows
          </p>
        ) : (
          <SidebarGroupLabel className="static h-auto px-1 text-[0.68rem] font-semibold tracking-[0.08em] text-muted-foreground/80 uppercase">
            Flows
          </SidebarGroupLabel>
        )}
        <Button
          aria-label="Crear carpeta"
          disabled={busy || creatingFolder}
          onClick={() => {
            setFolderError("");
            setFolderFormOpen(true);
          }}
          size="icon"
          type="button"
          variant="ghost"
        >
          <FolderPlus />
        </Button>
      </div>
      <SidebarGroupContent>
        <nav
          aria-label="Flows de Savia Request"
          className={cn(
            "min-h-0 overflow-y-auto",
            nested
              ? "max-h-[min(50vh,32rem)] px-1.5"
              : "max-h-[min(42vh,27rem)] px-2",
          )}
        >
          <div className="group/savia-flow-search relative mb-1.5">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <SidebarInput
              aria-label="Buscar flows"
              className="h-8 py-1 pr-2 pl-7 text-xs"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar flows"
              type="search"
              value={query}
            />
          </div>
          {folderFormOpen ? (
            <form className="mb-2 grid gap-1.5" onSubmit={createFolder}>
              <SidebarInput
                aria-label="Ruta de la carpeta"
                autoFocus
                disabled={busy || creatingFolder}
                onChange={(event) => setFolderPath(event.target.value)}
                placeholder="Ej.: Cotizaciones/Autos"
                type="text"
                value={folderPath}
              />
              {folderError ? (
                <p className="text-xs text-destructive" role="alert">
                  {folderError}
                </p>
              ) : null}
              <div className="flex gap-1.5">
                <Button
                  disabled={busy || creatingFolder}
                  size="sm"
                  type="submit"
                >
                  Crear
                </Button>
                <Button
                  disabled={busy || creatingFolder}
                  onClick={() => {
                    setFolderFormOpen(false);
                    setFolderPath("");
                    setFolderError("");
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Cancelar
                </Button>
              </div>
            </form>
          ) : null}
          {busy && flows.length === 0 ? (
            <SidebarFlowsSkeleton count={3} />
          ) : tree.flows.length === 0 && tree.children.length === 0 ? (
            <p className="px-2 py-3 text-xs leading-5 text-muted-foreground">
              {query.trim()
                ? "No encontramos flows con ese nombre."
                : "No hay flows todavía."}
            </p>
          ) : (
            <SidebarMenu className="gap-0.5">
              {tree.flows.map((item) => (
                <FlowButton
                  flow={item}
                  key={item.id}
                  onSelect={select}
                  selected={view === "flow" && flow?.id === item.id}
                />
              ))}
              {tree.children.map((node) => (
                <FolderBranch
                  expanded={expanded}
                  forceExpanded={normalizedQuery.length > 0}
                  key={node.path}
                  node={node}
                  onRemove={removeFolder}
                  onSelect={select}
                  onToggle={toggle}
                  selectedFlowId={view === "flow" ? flow?.id : undefined}
                />
              ))}
            </SidebarMenu>
          )}
        </nav>
      </SidebarGroupContent>
      <div
        className={cn(
          "mt-2 border-sidebar-border/70 border-t px-2 pt-2",
          nested && "px-1.5",
        )}
      >
        <SidebarMenu className="gap-0.5">
          <SidebarMenuItem>
            <SidebarMenuButton
              aria-current={view === "secretos" ? "page" : undefined}
              className="h-8"
              isActive={view === "secretos"}
              onClick={openSecretsScreen}
              type="button"
            >
              <KeyRound />
              <span className="truncate">Secretos</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </div>
      {deletion ? (
        <DeleteDialog action={deletion} onClose={() => setDeletion(null)} />
      ) : null}
    </SidebarGroup>
  );
}

function FolderBranch({
  node,
  expanded,
  forceExpanded,
  selectedFlowId,
  onToggle,
  onSelect,
  onRemove,
}: {
  node: FolderNode;
  expanded: Set<string>;
  forceExpanded: boolean;
  selectedFlowId?: string;
  onToggle(path: string): void;
  onSelect(id: string): Promise<void>;
  onRemove(path: string): void;
}) {
  const open = forceExpanded || expanded.has(node.path);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        aria-expanded={open}
        className="h-8"
        onClick={() => onToggle(node.path)}
        type="button"
      >
        <ChevronRight
          className={cn(
            "transition-transform duration-200",
            open && "rotate-90",
          )}
        />
        {open ? <FolderOpen /> : <Folder />}
        <span className="truncate">{node.name}</span>
      </SidebarMenuButton>
      <SidebarMenuAction
        aria-label={`Eliminar carpeta ${node.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onRemove(node.path);
        }}
        showOnHover
        type="button"
      >
        <Trash2 />
      </SidebarMenuAction>
      {open ? (
        <SidebarMenuSub className="mx-1.5 translate-x-0 px-1.5">
          {node.flows.map((flow) => (
            <FlowButton
              flow={flow}
              key={flow.id}
              onSelect={onSelect}
              selected={selectedFlowId === flow.id}
            />
          ))}
          {node.children.map((child) => (
            <FolderBranch
              expanded={expanded}
              forceExpanded={forceExpanded}
              key={child.path}
              node={child}
              onRemove={onRemove}
              onSelect={onSelect}
              onToggle={onToggle}
              selectedFlowId={selectedFlowId}
            />
          ))}
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuItem>
  );
}

function FlowButton({
  flow,
  selected,
  onSelect,
}: {
  flow: FlowSummary;
  selected: boolean;
  onSelect(id: string): Promise<void>;
}) {
  return (
    <SidebarMenuSubItem>
      <SidebarMenuButton
        aria-current={selected ? "page" : undefined}
        className="h-auto min-h-8 py-1.5"
        isActive={selected}
        onClick={() => void onSelect(flow.id)}
        type="button"
      >
        <FileCode2 className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{flow.name}</span>
        <span
          aria-hidden="true"
          className="shrink-0 text-[0.65rem] text-muted-foreground"
        >
          {flow.steps.length}
        </span>
      </SidebarMenuButton>
    </SidebarMenuSubItem>
  );
}
