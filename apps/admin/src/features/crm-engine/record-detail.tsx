import { FieldValueDisplay } from "./field-value-display";
const RecordHistory = lazy(() => import("./record-history"));
import { supportsRecordHistory } from "./record-history-client";
import { canDuplicateRecord } from "./record-duplication";
import { OfficeEditButton } from "./office-edit-button";
import { recordOptionLabel } from "./record-option-label";
import { RecordOriginLinks } from "./record-origin-links";
import RecordLinks, {
  HorizontalScrollControls,
  useHorizontalScroll,
} from "./record-links";
import {
  collectionCapabilities,
  supportsLocalRecordTools,
} from "./collection-capabilities";
import { CustomerActions } from "./business-panel";
import { getCrmRuntime } from "./runtime";
import { crmFetch, downloadCrm } from "./api";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Copy,
  Download,
  Paperclip,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "./api";
import {
  fieldEntries,
  R2_ATTACHMENT_TYPE,
  resolveFieldLabel,
  type CrmObject,
  type CrmRecord,
} from "@savia/crm-shared/metadata";
import type { RecordRelationGroup } from "@savia/crm-shared/relations";
import { useFieldLabelLocale } from "./localized-field-label-editor";
import {
  formatMapLocationSummary,
  parseMapLocation,
} from "@savia/crm-shared/map-location";
import { OperationError, OperationPager, TaskPanel } from "./operations";
import "./operations.css";

type Relation = {
  object: string;
  label: string;
  field: string;
  fieldLabel: string;
  direction: string;
  total: number;
  records: CrmRecord[];
};
type FileInfo = {
  id: string;
  field?: string | null;
  name: string;
  mime: string;
  size: number;
  version: number;
  created_at: string;
};
type Activity = {
  id: string;
  body: string;
  kind: string;
  version: number;
  created_at: string;
};
const relationTabKey = (group: RecordRelationGroup) =>
  `${group.definition.id}:${group.direction}`;
const label = (record: CrmRecord) =>
  String(
    record.name ??
      record.display_name ??
      record.organization_display_name ??
      record.title ??
      record.subject ??
      record.id,
  );
const display = (value: unknown): string => {
  const location = parseMapLocation(value);
  if (location) return formatMapLocationSummary(location);
  return value === null || value === undefined || value === ""
    ? "—"
    : typeof value === "boolean"
      ? value
        ? "Sí"
        : "No"
      : Array.isArray(value)
        ? value.map(display).join(", ")
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
};

const activityNames: Record<string, string> = {
  note: "Nota",
  call: "Llamada",
  meeting: "Reunión",
  email: "Correo registrado",
  "record.created": "Registro creado",
  "record.updated": "Registro actualizado",
  "record.restored": "Registro restaurado",
  "task.created": "Tarea programada",
  "task.updated": "Tarea actualizada",
  "task.completed": "Tarea completada",
  "file.uploaded": "Archivo adjuntado",
  "file.deleted": "Archivo eliminado",
};
function activityBody(item: Activity) {
  if (item.version) return item.body;
  try {
    const parsed = JSON.parse(item.body);
    if (parsed.title)
      return `${parsed.title}${parsed.due_at ? ` · ${parsed.due_at}` : ""}`;
    if (parsed.name) return parsed.name;
    if (parsed.before && parsed.after) {
      const changed = Object.keys(parsed.after).filter(
        (key) =>
          JSON.stringify(parsed.after[key]) !==
          JSON.stringify(parsed.before[key]),
      );
      return changed.length
        ? `Campos modificados: ${changed.join(", ")}`
        : "Datos actualizados";
    }
    return "Cambio guardado en el historial del registro.";
  } catch {
    return item.body;
  }
}

