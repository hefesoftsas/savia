import {
  supportsLocalRecordTools,
  collectionCapabilities,
} from "./collection-capabilities";
import { downloadCrm } from "./api";
import MicrosoftExcel from "@thesvg/react/microsoft-excel";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Check,
  Download,
  FileSpreadsheet,
  Plus,
  RefreshCw,
  Trash2,
  Pencil,
  CalendarDays,
  Zap,
  ChartNoAxesCombined,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "./api";
import { fieldEntries, type CrmObject } from "@savia/crm-shared/metadata";
import { parseCsv } from "@savia/crm-shared/csv";
import "./operations.css";

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
export function OperationError({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return error ? (
    <div className="op-error" role="alert">
      {message(error)}{" "}
      {retry && (
        <Button size="sm" variant="outline" onClick={retry}>
          Reintentar
        </Button>
      )}
    </div>
  ) : null;
}
export function OperationPager({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="op-pager">
      <span>
        {total} resultados · página {page} de{" "}
        {Math.max(1, Math.ceil(total / 20))}
      </span>
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Anterior
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={page * 20 >= total}
          onClick={() => onPage(page + 1)}
        >
          Siguiente
        </Button>
      </div>
    </div>
  );
}

type Task = {
  id: string;
  title: string;
  owner: string;
  due_at: string;
  status: "pending" | "done";
  version: number;
  object_name: string;
  record_id: string;
};
export function TaskPanel({
  objectName,
  recordId,
  onChange,
}: {
  objectName?: string;
  recordId?: string;
  onChange?: () => void;
}) {
  const [page, setPage] = useState(1),
    [status, setStatus] = useState("pending"),
    [editing, setEditing] = useState<Partial<Task> | null>(null),
    [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["operational-tasks", objectName, recordId, page, status],
    queryFn: () =>
      api<{ data: Task[]; total: number; overdue: number }>(
        `/tasks?${new URLSearchParams({ page: String(page), status, ...(objectName ? { object: objectName } : {}), ...(recordId ? { record: recordId } : {}) })}`,
      ),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["operational-tasks"] });
    void queryClient.invalidateQueries({ queryKey: ["record-activity"] });
    onChange?.();
  };
  useEffect(() => {
    setPage(1);
  }, [objectName, recordId, status]);
  async function save(task: Partial<Task>) {
    setSaving(true);
    try {
      await api(
        task.id ? `/tasks/${task.id}` : "/tasks",
        task.id ? "PATCH" : "POST",
        task,
      );
      setEditing(null);
      refresh();
      toast.success(task.id ? "Tarea actualizada" : "Tarea creada");
    } catch (e) {
      toast.error(message(e));
    } finally {
      setSaving(false);
    }
  }
  async function remove(task: Task) {
    setSaving(true);
    try {
      await api(`/tasks/${task.id}`, "DELETE", { version: task.version });
      refresh();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="op-section">
      <div className="op-section-title">
        <div>
          <h3>Tareas y seguimiento</h3>
          <p>
            {query.data?.overdue
              ? `${query.data.overdue} tareas vencidas en el espacio de trabajo`
              : "Fechas, responsables y próximos pasos"}
          </p>
        </div>
        {recordId && (
          <Button
            size="sm"
            onClick={() =>
              setEditing({
                title: "",
                owner: "",
                due_at: new Date().toISOString().slice(0, 10),
                status: "pending",
                object_name: objectName,
                record_id: recordId,
              })
            }
          >
            <Plus size={15} /> Tarea
          </Button>
        )}
      </div>
      <div className="op-toolbar">
        <Label htmlFor="task-status">Mostrar</Label>
        <select
          id="task-status"
          className="op-select"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="pending">Pendientes</option>
          <option value="overdue">Vencidas</option>
          <option value="done">Completadas</option>
          <option value="">Todas</option>
        </select>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => query.refetch()}
          aria-label="Actualizar tareas"
        >
          <RefreshCw size={15} />
        </Button>
      </div>
      <OperationError error={query.error} retry={() => query.refetch()} />
      {query.isPending ? (
        <div className="space-y-3" role="status" aria-live="polite">
          <p className="op-muted">Cargando tareas…</p>
          <div className="space-y-2">
            {Array.from({ length: 3 }, (_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg border bg-card p-3"
              >
                <Skeleton className="size-5 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-6 w-16 rounded-md" />
              </div>
            ))}
          </div>
        </div>
      ) : !query.data?.data.length ? (
        <div className="op-empty">
          No hay tareas en esta vista.
          {!recordId && (
            <p>
              Abre la ficha de un registro para programar su siguiente
              actividad.
            </p>
          )}
        </div>
      ) : (
        <div className="op-task-list">
          {query.data.data.map((task) => (
            <article className="op-task" key={task.id}>
              <Button
                size="icon"
                variant="outline"
                disabled={saving}
                aria-label={
                  task.status === "done" ? "Reabrir tarea" : "Completar tarea"
                }
                onClick={() =>
                  save({
                    ...task,
                    status: task.status === "done" ? "pending" : "done",
                  })
                }
              >
                <Check size={16} opacity={task.status === "done" ? 1 : 0.25} />
              </Button>
              <div className="op-grow">
                <strong className={task.status === "done" ? "op-strike" : ""}>
                  {task.title}
                </strong>
                <p>
                  <span
                    className={
                      task.status === "pending" &&
                      task.due_at < new Date().toISOString().slice(0, 10)
                        ? "op-overdue"
                        : ""
                    }
                  >
                    {dateLabel(task.due_at)}
                  </span>{" "}
                  · {task.owner || "Sin responsable"}
                  {!recordId && (
                    <>
                      {" "}
                      · {task.object_name}{" "}
                      <small title={task.record_id}>
                        {task.record_id.slice(0, 8)}
                      </small>
                    </>
                  )}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Editar ${task.title}`}
                onClick={() => setEditing(task)}
              >
                <Pencil size={15} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={saving}
                aria-label={`Eliminar ${task.title}`}
                onClick={() => remove(task)}
              >
                <Trash2 size={15} />
              </Button>
            </article>
          ))}
        </div>
      )}
      {query.data && (
        <OperationPager page={page} total={query.data.total} onPage={setPage} />
      )}
      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? "Editar tarea" : "Programar tarea"}
            </DialogTitle>
            <DialogDescription>
              Asocia el siguiente paso a este registro.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <form
              className="op-form"
              onSubmit={(e) => {
                e.preventDefault();
                void save(editing);
              }}
            >
              <Label htmlFor="task-title">Título</Label>
              <Input
                id="task-title"
                required
                maxLength={200}
                value={editing.title ?? ""}
                onChange={(e) =>
                  setEditing({ ...editing, title: e.target.value })
                }
              />
              <Label htmlFor="task-owner">Responsable</Label>
              <Input
                id="task-owner"
                maxLength={100}
                value={editing.owner ?? ""}
                onChange={(e) =>
                  setEditing({ ...editing, owner: e.target.value })
                }
              />
              <Label htmlFor="task-due">Vencimiento</Label>
              <Input
                id="task-due"
                type="date"
                required
                value={editing.due_at ?? ""}
                onChange={(e) =>
                  setEditing({ ...editing, due_at: e.target.value })
                }
              />
              <Button disabled={saving} type="submit">
                {saving ? "Guardando…" : "Guardar tarea"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

type ImportResult = {
  data: {
    row: number;
    status: string;
    error?: string;
    id?: string;
    data?: Record<string, unknown>;
  }[];
  total: number;
  importId: string;
  summary: { ready: number; created: number; skipped: number; errors: number };
};
function ImportExport({ objects }: { objects: CrmObject[] }) {
  const [objectName, setObjectName] = useState(objects[0]?.name ?? ""),
    [csv, setCsv] = useState(""),
    [headers, setHeaders] = useState<string[]>([]),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [duplicateField, setDuplicateField] = useState(""),
    [policy, setPolicy] = useState("skip"),
    [result, setResult] = useState<ImportResult | null>(null),
    [committed, setCommitted] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [page, setPage] = useState(1);
  const object = objects.find((o) => o.name === objectName);
  const managedCustomer =
    object?.config.studio?.business === "managed-customer";
  const managedObject = ["managed-customer", "managed-agency"].includes(
    object?.config.studio?.business ?? "",
  );
  const queryClient = useQueryClient();
  const invalidatePreview = () => {
    setResult(null);
    setCommitted(false);
    setPage(1);
  };
  useEffect(() => {
    if (!objectName && objects.length) setObjectName(objects[0].name);
  }, [objects, objectName]);
  async function read(file?: File) {
    if (!file) return;
    setError("");
    invalidatePreview();
    try {
      if (file.size > 1024 * 1024) throw new Error("Máximo 1 MB por CSV.");
      const text = await file.text(),
        parsed = parseCsv(text);
      setCsv(text);
      setHeaders(parsed.headers);
      setMapping(
        Object.fromEntries(
          parsed.headers.map((header) => [
            header,
            object?.config.fields[header] ? header : "",
          ]),
        ),
      );
    } catch (e) {
      setError(message(e));
      setCsv("");
      setHeaders([]);
    }
  }
  async function run(commit: boolean) {
    setPending(true);
    setError("");
    try {
      const data = await api<ImportResult>(
        `/import/${objectName}/${commit ? "commit" : "preview"}`,
        "POST",
        {
          csv,
          mapping,
          duplicateField,
          duplicatePolicy: policy,
          ...(commit ? { importId: result?.importId } : {}),
        },
      );
      setResult(data);
      setPage(1);
      setCommitted(commit);
      if (commit) {
        void queryClient.invalidateQueries();
        toast.success(
          `${data.summary.created} registros creados; ${data.summary.errors} errores`,
        );
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(false);
    }
  }
  const statusLabel: Record<string, string> = {
    ready: "Listo",
    created: "Creado",
    skipped: "Omitido",
    error: "Error",
  };
  return (
    <div className="op-section">
      <div className="op-section-title">
        <div>
          <h3>Entrada y salida de datos</h3>
          <p>
            {managedCustomer
              ? "Exporta hasta 10.000 clientes por archivo CSV."
              : managedObject
                ? "Exporta registros a CSV."
                : "Importa hasta 1.000 filas por lote y exporta todos los registros."}
          </p>
        </div>
      </div>
      <div className="op-toolbar">
        <Label htmlFor="csv-object">Objeto</Label>
        <select
          id="csv-object"
          className="op-select"
          value={objectName}
          onChange={(e) => {
            setObjectName(e.target.value);
            setDuplicateField("");
            setCsv("");
            setHeaders([]);
            setMapping({});
            invalidatePreview();
          }}
        >
          {objects.map((o) => (
            <option key={o.name} value={o.name}>
              {o.label}
            </option>
          ))}
        </select>
        {objectName && !object?.config.studio?.collection && (
          <Button variant="outline" size="icon" asChild>
            <a
              href={`/api/export/${objectName}`}
              download
              aria-label={
                managedCustomer
                  ? "Exportar CSV (máximo 10.000)"
                  : "Exportar CSV completo"
              }
              title={
                managedCustomer
                  ? "Exportar CSV (máximo 10.000)"
                  : "Exportar CSV completo"
              }
              onClick={(e) => {
                e.preventDefault();
                void downloadCrm(
                  `/api/export/${objectName}`,
                  `${objectName}.csv`,
                ).catch((e) => toast.error(e.message));
              }}
            >
              <MicrosoftExcel aria-hidden className="size-4" />
            </a>
          </Button>
        )}
      </div>
      {object &&
        supportsLocalRecordTools(object) &&
        collectionCapabilities(object).create && (
          <>
            <div className="op-upload">
              <FileSpreadsheet size={24} />
              <div>
                <Label htmlFor="csv-file">Seleccionar CSV</Label>
                <p>
                  UTF-8, separado por comas o punto y coma. Relaciones: ID;
                  múltiples: arreglo JSON.
                </p>
                <Input
                  id="csv-file"
                  type="file"
                  accept=".csv,text/csv"
                  key={objectName}
                  disabled={pending}
                  onChange={(e) => read(e.target.files?.[0])}
                />
              </div>
            </div>
            {headers.length > 0 && object && (
              <>
                <div className="op-section-title">
                  <h4>Asignar columnas</h4>
                  <span className="op-muted">
                    Las columnas sin asignar se omiten
                  </span>
                </div>
                <div className="op-mapping">
                  {headers.map((header) => (
                    <div key={header}>
                      <Label htmlFor={`map-${header}`}>{header}</Label>
                      <ArrowRight size={14} />
                      <select
                        id={`map-${header}`}
                        className="op-select"
                        value={mapping[header] ?? ""}
                        onChange={(e) => {
                          setMapping({ ...mapping, [header]: e.target.value });
                          invalidatePreview();
                        }}
                      >
                        <option value="">Omitir columna</option>
                        {fieldEntries(object).map(([name, f]) => (
                          <option key={name} value={name}>
                            {f.label}
                            {f.required ? " *" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <div className="op-toolbar">
                  <Label htmlFor="csv-duplicates">
                    Detectar duplicados por
                  </Label>
                  <select
                    id="csv-duplicates"
                    className="op-select"
                    value={duplicateField}
                    onChange={(e) => {
                      setDuplicateField(e.target.value);
                      invalidatePreview();
                    }}
                  >
                    <option value="">Campos con restricción única</option>
                    {fieldEntries(object).map(([name, f]) => (
                      <option key={name} value={name}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Política de duplicados"
                    className="op-select"
                    value={policy}
                    onChange={(e) => {
                      setPolicy(e.target.value);
                      invalidatePreview();
                    }}
                  >
                    <option value="skip">Omitir duplicados</option>
                    <option value="error">Marcar duplicados como error</option>
                  </select>
                  <Button
                    disabled={pending}
                    variant="outline"
                    onClick={() => run(false)}
                  >
                    {pending ? "Procesando…" : "Validar y previsualizar"}
                  </Button>
                </div>
              </>
            )}
            <OperationError error={error} />
            {result && (
              <>
                <div className="op-stats">
                  <div>
                    <strong>
                      {committed
                        ? result.summary.created
                        : result.summary.ready}
                    </strong>
                    <span>
                      {committed ? "Creados" : "Listos para importar"}
                    </span>
                  </div>
                  <div>
                    <strong>{result.summary.skipped}</strong>
                    <span>Duplicados omitidos</span>
                  </div>
                  <div>
                    <strong>{result.summary.errors}</strong>
                    <span>Filas con error</span>
                  </div>
                </div>
                <p className="op-muted">
                  Se importan únicamente las filas válidas. Corrige los errores
                  en el CSV y vuelve a cargarlo; cada fila muestra su resultado.
                </p>
                <div className="op-table-wrap">
                  <table className="op-table">
                    <thead>
                      <tr>
                        <th>Fila</th>
                        <th>Estado</th>
                        <th>Datos / resultado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.data
                        .slice((page - 1) * 20, page * 20)
                        .map((row) => (
                          <tr key={row.row}>
                            <td>{row.row}</td>
                            <td>
                              <span
                                className={`op-badge ${row.status === "error" ? "op-badge-error" : ""}`}
                              >
                                {statusLabel[row.status]}
                              </span>
                            </td>
                            <td className="op-break">
                              {row.error ??
                                (row.id
                                  ? `ID: ${row.id}`
                                  : Object.entries(row.data ?? {})
                                      .map(
                                        ([k, v]) =>
                                          `${object?.config.fields[k]?.label ?? k}: ${Array.isArray(v) ? v.join(", ") : String(v ?? "—")}`,
                                      )
                                      .join(" · "))}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <OperationPager
                  page={page}
                  total={result.total}
                  onPage={setPage}
                />
                {!committed && (
                  <Button
                    disabled={pending || !result.summary.ready}
                    onClick={() => run(true)}
                  >
                    Importar {result.summary.ready} filas válidas
                  </Button>
                )}
              </>
            )}
          </>
        )}
    </div>
  );
}

type Automation = {
  id?: string;
  version?: number;
  name: string;
  object_name: string;
  enabled: boolean;
  config: {
    field: string;
    value: string | number | boolean;
    title: string;
    dueDays: number;
    owner: string;
    ownerField: string;
  };
};
function Automations({ objects }: { objects: CrmObject[] }) {
  const [editing, setEditing] = useState<Automation | null>(null),
    [saving, setSaving] = useState(false),
    [page, setPage] = useState(1),
    [saveError, setSaveError] = useState("");
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["automations"],
    queryFn: () => api<{ data: Automation[] }>("/automations"),
  });
  const logs = useQuery({
    queryKey: ["automation-runs", page],
    queryFn: () =>
      api<{
        data: {
          id: string;
          status: string;
          created_at: string;
          object_name: string;
          record_id: string;
          detail: { name?: string; error?: string };
        }[];
        total: number;
      }>(`/automation-runs?page=${page}`),
  });
  const object = objects.find((o) => o.name === editing?.object_name),
    field = object?.config.fields[editing?.config.field ?? ""];
  function refresh() {
    void client.invalidateQueries({ queryKey: ["automations"] });
    void client.invalidateQueries({ queryKey: ["automation-runs"] });
  }
  async function save(value: Automation) {
    setSaving(true);
    setSaveError("");
    try {
      await api(
        value.id ? `/automations/${value.id}` : "/automations",
        value.id ? "PATCH" : "POST",
        value,
      );
      setEditing(null);
      refresh();
      toast.success("Automatización guardada");
    } catch (e) {
      setSaveError(message(e));
      toast.error(message(e));
    } finally {
      setSaving(false);
    }
  }
  async function remove(rule: Automation) {
    try {
      await api(`/automations/${rule.id}`, "DELETE", { version: rule.version });
      refresh();
    } catch (e) {
      toast.error(message(e));
    }
  }
  const setConfig = (config: Partial<Automation["config"]>) =>
    editing &&
    setEditing({ ...editing, config: { ...editing.config, ...config } });
  return (
    <div className="op-section">
      <div className="op-section-title">
        <div>
          <h3>Automatizaciones</h3>
          <p>
            Al crear un registro o cambiar un campo al valor indicado, programa
            una tarea.
          </p>
        </div>
        <Button
          disabled={!objects.length}
          onClick={() => {
            setSaveError("");
            setEditing({
              name: "",
              object_name: objects[0].name,
              enabled: true,
              config: {
                field: fieldEntries(objects[0])[0]?.[0] ?? "",
                value: "",
                title: "",
                dueDays: 1,
                owner: "",
                ownerField: "",
              },
            });
          }}
        >
          <Plus size={16} /> Nueva regla
        </Button>
      </div>
      <OperationError error={query.error} retry={() => query.refetch()} />
      {query.isPending ? (
        <div className="space-y-3" role="status" aria-live="polite">
          <p className="text-xs font-medium text-muted-foreground">
            Cargando reglas…
          </p>
          <div className="space-y-2">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="rounded-lg border bg-card p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="size-6 rounded-md" />
                </div>
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-3 w-40" />
              </div>
            ))}
          </div>
        </div>
      ) : !query.data?.data.length ? (
        <div className="op-empty">
          Aún no hay automatizaciones.
          <p>
            Por ejemplo: al ganar una oportunidad, crear «Preparar bienvenida»
            para el día siguiente.
          </p>
        </div>
      ) : (
        <div className="op-rules">
          {query.data.data.map((rule) => (
            <article key={rule.id}>
              <div>
                <span
                  className={`op-badge ${rule.enabled ? "" : "op-badge-muted"}`}
                >
                  {rule.enabled ? "Activa" : "Pausada"}
                </span>
                <h4>{rule.name}</h4>
                <p>
                  {objects.find((o) => o.name === rule.object_name)?.label ??
                    rule.object_name}{" "}
                  · {rule.config.field} = {String(rule.config.value)}
                </p>
                <p>
                  Crear «{rule.config.title}» · +{rule.config.dueDays} días ·{" "}
                  {rule.config.ownerField ||
                    rule.config.owner ||
                    "Sin responsable"}
                </p>
              </div>
              <div className="op-actions">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={saving}
                  onClick={() => save({ ...rule, enabled: !rule.enabled })}
                >
                  {rule.enabled ? "Pausar" : "Activar"}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Editar ${rule.name}`}
                  onClick={() => {
                    setSaveError("");
                    setEditing(rule);
                  }}
                >
                  <Pencil size={15} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Eliminar ${rule.name}`}
                  onClick={() => remove(rule)}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="op-section-title">
        <div>
          <h3>Historial de ejecución</h3>
          <p>
            Una tarea por regla y versión del registro, incluso ante reintentos.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => logs.refetch()}>
          <RefreshCw size={15} /> Actualizar
        </Button>
      </div>
      <OperationError error={logs.error} retry={() => logs.refetch()} />
      {!logs.data?.data.length ? (
        <p className="op-muted">
          Las ejecuciones aparecerán aquí cuando un registro cumpla una regla.
        </p>
      ) : (
        <div className="op-table-wrap">
          <table className="op-table">
            <thead>
              <tr>
                <th>Regla</th>
                <th>Registro</th>
                <th>Estado</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {logs.data.data.map((log) => (
                <tr key={log.id}>
                  <td>
                    {log.detail.name ?? "Regla eliminada"}
                    {log.detail.error && (
                      <p className="op-overdue">{log.detail.error}</p>
                    )}
                  </td>
                  <td>
                    {log.object_name} · {log.record_id.slice(0, 8)}
                  </td>
                  <td>
                    {log.status === "success" ? (
                      "Tarea creada"
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          try {
                            await api(
                              `/automation-runs/${log.id}/retry`,
                              "POST",
                              {},
                            );
                            refresh();
                          } catch (e) {
                            toast.error(message(e));
                          }
                        }}
                      >
                        Reintentar
                      </Button>
                    )}
                  </td>
                  <td>{dateLabel(log.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {logs.data && (
        <OperationPager page={page} total={logs.data.total} onPage={setPage} />
      )}
      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <DialogContent className="op-dialog">
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? "Editar automatización" : "Nueva automatización"}
            </DialogTitle>
            <DialogDescription>
              Elige el evento y la tarea que debe generarse.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <form
              className="op-form"
              onSubmit={(e) => {
                e.preventDefault();
                void save(editing);
              }}
            >
              <Label htmlFor="rule-name">Nombre de la regla</Label>
              <Input
                id="rule-name"
                required
                maxLength={100}
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
              <Label htmlFor="rule-object">Objeto</Label>
              <select
                id="rule-object"
                className="op-select"
                value={editing.object_name}
                onChange={(e) => {
                  const next = objects.find((o) => o.name === e.target.value)!;
                  setEditing({
                    ...editing,
                    object_name: next.name,
                    config: {
                      ...editing.config,
                      field: fieldEntries(next)[0]?.[0] ?? "",
                      value: "",
                      ownerField: "",
                    },
                  });
                }}
              >
                {objects.map((o) => (
                  <option key={o.name} value={o.name}>
                    {o.label}
                  </option>
                ))}
              </select>
              <div className="op-two">
                <div>
                  <Label htmlFor="rule-field">Cuando cambie</Label>
                  <select
                    id="rule-field"
                    className="op-select"
                    value={editing.config.field}
                    onChange={(e) =>
                      setConfig({ field: e.target.value, value: "" })
                    }
                  >
                    {object &&
                      fieldEntries(object).map(([name, f]) => (
                        <option key={name} value={name}>
                          {f.label}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="rule-value">Al valor</Label>
                  {field?.options?.length ? (
                    <select
                      id="rule-value"
                      className="op-select"
                      required
                      value={String(editing.config.value)}
                      onChange={(e) =>
                        setConfig({
                          value:
                            field.options?.find(
                              (o) => String(o.value) === e.target.value,
                            )?.value ?? e.target.value,
                        })
                      }
                    >
                      <option value="">Seleccionar</option>
                      {field.options.map((o) => (
                        <option key={String(o.value)} value={String(o.value)}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : field?.type === "Toggle" ? (
                    <select
                      id="rule-value"
                      className="op-select"
                      value={String(editing.config.value)}
                      onChange={(e) =>
                        setConfig({ value: e.target.value === "true" })
                      }
                    >
                      <option value="">Seleccionar</option>
                      <option value="true">Sí</option>
                      <option value="false">No</option>
                    </select>
                  ) : (
                    <Input
                      id="rule-value"
                      required
                      value={String(editing.config.value)}
                      type={field?.type === "Number" ? "number" : "text"}
                      onChange={(e) =>
                        setConfig({
                          value:
                            field?.type === "Number"
                              ? Number(e.target.value)
                              : e.target.value,
                        })
                      }
                    />
                  )}
                </div>
              </div>
              <Label htmlFor="rule-title">Título de la tarea</Label>
              <Input
                id="rule-title"
                required
                maxLength={200}
                placeholder="Dar seguimiento a {{name}}"
                value={editing.config.title}
                onChange={(e) => setConfig({ title: e.target.value })}
              />
              <p className="op-muted">
                Puedes insertar valores con {"{{nombre_del_campo}}"}.
              </p>
              <div className="op-two">
                <div>
                  <Label htmlFor="rule-due">Vence en días</Label>
                  <Input
                    id="rule-due"
                    type="number"
                    min={0}
                    max={365}
                    required
                    value={editing.config.dueDays}
                    onChange={(e) =>
                      setConfig({ dueDays: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="rule-owner">Responsable predeterminado</Label>
                  <Input
                    id="rule-owner"
                    value={editing.config.owner}
                    maxLength={100}
                    onChange={(e) => setConfig({ owner: e.target.value })}
                  />
                </div>
              </div>
              <Label htmlFor="rule-owner-field">
                Tomar responsable del registro
              </Label>
              <select
                id="rule-owner-field"
                className="op-select"
                value={editing.config.ownerField}
                onChange={(e) => setConfig({ ownerField: e.target.value })}
              >
                <option value="">Usar responsable predeterminado</option>
                {object &&
                  fieldEntries(object).map(([name, f]) => (
                    <option key={name} value={name}>
                      {f.label}
                    </option>
                  ))}
              </select>
              <OperationError error={saveError} />
              <Button type="submit" disabled={saving}>
                {saving ? "Guardando…" : "Guardar regla"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type Report = {
  object: string;
  label: string;
  total: number;
  amount: number;
  won: number;
  lost: number;
  conversion: number | null;
  groups: { stage: string; owner: string; count: number; amount: number }[];
};
function Reports() {
  const query = useQuery({
    queryKey: ["operational-reports"],
    queryFn: () => api<{ data: Report[]; generatedAt: string }>("/reports"),
  });
  const number = (value: number) =>
    new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(value);
  return (
    <section className="op-section">
      <div className="op-section-title">
        <div>
          <h3>Resultados del pipeline</h3>
          <p>
            Agregados de todos los registros, según la configuración de cada
            objeto.
          </p>
        </div>
        <Button variant="outline" onClick={() => query.refetch()}>
          <RefreshCw size={15} /> Actualizar
        </Button>
      </div>
      <OperationError error={query.error} retry={() => query.refetch()} />
      {query.isPending ? (
        <div className="space-y-4" role="status" aria-live="polite">
          <p className="text-xs font-medium text-muted-foreground">
            Cargando reportes…
          </p>
          <div className="rounded-xl border bg-card p-6 space-y-4">
            <Skeleton className="h-6 w-48" />
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="space-y-2 rounded-lg border p-3">
                  <Skeleton className="h-6 w-20" />
                  <Skeleton className="h-3 w-28" />
                </div>
              ))}
            </div>
            <div className="overflow-hidden rounded-md border">
              <div className="flex items-center gap-4 border-b bg-muted/40 px-4 py-3">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-4 w-24" />
                ))}
              </div>
              <div className="divide-y">
                {Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-3">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : !query.data?.data.length ? (
        <div className="op-empty">
          Configura un pipeline en el diseñador de un objeto para ver sus
          resultados.
        </div>
      ) : (
        query.data.data.map((report) => (
          <article key={report.object} className="op-report">
            <h4>{report.label}</h4>
            <div className="op-stats">
              <div>
                <strong>{number(report.total)}</strong>
                <span>Registros</span>
              </div>
              <div>
                <strong>{number(report.amount)}</strong>
                <span>Importe total</span>
              </div>
              <div>
                <strong>
                  {report.conversion === null
                    ? "—"
                    : `${number(report.conversion * 100)}%`}
                </strong>
                <span>Ganadas / cerradas</span>
              </div>
              <div>
                <strong>
                  {report.won} / {report.lost}
                </strong>
                <span>Ganadas / perdidas</span>
              </div>
            </div>
            <div className="op-table-wrap">
              <table className="op-table">
                <thead>
                  <tr>
                    <th>Etapa</th>
                    <th>Responsable</th>
                    <th>Registros</th>
                    <th>Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {report.groups.map((group, i) => (
                    <tr key={i}>
                      <td>{group.stage}</td>
                      <td>{group.owner}</td>
                      <td>{number(group.count)}</td>
                      <td>{number(group.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        ))
      )}
      <p className="op-muted">
        Conversión = ganadas ÷ (ganadas + perdidas), usando las etapas de cierre
        configuradas. Las oportunidades abiertas se excluyen del denominador.
      </p>
    </section>
  );
}

export default function Operations({ objects }: { objects: CrmObject[] }) {
  const [tab, setTab] = useState("tasks");
  return (
    <main className="operations-page">
      <header className="op-page-title">
        <div>
          <span className="eyebrow">OPERACIÓN COMERCIAL</span>
          <h1>Trabajo y resultados</h1>
          <p>
            Coordina seguimientos, mueve datos y observa cómo avanza tu negocio.
          </p>
        </div>
      </header>
      <nav className="op-tabs" aria-label="Operaciones">
        {[
          { id: "tasks", label: "Seguimiento", Icon: CalendarDays },
          { id: "import", label: "Importar y exportar", Icon: FileSpreadsheet },
          { id: "automations", label: "Automatizaciones", Icon: Zap },
          { id: "reports", label: "Reportes", Icon: ChartNoAxesCombined },
        ].map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            <Icon size={17} />
            {label}
          </button>
        ))}
      </nav>
      {tab === "tasks" && <TaskPanel />}
      {tab === "import" && <ImportExport objects={objects} />}
      {tab === "automations" && <Automations objects={objects} />}
      {tab === "reports" && <Reports />}
    </main>
  );
}
