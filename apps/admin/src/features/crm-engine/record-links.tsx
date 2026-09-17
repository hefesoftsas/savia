import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "./api";
import { getCrmRuntime } from "./runtime";
import type { CrmObject, CrmRecord } from "@savia/crm-shared/metadata";
import type { RecordRelationGroup } from "@savia/crm-shared/relations";

const enc = encodeURIComponent;
const relationKey = (group: RecordRelationGroup) =>
  `${group.definition.id}:${group.direction}`;
function recordLabel(record: CrmRecord) {
  const contactName = [record.firstname, record.lastname].filter((value) => typeof value === "string" && value.trim()).join(" ").trim();
  const preferred = record.display_name ?? record.organization_display_name ?? record.name ?? record.title ?? record.subject ?? record.label ?? record.fullName ?? record.displayName ?? (contactName || undefined) ?? record.email;
  const fallback = Object.entries(record).find(([key, value]) => !["id", "created_at", "updated_at", "_version"].includes(key) && !key.toLowerCase().endsWith("id") && typeof value === "string" && value.trim());
  return String(preferred ?? fallback?.[1] ?? record.id);
}
function cellValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (Array.isArray(value)) return value.map((item) => cellValue(item)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
function columnLabel(key: string) {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

type HorizontalScrollState = {
  hasOverflow: boolean;
  canScrollLeft: boolean;
  canScrollRight: boolean;
};

export function useHorizontalScroll(signature: string) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<HorizontalScrollState>({
    hasOverflow: false,
    canScrollLeft: false,
    canScrollRight: false,
  });

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const sync = () => {
      const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      const hasOverflow = maxScrollLeft > 1;
      setState({
        hasOverflow,
        canScrollLeft: hasOverflow && viewport.scrollLeft > 1,
        canScrollRight: hasOverflow && viewport.scrollLeft < maxScrollLeft - 1,
      });
    };
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(sync);

    sync();
    viewport.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    resizeObserver?.observe(viewport);

    return () => {
      viewport.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      resizeObserver?.disconnect();
    };
  }, [signature]);

  function scrollByPage(direction: "left" | "right") {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const amount = Math.max(240, Math.floor(viewport.clientWidth * 0.8));
    const reduceMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    viewport.scrollBy({
      left: direction === "left" ? -amount : amount,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }

  return { ...state, scrollByPage, viewportRef };
}

export function HorizontalScrollControls({
  hasOverflow,
  canScrollLeft,
  canScrollRight,
  scrollByPage,
  leftLabel,
  rightLabel,
}: HorizontalScrollState & {
  scrollByPage: (direction: "left" | "right") => void;
  leftLabel: string;
  rightLabel: string;
}) {
  if (!hasOverflow) return null;
  return (
    <div className="records-table-scroll-controls record-links-scroll-controls">
      {canScrollLeft && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={leftLabel}
              className="records-table-scroll-control records-table-scroll-control-left"
              onClick={() => scrollByPage("left")}
              size="icon"
              type="button"
              variant="secondary"
            >
              <ChevronLeft aria-hidden="true" size={18} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {leftLabel}
          </TooltipContent>
        </Tooltip>
      )}
      {canScrollRight && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={rightLabel}
              className="records-table-scroll-control records-table-scroll-control-right"
              onClick={() => scrollByPage("right")}
              size="icon"
              type="button"
              variant="secondary"
            >
              <ChevronRight aria-hidden="true" size={18} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {rightLabel}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function RelatedRecordsTable({
  group,
  onNavigate,
  onUnlink,
  busy,
}: {
  group: RecordRelationGroup;
  onNavigate: (object: string, id: string) => void;
  onUnlink: (id: string) => void;
  busy: boolean;
}) {
  const columns = group.targetColumns?.length
    ? group.targetColumns
    : Object.keys(group.records[0]?.data ?? {})
        .filter((key) => !["id", "created_at", "updated_at", "_version"].includes(key))
        .map((key) => ({ key, label: columnLabel(key) }));
  const visibleColumns = columns.length
    ? columns
    : [{ key: "label", label: group.targetLabel }];
  const scroll = useHorizontalScroll(
    `${group.definition.id}:${group.direction}:${visibleColumns.length}:${group.records.length}`,
  );
  return (
    <div className="records-list related-records-list">
      <div
        className="records-table-shell related-records-table-shell"
        data-scroll-left={scroll.canScrollLeft ? "" : undefined}
        data-scroll-right={scroll.canScrollRight ? "" : undefined}
      >
        <div ref={scroll.viewportRef} className="records-table related-records-table">
          <table aria-label={`Registros relacionados: ${group.label}`}>
            <thead>
              <tr>
                {visibleColumns.map((column) => (
                  <th key={column.key} scope="col">
                    {column.label}
                  </th>
                ))}
                {group.canEdit && <th scope="col">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {group.records.map((row) => {
                const data = row.data ?? {};
                return (
                  <tr key={row.id}>
                    {visibleColumns.map((column, index) => {
                      const raw = column.key === "label" ? row.label : data[column.key];
                      const value = cellValue(raw ?? (index === 0 ? row.label : undefined));
                      return (
                        <td
                          key={column.key}
                          className={index === 0 ? "records-table-primary-column" : undefined}
                        >
                          {index === 0 && !row.missing ? (
                            <button
                              type="button"
                              className="text-left text-primary underline-offset-4 hover:underline focus-visible:underline"
                              aria-label={value}
                              onClick={() => onNavigate(group.targetObject, row.id)}
                            >
                              {value}
                            </button>
                          ) : (
                            value
                          )}
                        </td>
                      );
                    })}
                    {group.canEdit && (
                      <td className="records-table-actions-column">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          aria-label={`Desvincular ${row.label}`}
                          onClick={() => onUnlink(row.id)}
                        >
                          Desvincular
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <HorizontalScrollControls
          {...scroll}
          leftLabel="Ver columnas a la izquierda"
          rightLabel="Ver columnas a la derecha"
        />
      </div>
    </div>
  );
}
function LinkGroup({ group, base, onNavigate }: { group: RecordRelationGroup; base: string; onNavigate: (object: string, id: string) => void }) {
  const runtime = getCrmRuntime();
  const client = useQueryClient();
  const [selecting, setSelecting] = useState(false);
  const [page, setPage] = useState(1);
  const [targetId, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const candidates = useQuery({ queryKey: ["link-candidates", runtime.apiBasePath, runtime.domainId, group.targetObject, page], queryFn: () => api<{ data: CrmRecord[]; total: number }>(`/records/${enc(group.targetObject)}?page=${page}&perPage=20`), enabled: selecting && group.canEdit });
  async function mutate(method: string, id: string) {
    setBusy(true); setError("");
    try { await api(`${base}/${enc(group.definition.id)}`, method, { targetId: id }); setTarget(""); await client.invalidateQueries({ queryKey: ["record-links"] }); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo actualizar la asociación. Intenta nuevamente."); }
    finally { setBusy(false); }
  }
  return <section className="min-w-0 space-y-3 border-b pb-4">
    {group.canEdit && <div className="flex flex-wrap items-center justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setSelecting(!selecting)}>{selecting ? "Cerrar selector" : "Vincular registro"}</Button></div>}
    {group.cardinalityConflict && <p role="alert" className="text-sm text-destructive">Los datos actuales contienen más coincidencias de las permitidas por esta relación. Revisa sus campos y cardinalidad.</p>}
    {group.records.length === 0 && <p className="text-sm text-muted-foreground">Sin registros vinculados en esta página.</p>}
    {group.records.length > 0 && (
      <RelatedRecordsTable
        group={group}
        onNavigate={onNavigate}
        onUnlink={(id) => void mutate("DELETE", id)}
        busy={busy}
      />
    )}
    {selecting && <form className="space-y-2 rounded-md bg-muted/40 p-3" onSubmit={e => { e.preventDefault(); if (targetId) void mutate("POST", targetId); }}>
      <Label htmlFor={`link-target-${group.definition.id}-${group.direction}`}>Registro de {group.targetLabel}</Label>
      {candidates.isPending && (
        <div className="space-y-2" role="status" aria-live="polite">
          <p className="text-xs text-muted-foreground">Cargando registros…</p>
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
      )}
      {candidates.error && <div role="alert">{candidates.error.message} <Button type="button" variant="outline" size="sm" onClick={() => candidates.refetch()}>Reintentar</Button></div>}
      <select id={`link-target-${group.definition.id}-${group.direction}`} className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm" value={targetId} onChange={e => setTarget(e.target.value)} required disabled={busy || candidates.isFetching}><option value="">Seleccionar registro</option>{candidates.data?.data.map(r => <option key={r.id} value={r.id}>{recordLabel(r)}</option>)}</select>
      {candidates.data?.data.length === 0 && <p className="text-sm">No hay registros disponibles en esta página.</p>}
      <div className="flex flex-wrap items-center gap-2"><Button type="button" size="sm" variant="outline" disabled={page === 1 || candidates.isFetching} onClick={() => { setPage(page - 1); setTarget(""); }}>Anterior</Button><span className="text-sm">Página {page}</span><Button type="button" size="sm" variant="outline" disabled={candidates.isFetching || !candidates.data || (candidates.data.total !== undefined ? page * 20 >= candidates.data.total : candidates.data.data.length < 20)} onClick={() => { setPage(page + 1); setTarget(""); }}>Siguiente</Button><Button size="sm" disabled={!targetId || busy || candidates.isFetching}>{busy ? "Guardando…" : "Vincular"}</Button></div>
      <p className="text-xs text-muted-foreground">Desvincular conserva ambos registros; elimina únicamente la asociación.</p>
    </form>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
export type RecordLinksProps = {
  object: CrmObject;
  record: CrmRecord;
  onNavigate: (object: string, id: string) => void;
  activeGroupKey?: string;
  showGroupTabs?: boolean;
  showHeading?: boolean;
};
export default function RecordLinks({ object, record, onNavigate, activeGroupKey, showGroupTabs = true, showHeading = true }: RecordLinksProps) {
  return <RecordLinksContent key={`${object.name}:${record.id}`} object={object} record={record} onNavigate={onNavigate} activeGroupKey={activeGroupKey} showGroupTabs={showGroupTabs} showHeading={showHeading} />;
}
function RecordLinksContent({ object, record, onNavigate, activeGroupKey, showGroupTabs, showHeading }: RecordLinksProps & { showGroupTabs: boolean; showHeading: boolean }) {
  const [page, setPage] = useState(1);
  const [internalActiveGroupKey, setInternalActiveGroupKey] = useState("");
  const runtime = getCrmRuntime();
  const base = `/record-links/${enc(object.name)}/${enc(record.id)}`;
  const activeKeySeparator = activeGroupKey?.lastIndexOf(":") ?? -1;
  const selectedRelation =
    activeKeySeparator >= 0
      ? activeGroupKey?.slice(0, activeKeySeparator)
      : undefined;
  const selectedDirection =
    activeKeySeparator >= 0
      ? activeGroupKey?.slice(activeKeySeparator + 1)
      : undefined;
  const query = useQuery({
    queryKey: [
      "record-links",
      runtime.apiBasePath,
      runtime.domainId,
      object.name,
      record.id,
      page,
      showGroupTabs ? "all" : activeGroupKey,
    ],
    queryFn: () =>
      api<{ data: RecordRelationGroup[] }>(
        `${base}?page=${page}&perPage=20&includeRecords=true${
          !showGroupTabs && selectedRelation
            ? `&relationId=${enc(selectedRelation)}&direction=${enc(selectedDirection ?? "")}`
            : ""
        }`,
      ),
  });
  const groups = object.config.studio?.collection?.kind === "crm"
    ? [...(query.data?.data ?? [])].sort((a, b) => Number(b.total > 0) - Number(a.total > 0) || a.label.localeCompare(b.label, "es"))
    : query.data?.data;
  useEffect(() => {
    setPage(1);
    setInternalActiveGroupKey("");
  }, [object.name, record.id]);
  useEffect(() => {
    if (
      activeGroupKey === undefined &&
      groups?.length &&
      !groups.some((group) => relationKey(group) === internalActiveGroupKey)
    )
      setInternalActiveGroupKey(relationKey(groups[0]));
  }, [activeGroupKey, groups, internalActiveGroupKey]);
  const selectedGroupKey = activeGroupKey ?? internalActiveGroupKey;
  const activeGroup = groups?.find((group) => relationKey(group) === selectedGroupKey) ?? groups?.[0];
  const tabScroll = useHorizontalScroll(
    groups?.map((group) => relationKey(group)).join("|") ?? "",
  );
  return <div className="record-links-tabs">
    {showHeading && <h3 className="font-medium">Registros relacionados</h3>}
    {query.isPending && (
      <div className="space-y-3" role="status" aria-live="polite">
        <p className="text-xs text-muted-foreground">Cargando relaciones…</p>
        <div className="overflow-hidden rounded-md border bg-card">
          <div className="flex items-center gap-4 border-b bg-muted/40 px-4 py-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
          </div>
          <div className="divide-y">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )}
    {query.error && <div role="alert">{query.error.message} <Button variant="outline" onClick={() => query.refetch()}>Reintentar</Button></div>}
    {query.data?.data.length === 0 && <p className="text-sm text-muted-foreground">{object.config.studio?.collection?.kind === "crm" ? "No hay registros relacionados en HubSpot." : "Esta colección aún no tiene relaciones. Puedes definirlas en Administración → Datos → Relaciones."}</p>}
    {showGroupTabs && groups?.length ? (
      <div className="record-links-tablist-shell">
        <div
          ref={tabScroll.viewportRef}
          className="record-links-tablist"
          role="tablist"
          aria-label="Tipos de registros relacionados"
        >
          {groups.map((group) => {
            const key = relationKey(group);
            const selected = key === relationKey(activeGroup as RecordRelationGroup);
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`record-links-panel-${key}`}
                className={selected ? "is-active" : undefined}
                onClick={() => setInternalActiveGroupKey(key)}
              >
                <span>{group.label}</span>
                <span className="record-links-tab-count">{group.total}</span>
              </button>
            );
          })}
        </div>
        <HorizontalScrollControls
          {...tabScroll}
          leftLabel="Ver tabs a la izquierda"
          rightLabel="Ver tabs a la derecha"
        />
      </div>
    ) : null}
    {activeGroup && groups?.length ? (
      <div
        id={`record-links-panel-${relationKey(activeGroup)}`}
        role="tabpanel"
        aria-label={activeGroup.label}
        className="record-links-tabpanel"
      >
        <LinkGroup
          key={relationKey(activeGroup)}
          group={activeGroup}
          base={base}
          onNavigate={onNavigate}
        />
      </div>
    ) : null}
    {(page > 1 || query.data?.data.some(g => g.total > 20)) && <nav aria-label="Páginas de registros relacionados" className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={page === 1 || query.isFetching} onClick={() => setPage(page - 1)}>Anterior</Button><span className="text-sm">Página {page}</span><Button size="sm" variant="outline" disabled={query.isFetching || !query.data?.data.some(g => g.total > page * 20)} onClick={() => setPage(page + 1)}>Siguiente</Button></nav>}
  </div>;
}
