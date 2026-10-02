import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight, FileText, Folder, FolderOpen, Plus } from "lucide-react";
import { useAppServices } from "@/features/assistant/assistant-context";
import { useMessages } from "@/i18n/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { pagesMessages } from "./messages";
import { usePagesIndex } from "./use-pages-index";
import type { PageSummary } from "./client";
import "./pages.css";

export function PageCreateMenu({
  parentId,
  onNavigate,
}: {
  parentId?: string;
  onNavigate(): void;
}) {
  const t = useMessages(pagesMessages);
  const route = (kind: string) =>
    `/pages?${new URLSearchParams({ create: kind, ...(parentId ? { parent: parentId } : {}) })}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="pages-tree-action"
          aria-label={parentId ? t("Add inside") : t("New page")}
          title={parentId ? t("Add inside") : t("New page")}
        >
          <Plus size={14} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem asChild>
          <Link to={route("page")} onClick={onNavigate}>
            <FileText size={15} />
            {t("New page")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to={route("folder")} onClick={onNavigate}>
            <Folder size={15} />
            {t("New folder")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PagesSidebar({ onNavigate }: { onNavigate(): void }) {
  const t = useMessages(pagesMessages);
  const { apiClient } = useAppServices();
  const { pathname } = useLocation();
  const active = pathname === "/pages" || pathname.startsWith("/pages/");
  const currentId = pathname.startsWith("/pages/")
    ? pathname.slice(7)
    : undefined;
  const [open, setOpen] = useState(active);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { pages, error, loading, refresh } = usePagesIndex(
    apiClient,
    open || active,
  );
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);
  const activeParents: string[] = [];
  const parentLookup = new Map(pages.map((page) => [page.id, page]));
  let activeParent = currentId ? parentLookup.get(currentId)?.parentId : null;
  while (activeParent && !activeParents.includes(activeParent)) {
    activeParents.push(activeParent);
    activeParent = parentLookup.get(activeParent)?.parentId;
  }
  const ancestorKey = JSON.stringify(activeParents);
  useEffect(() => {
    const parents = JSON.parse(ancestorKey) as string[];
    if (parents.length)
      setExpanded((current) => new Set([...current, ...parents]));
  }, [currentId, ancestorKey]);
  const byId = new Map(pages.map((page) => [page.id, page]));
  const children = (id: string | null) =>
    pages
      .filter(
        (page) =>
          page.parentId === id ||
          (!id && page.parentId && !byId.has(page.parentId)),
      )
      .sort(
        (a, b) =>
          Number(b.kind === "folder") - Number(a.kind === "folder") ||
          a.title.localeCompare(b.title),
      );
  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function row(
    page: PageSummary,
    ancestors = new Set<string>(),
  ): React.ReactNode {
    if (ancestors.has(page.id)) return null;
    const nextAncestors = new Set([...ancestors, page.id]);
    const nested = children(page.id);
    const expandable = page.kind === "folder" || nested.length > 0;
    const isOpen = expanded.has(page.id);
    const Icon =
      page.kind === "folder" ? (isOpen ? FolderOpen : Folder) : FileText;
    return (
      <li key={page.id}>
        <div
          className={`pages-tree-row ${page.id === currentId ? "is-current" : ""}`}
        >
          {expandable ? (
            <button
              type="button"
              className="pages-tree-action"
              aria-label={`${t(isOpen ? "Collapse" : "Expand")} ${page.title}`}
              aria-expanded={isOpen}
              onClick={() => toggle(page.id)}
            >
              <ChevronRight
                size={12}
                className={isOpen ? "rotate-90" : ""}
                aria-hidden
              />
            </button>
          ) : (
            <span className="pages-tree-spacer" />
          )}
          <Link
            className="pages-tree-link"
            to={`/pages/${page.id}`}
            onClick={onNavigate}
            aria-current={page.id === currentId ? "page" : undefined}
          >
            <Icon size={15} aria-hidden />
            <span>{page.title}</span>
          </Link>
          {page.role !== "reader" && (
            <PageCreateMenu parentId={page.id} onNavigate={onNavigate} />
          )}
        </div>
        {expandable && isOpen && (
          <ul className="pages-tree-children">
            {nested.length ? (
              nested.map((child) => row(child, nextAncestors))
            ) : (
              <li className="pages-tree-empty">{t("Folder empty")}</li>
            )}
          </ul>
        )}
      </li>
    );
  }
  return (
    <div className="pages-sidebar">
      <div
        className={`pages-tree-row pages-tree-root ${pathname === "/pages" ? "is-current" : ""}`}
      >
        <button
          type="button"
          className="pages-tree-action group-data-[collapsible=icon]:hidden"
          aria-label={`${t(open ? "Collapse" : "Expand")} ${t("Pages")}`}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronRight
            size={14}
            className={open ? "rotate-90" : ""}
            aria-hidden
          />
        </button>
        <Link
          to="/pages"
          className="pages-tree-link"
          onClick={onNavigate}
          aria-current={pathname === "/pages" ? "page" : undefined}
        >
          <FileText size={16} aria-hidden />
          <span>{t("Pages")}</span>
        </Link>
        <span className="group-data-[collapsible=icon]:hidden">
          <PageCreateMenu onNavigate={onNavigate} />
        </span>
      </div>
      {open && (
        <div className="group-data-[collapsible=icon]:hidden">
          {loading && (
            <p className="pages-tree-empty" role="status">
              {t("Loading")}
            </p>
          )}
          {error && (
            <div className="pages-tree-empty" role="alert">
              <p>{t("Unavailable")}</p>
              <button className="underline" onClick={() => void refresh()}>
                {t("Reload")}
              </button>
            </div>
          )}
          {!loading && !error && (
            <ul className="pages-tree-children" aria-label={t("Pages")}>
              {children(null).map((page) => row(page))}
              {!pages.length && (
                <li>
                  <Link
                    className="pages-tree-empty block"
                    to="/pages?create=page"
                    onClick={onNavigate}
                  >
                    {t("Add first")}
                  </Link>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