export default function RecordDetail({
  object,
  record,
  onEdit,
  onDuplicate,
  onClose,
  onRefresh,
  onQuotation,
  onNavigate,
}: {
  object: CrmObject;
  record: CrmRecord;
  onEdit: (record: CrmRecord) => void;
  onDuplicate?: (record: CrmRecord) => void;
  onClose: () => void;
  onRefresh: () => void;
  onQuotation?: (record: CrmRecord) => void;
  onNavigate?: (object: string, id: string) => void;
}) {
  const labelLocale = useFieldLabelLocale();
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateError, setDuplicateError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [tab, setTab] = useState("summary"),
    [relationPage, setRelationPage] = useState(1),
    [activityPage, setActivityPage] = useState(1),
    [body, setBody] = useState(""),
    [kind, setKind] = useState("note"),
    [saving, setSaving] = useState(false),
    [fileError, setFileError] = useState("");
  const collectionLinks = Boolean(
    onNavigate && getCrmRuntime().apiBasePath?.startsWith("/v1/data-domains/"),
  );
  const managedCustomer = !supportsLocalRecordTools(object);
  const capabilities = collectionCapabilities(object);
  const client = useQueryClient(),
    base = `${object.name}/${record.id}`;
  const detail = useQuery({
    queryKey: ["record-detail", object.name, record.id, relationPage],
    queryFn: () =>
      api<{ data: { record: CrmRecord; relations: Relation[] } }>(
        `/record-detail/${base}?page=${relationPage}`,
      ),
  });
  const relatedLinks = useQuery({
    enabled: collectionLinks,
    queryKey: [
      "record-links",
      "meta",
      getCrmRuntime().apiBasePath,
      getCrmRuntime().domainId,
      object.name,
      record.id,
      1,
    ],
    queryFn: () =>
      api<{ data: RecordRelationGroup[] }>(
        `/record-links/${encodeURIComponent(object.name)}/${encodeURIComponent(String(record.id))}?page=1&perPage=20&includeRecords=false`,
      ),
  });
  const relationGroups =
    object.config.studio?.collection?.kind === "crm"
      ? [...(relatedLinks.data?.data ?? [])].sort(
          (a, b) =>
            Number(b.total > 0) - Number(a.total > 0) ||
            a.label.localeCompare(b.label, "es"),
        )
      : relatedLinks.data?.data;
  const usesCollectionRelationGroups =
    collectionLinks && (relationGroups?.length ?? 0) > 0;
  const activity = useQuery({
    enabled: !managedCustomer,
    queryKey: ["record-activity", object.name, record.id, activityPage],
    queryFn: () =>
      api<{ data: Activity[]; total: number }>(
        `/record-activity/${base}?page=${activityPage}`,
      ),
  });
  const files = useQuery({
    enabled: !managedCustomer,
    queryKey: ["record-files", object.name, record.id],
    queryFn: () => api<{ data: FileInfo[] }>(`/files/${base}`),
  });
  const current = detail.data?.data.record ?? record;
  const legacyRelations = detail.data?.data.relations ?? [];
  const selectedLegacyRelation = tab.startsWith("legacy-relation:")
    ? legacyRelations[Number(tab.slice("legacy-relation:".length))]
    : undefined;
  const displayedLegacyRelations = selectedLegacyRelation
    ? [selectedLegacyRelation]
    : legacyRelations;
  const crmTitle =
    object.config.studio?.collection?.kind === "crm"
      ? [current.firstname, current.lastname]
          .filter((value) => typeof value === "string" && value.trim())
          .join(" ")
          .trim() || current[object.config.fieldOrder?.[0] ?? ""]
      : undefined;
  const detailTabs = [
    { id: "summary", label: "Información" },
    ...(usesCollectionRelationGroups
      ? (relationGroups ?? []).map((group) => ({
          id: `relation:${relationTabKey(group)}`,
          label: group.label,
          count: group.total,
        }))
      : legacyRelations.length
        ? legacyRelations.map((relation, index) => ({
            id: `legacy-relation:${index}`,
            label:
              relation.direction === "incoming"
                ? relation.label
                : relation.fieldLabel,
            count: relation.total,
          }))
        : [{ id: "relations", label: "Relaciones" }]),
    ...(supportsRecordHistory(object) && capabilities.read
      ? [{ id: "history", label: "Historial" }]
      : []),
    { id: "activity", label: "Actividad" },
    { id: "tasks", label: "Tareas" },
    {
      id: "files",
      label: `Archivos${files.data ? ` (${files.data.data.length})` : ""}`,
    },
  ].filter(
    (item) =>
      !managedCustomer ||
      item.id === "summary" ||
      item.id === "history" ||
      item.id === "relations" ||
      item.id.startsWith("relation:") ||
      item.id.startsWith("legacy-relation:"),
  );
  const detailTabScroll = useHorizontalScroll(
    detailTabs.map((item) => item.id).join("|"),
  );
  useEffect(() => {
    setRelationPage(1);
    setActivityPage(1);
    setBody("");
    setFileError("");
    setTab("summary");
  }, [base]);
  function refresh() {
    void client.invalidateQueries({
      queryKey: ["record-detail", object.name, record.id],
    });
    void client.invalidateQueries({
      queryKey: ["record-activity", object.name, record.id],
    });
    void client.invalidateQueries({
      queryKey: ["record-files", object.name, record.id],
    });
    onRefresh();
  }
  function attachmentValue(field: string) {
    if (files.isPending) return "Cargando archivos…";
    if (files.error)
      return (
        <OperationError error={files.error} retry={() => files.refetch()} />
      );
    const attachments =
      files.data?.data.filter((file) => file.field === field) ?? [];
    if (!attachments.length) return "—";
    return (
      <ul className="grid gap-2">
        {attachments.map((file) => (
          <li
            key={file.id}
            className="flex min-w-0 items-center gap-2 rounded-md border p-2"
          >
            <Paperclip size={16} aria-hidden="true" className="shrink-0" />
            <div className="min-w-0 flex-1">
              <span className="block break-all font-medium">{file.name}</span>
              <span className="block break-all text-xs text-muted-foreground">
                {(file.size / 1024).toLocaleString("es-CO", {
                  maximumFractionDigits: 1,
                })}{" "}
                KB · {file.mime}
              </span>
            </div>
            <OfficeEditButton
              file={file}
              disabled={Boolean(object.config.fields[field]?.readOnly)}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Descargar ${file.name}`}
              onClick={() =>
                void downloadCrm(
                  `/api/file/${file.id}/download`,
                  file.name,
                ).catch((error: Error) => toast.error(error.message))
              }
            >
              <Download size={16} aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
    );
  }
  async function addNote() {
    setSaving(true);
    try {
      await api(`/record-notes/${base}`, "POST", { body, kind });
      setBody("");
      setActivityPage(1);
      refresh();
      toast.success("Actividad registrada");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    setFileError("");
    if (!file.size || file.size > 5 * 1024 * 1024) {
      setFileError("El archivo debe pesar entre 1 byte y 5 MB.");
      return;
    }
    setSaving(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await crmFetch(`/api/files/${base}`, {
        method: "POST",
        body: form,
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(data.error ?? "No se pudo cargar el archivo.");
      refresh();
      toast.success("Archivo guardado");
    } catch (error) {
      setFileError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function removeFile(file: FileInfo) {
    setSaving(true);
    setFileError("");
    try {
      await api(`/file/${file.id}`, "DELETE", { version: file.version });
      refresh();
    } catch (e) {
      setFileError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="record-detail-dialog"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <div className="op-section-title">
            <div>
              <span className="op-muted">{object.label}</span>
              <DialogTitle>
                {crmTitle ? display(crmTitle) : label(current)}
              </DialogTitle>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {onDuplicate && canDuplicateRecord(object) && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={duplicating}
                  onClick={async () => {
                    setDuplicating(true);
                    setDuplicateError("");
                    try {
                      const result = await detail.refetch();
                      if (result.error) throw result.error;
                      const source = result.data?.data.record;
                      if (!source?.id)
                        throw new Error(
                          "No se pudo cargar el registro. Reintenta.",
                        );
                      if (mounted.current) onDuplicate(source);
                    } catch (error) {
                      if (mounted.current)
                        setDuplicateError(
                          error instanceof Error
                            ? error.message
                            : "No se pudo cargar el registro. Reintenta.",
                        );
                    } finally {
                      if (mounted.current) setDuplicating(false);
                    }
                  }}
                >
                  <Copy size={15} />{" "}
                  {duplicating ? "Cargando copia…" : "Duplicar"}
                </Button>
              )}
              {capabilities.update && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onEdit(current)}
                >
                  <Pencil size={15} /> Editar
                </Button>
              )}
            </div>
          </div>
          {duplicateError && !detail.error && (
            <p role="alert">{duplicateError}</p>
          )}
          <RecordOriginLinks record={current} />
        </DialogHeader>
        <nav
          className="op-tabs record-detail-tabs"
          aria-label="Ficha del registro"
        >
          <div className="op-tabs-scroll-shell">
            <div ref={detailTabScroll.viewportRef} className="op-tabs-scroll">
              {detailTabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-current={tab === item.id ? "page" : undefined}
                  onClick={() => setTab(item.id)}
                >
                  <span>{item.label}</span>
                  {"count" in item && item.count !== undefined ? (
                    <span className="record-links-tab-count">{item.count}</span>
                  ) : null}
                </button>
              ))}
            </div>
            <HorizontalScrollControls
              {...detailTabScroll}
              leftLabel="Ver tabs a la izquierda"
              rightLabel="Ver tabs a la derecha"
            />
          </div>
        </nav>
        <div className="op-detail-body">
          {getCrmRuntime().embedded &&
            object.config.studio?.business === "customer" &&
            getCrmRuntime().businessSetupEnabled !== false &&
            onQuotation && (
              <CustomerActions
                key={base}
                objectName={object.name}
                recordId={record.id}
                onQuotation={onQuotation}
                onRefresh={refresh}
              />
            )}
          <OperationError error={detail.error} retry={() => detail.refetch()} />
          {tab === "summary" && (
            <>
              <dl className="op-record-fields">
                {fieldEntries(object).map(([name, field]) => (
                  <div key={name}>
                    <dt>{resolveFieldLabel(field, labelLocale)}</dt>
                    <dd>
                      {field.type === R2_ATTACHMENT_TYPE
                        ? attachmentValue(name)
                        : field.config?.relation
                          ? (() => {
                              const related = detail.data?.data.relations.find(
                                (r) =>
                                  r.direction === "outgoing" &&
                                  r.field === name,
                              );
                              return related?.records.length
                                ? related.records.map(label).join(", ") +
                                    (related.total > related.records.length
                                      ? ` (+${related.total - related.records.length})`
                                      : "")
                                : display(
                                    recordOptionLabel(
                                      current[name],
                                      field.options,
                                    ),
                                  );
                            })()
                          : <FieldValueDisplay value={current[name]} field={field}/>}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="op-record-meta">
                {current.created_at &&
                  Number.isFinite(Date.parse(current.created_at)) && (
                    <span>
                      Creado:{" "}
                      {new Date(current.created_at).toLocaleString("es-CO")}
                    </span>
                  )}
                {current.updated_at &&
                  Number.isFinite(Date.parse(current.updated_at)) && (
                    <span>
                      Actualizado:{" "}
                      {new Date(current.updated_at).toLocaleString("es-CO")}
                    </span>
                  )}
                <small>ID: {current.id}</small>
              </div>
            </>
          )}
          {usesCollectionRelationGroups && tab.startsWith("relation:") && (
            <RecordLinks
              object={object}
              record={current}
              onNavigate={onNavigate!}
              activeGroupKey={tab.slice("relation:".length)}
              showGroupTabs={false}
              showHeading={false}
            />
          )}
          {(tab === "relations" || tab.startsWith("legacy-relation:")) &&
            !usesCollectionRelationGroups && (
              <section>
                <div className="op-section-title">
                  <div>
                    <h3>
                      {selectedLegacyRelation?.label ??
                        "Registros relacionados"}
                    </h3>
                    <p>
                      {selectedLegacyRelation
                        ? "Registros vinculados a esta cotización."
                        : "Referencias de este registro y objetos que apuntan a él."}
                    </p>
                  </div>
                </div>
                {detail.isPending ? (
                  <p>Cargando relaciones…</p>
                ) : !legacyRelations.length ? (
                  <div className="op-empty">
                    Este objeto no tiene relaciones configuradas.
                  </div>
                ) : (
                  displayedLegacyRelations.map((relation, i) => (
                    <article
                      className="op-relation"
                      key={`${relation.direction}-${relation.object}-${relation.field}-${i}`}
                    >
                      <h4>
                        {relation.fieldLabel}{" "}
                        <span className="op-muted">
                          · {relation.label} · {relation.total}
                        </span>
                      </h4>
                      <p className="op-muted">
                        {relation.direction === "incoming"
                          ? "Relacionados con este registro"
                          : "Referencias de este registro"}
                      </p>
                      {!relation.records.length ? (
                        <p className="op-muted">
                          {relation.total
                            ? "No hay registros en esta página."
                            : "Sin registros relacionados."}
                        </p>
                      ) : (
                        relation.records.map((related) => (
                          <div key={related.id} className="op-related-record">
                            <details>
                              <summary>
                                {label(related)}
                                <small>{related.id.slice(0, 8)}</small>
                              </summary>
                              <dl className="op-record-fields">
                                {Object.entries(related)
                                  .filter(
                                    ([key]) =>
                                      !key.startsWith("_") &&
                                      ![
                                        "id",
                                        "created_at",
                                        "updated_at",
                                      ].includes(key),
                                  )
                                  .map(([key, value]) => (
                                    <div key={key}>
                                      <dt>{key}</dt>
                                      <dd>{display(value)}</dd>
                                    </div>
                                  ))}
                              </dl>
                            </details>
                            {onNavigate ? (
                              <Button
                                className="mt-2"
                                onClick={() =>
                                  onNavigate(relation.object, related.id)
                                }
                                size="sm"
                                type="button"
                                variant="outline"
                              >
                                Abrir {label(related)}
                              </Button>
                            ) : null}
                          </div>
                        ))
                      )}
                    </article>
                  ))
                )}
                {detail.data && (
                  <OperationPager
                    page={relationPage}
                    total={Math.max(
                      0,
                      ...displayedLegacyRelations.map(
                        (relation) => relation.total,
                      ),
                    )}
                    onPage={setRelationPage}
                  />
                )}
              </section>
            )}
          {tab === "activity" && (
            <section>
              <form
                className="op-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void addNote();
                }}
              >
                <div className="op-toolbar">
                  <Label htmlFor="activity-kind">Registrar</Label>
                  <select
                    id="activity-kind"
                    className="op-select"
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    <option value="note">Nota</option>
                    <option value="call">Llamada</option>
                    <option value="meeting">Reunión</option>
                    <option value="email">Correo recibido o enviado</option>
                  </select>
                </div>
                <Label htmlFor="activity-note">Detalle de la actividad</Label>
                <textarea
                  id="activity-note"
                  className="op-textarea"
                  required
                  maxLength={10000}
                  rows={3}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Acuerdos, contexto y próximos pasos…"
                />
                <div className="op-actions">
                  <Button type="submit" disabled={saving || !body.trim()}>
                    {saving ? "Guardando…" : "Guardar actividad"}
                  </Button>
                </div>
              </form>
              <div className="op-section-title">
                <h3>Historial</h3>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Actualizar actividad"
                  onClick={() => activity.refetch()}
                >
                  <RefreshCw size={15} />
                </Button>
              </div>
              <OperationError
                error={activity.error}
                retry={() => activity.refetch()}
              />
              {activity.isPending ? (
                <p>Cargando historial…</p>
              ) : !activity.data?.data.length ? (
                <div className="op-empty">Aún no hay actividad registrada.</div>
              ) : (
                <ol className="op-timeline">
                  {activity.data.data.map((item) => (
                    <li key={item.id}>
                      <div>
                        <strong>{activityNames[item.kind] ?? item.kind}</strong>
                        <time>
                          {new Date(item.created_at).toLocaleString("es-CO")}
                        </time>
                      </div>
                      <p>{activityBody(item)}</p>
                      {item.version > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={saving}
                          onClick={async () => {
                            setSaving(true);
                            try {
                              await api(`/record-notes/${item.id}`, "DELETE", {
                                version: item.version,
                              });
                              refresh();
                            } catch (e) {
                              toast.error((e as Error).message);
                            } finally {
                              setSaving(false);
                            }
                          }}
                        >
                          <Trash2 size={13} /> Eliminar actividad
                        </Button>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              {activity.data && (
                <OperationPager
                  page={activityPage}
                  total={activity.data.total}
                  onPage={setActivityPage}
                />
              )}
            </section>
          )}
          {tab === "history" &&
            supportsRecordHistory(object) &&
            capabilities.read && (
              <Suspense fallback={<p role="status">Cargando historial…</p>}>
                <RecordHistory
                  object={object}
                  recordId={record.id}
                  onRestored={() => {
                    void client.invalidateQueries();
                  }}
                />
              </Suspense>
            )}
          {tab === "tasks" && (
            <TaskPanel
              objectName={object.name}
              recordId={record.id}
              onChange={refresh}
            />
          )}
          {tab === "files" && (
            <section>
              <div className="op-upload">
                <Paperclip size={24} />
                <div>
                  <Label htmlFor="record-file">Adjuntar archivo</Label>
                  <p>Hasta 5 MB por archivo y 50 adjuntos por registro.</p>
                  <Input
                    id="record-file"
                    type="file"
                    disabled={saving || (files.data?.data.length ?? 0) >= 50}
                    onChange={(e) => {
                      void upload(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>
              {saving && (
                <p className="op-muted" role="status">
                  Guardando cambios…
                </p>
              )}
              <OperationError
                error={fileError || files.error}
                retry={() => files.refetch()}
              />
              {!files.data?.data.length ? (
                <div className="op-empty">
                  Todavía no hay archivos adjuntos.
                </div>
              ) : (
                <div className="op-task-list">
                  {files.data.data.map((file) => (
                    <article className="op-task" key={file.id}>
                      <Paperclip size={18} />
                      <div className="op-grow">
                        <strong className="op-break">{file.name}</strong>
                        <p>
                          {(file.size / 1024).toLocaleString("es-CO", {
                            maximumFractionDigits: 1,
                          })}{" "}
                          KB ·{" "}
                          {new Date(file.created_at).toLocaleDateString(
                            "es-CO",
                          )}
                        </p>
                      </div>
                      <OfficeEditButton
                        file={file}
                        disabled={
                          saving ||
                          Boolean(
                            file.field &&
                            object.config.fields[file.field]?.readOnly,
                          )
                        }
                      />
                      <Button variant="ghost" size="icon" asChild>
                        <a
                          aria-label={`Descargar ${file.name}`}
                          href={`/api/file/${file.id}/download`}
                          download
                          onClick={(e) => {
                            e.preventDefault();
                            void downloadCrm(
                              `/api/file/${file.id}/download`,
                              file.name,
                            ).catch((e) => toast.error(e.message));
                          }}
                        >
                          <Download size={16} />
                        </a>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={saving}
                        aria-label={`Eliminar ${file.name}`}
                        onClick={() => removeFile(file)}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
