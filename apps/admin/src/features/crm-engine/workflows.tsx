import { useMessages, useAppLocale, intlLocale } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";
import { WorkflowWebhookSettings } from "./workflow-webhooks";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowDown,
  Plus,
  Play,
  Save,
  GitBranch,
  TriangleAlert,
  RotateCcw,
  Inbox,
  History,
  ChevronRight,
  Layers,
} from "lucide-react";
import {
  workflowDraftSchema,
  type WorkflowDefinition,
  type WorkflowNode,
  type WorkflowValue,
} from "@savia/crm-shared/workflows";
import { fieldEntries, type CrmObject } from "@savia/crm-shared/metadata";
import { api } from "./api";
import { getCrmRuntime } from "./runtime";
import {
  newStep,
  stepLabels,
  StepEditor,
  TriggerEditor,
  ValueInput,
} from "./workflow-editor";
import "./workflows.css";

type Draft = {
  id?: string;
  name: string;
  revision: number;
  definition: WorkflowDefinition;
  enabled: number;
  published_version?: string | null;
};
type Run = {
  id: string;
  status: string;
  wake_at?: number;
  version_id: string;
  node_id: string | null;
  error?: string;
  created_at: string;
  deliveries?: {
    node_id: string;
    sequence: number;
    status: number | null;
    error: string | null;
    finished_at: number | null;
  }[];
  jobs?: { node_id: string; type: string; output: unknown; attempts: number }[];
};

function errorText(error: unknown): string {
  if (!error) return "";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error)
    return String((error as { message: unknown }).message);
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function WorkflowError({
  error,
  retryLabel,
  onRetry,
}: {
  error: unknown;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  const message = errorText(error);
  if (!message) return null;
  return (
    <div className="wf-error" role="alert">
      <span className="wf-error-icon" aria-hidden="true">
        <TriangleAlert size={16} />
      </span>
      <span className="wf-error-text">{message}</span>
      {onRetry && retryLabel ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCcw size={14} />
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

function runBadgeClass(status: string): string {
  switch (status) {
    case "completed":
      return "wf-badge wf-badge-ok";
    case "failed":
    case "blocked":
      return "wf-badge wf-badge-error";
    case "running":
    case "queued":
    case "waiting":
      return "wf-badge wf-badge-progress";
    default:
      return "wf-badge wf-badge-muted";
  }
}

function FlowListSkeleton({ label }: { label: string }) {
  return (
    <div className="wf-skeleton-list" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="wf-skeleton-item">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export default function Workflows({ objects }: { objects: CrmObject[] }) {
  const runtime = getCrmRuntime();
  const scope = JSON.stringify([
    runtime.domainId,
    runtime.apiBasePath,
    runtime.localWorkspace?.scope,
  ]);
  return <WorkspaceWorkflows key={scope} objects={objects} scope={scope} />;
}
function WorkspaceWorkflows({
  objects,
  scope,
}: {
  objects: CrmObject[];
  scope: string;
}) {
  const t = useMessages(automationMessages);
  const locale = useAppLocale();
  const statuses: Record<string, string> = {
    queued: t("En cola"),
    running: t("En ejecución"),
    waiting: t("En espera"),
    completed: t("Completado"),
    failed: t("Fallido"),
    blocked: t("Sin permiso"),
    cancelled: t("Cancelado"),
  };

  const fresh = (): Draft => ({
    name: t("Nuevo flujo"),
    revision: 0,
    enabled: 0,
    definition: {
      trigger: { type: "manual" },
      nodes: [newStep("transform", "step_1", "")],
    },
  });

  const manualAttempt = useRef<{ fingerprint: string; key: string } | null>(
    null,
  );
  const native = objects.filter(
    (o) =>
      !o.config.studio?.collection?.kind ||
      o.config.studio.collection.kind === "crm",
  );
  const client = useQueryClient(),
    [draft, setDraft] = useState<Draft | null>(null),
    [selected, setSelected] = useState("step_1"),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [kind, setKind] = useState<WorkflowNode["type"]>("transform"),
    [runId, setRunId] = useState<string | null>(null),
    [manualData, setManualData] = useState<Record<string, WorkflowValue>>({}),
    [notice, setNotice] = useState("");
  const bundles = useQuery({
    queryKey: ["workflow-bundles", scope],
    queryFn: () =>
      api<{
        data: {
          id: string;
          label: string;
          description: string;
          missing: string[];
          workflows: string[];
        }[];
      }>("/workflow-bundles"),
  });
  const list = useQuery({
    queryKey: ["workflows", scope],
    queryFn: () => api<{ data: Draft[] }>("/workflows"),
  });
  const history = useQuery({
    queryKey: ["workflow-history", scope, draft?.id],
    enabled: !!draft?.id,
    queryFn: () => api<{ data: Run[] }>(`/workflows/${draft!.id}/executions`),
    refetchInterval: 5000,
  });
  const detail = useQuery({
    queryKey: ["workflow-execution", scope, runId],
    enabled: !!runId,
    queryFn: () => api<{ data: Run }>(`/workflow-executions/${runId}`),
    refetchInterval: 5000,
  });
  const inbox = useQuery({
    queryKey: ["workflow-inbox", scope],
    queryFn: () =>
      api<{
        data: { id: string; title: string; kind: string; status: string }[];
      }>("/workflow-inbox"),
    refetchInterval: 10000,
  });
  const change = (next: Draft) => {
    setDraft(next);
    setDirty(true);
    setNotice("");
  };
  const request = async (action: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await action();
      await client.invalidateQueries({ queryKey: ["workflows", scope] });
      await client.invalidateQueries({ queryKey: ["workflow-history", scope] });
      await client.invalidateQueries({
        queryKey: ["workflow-execution", scope],
      });
      await client.invalidateQueries({ queryKey: ["workflow-inbox", scope] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    request(async () => {
      const parsed = workflowDraftSchema.safeParse({
        name: draft!.name,
        definition: draft!.definition,
      });
      if (!parsed.success)
        throw new Error(
          t("Revisa la configuración: %{value0}", {
            value0: parsed.error.issues.map((i) => i.message).join(". "),
          }),
        );
      const response = await api<{ data: Draft }>(
        draft!.id ? `/workflows/${draft!.id}` : "/workflows",
        draft!.id ? "PUT" : "POST",
        { ...parsed.data, ...(draft!.id ? { revision: draft!.revision } : {}) },
      );
      setDraft(response.data);
      setDirty(false);
      setNotice(t("Borrador guardado. Publica cuando esté listo."));
    });
  const choose = (next: Draft) => {
    manualAttempt.current = null;
    setDraft(next);
    setSelected(next.definition.nodes[0]?.id ?? "");
    setDirty(!next.id);
    setError("");
    setNotice("");
    setRunId(null);
    setManualData({});
  };
  const node = draft?.definition.nodes.find((n) => n.id === selected);
  const trigger = draft?.definition.trigger;
  const manualObject =
    trigger?.type === "manual"
      ? objects.find((o) => o.name === trigger.collection)
      : undefined;
  return (
    <section className="wf-root" aria-label={t("Flujos de trabajo")}>
      <header className="wf-toolbar">
        <div className="wf-title">
          <h2>
            {t("Flujos de trabajo")}
            {typeof list.data?.data.length === "number" &&
            list.data.data.length > 0 ? (
              <span className="wf-count">{list.data.data.length}</span>
            ) : null}
          </h2>
          <p className="wf-muted">
            {t("Conecta eventos, decisiones y acciones sobre tus colecciones.")}
          </p>
        </div>
        <Button disabled={busy || dirty} onClick={() => choose(fresh())}>
          <Plus size={16} />
          {t("Nuevo flujo")}
        </Button>
      </header>
      <WorkflowError
        error={error || errorText(list.error)}
        retryLabel={t("Reintentar")}
        onRetry={() => {
          setError("");
          void list.refetch();
        }}
      />
      {notice ? (
        <p role="status" className="wf-notice">
          {notice}
        </p>
      ) : null}
      {list.isPending ? (
        <p role="status" className="wf-muted">
          {t("Cargando flujos…")}
        </p>
      ) : null}
      {bundles.data?.data.length ? (
        <details className="wf-bundles">
          <summary>
            <Layers size={15} aria-hidden="true" />
            {t("Conectar colecciones con plantillas")}
            <span className="wf-count">{bundles.data.data.length}</span>
          </summary>
          <p className="wf-muted">
            {t(
              "Preparar añade relaciones y borradores. Revisa y publica cada flujo para activarlo. Los flujos existentes se conservan.",
            )}
          </p>
          {bundles.data.data.map((bundle) => (
            <article key={bundle.id} className="wf-bundle">
              <div className="wf-bundle-head">
                <h3>{bundle.label}</h3>
                {bundle.missing.length ? (
                  <span className="wf-badge wf-badge-warn">
                    {t("Faltan colecciones:")} {bundle.missing.join(", ")}
                  </span>
                ) : (
                  <span className="wf-badge wf-badge-muted">
                    {bundle.workflows.length
                      ? t("%{value0} flujos", {
                          value0: bundle.workflows.length,
                        })
                      : t("Solo relaciones")}
                  </span>
                )}
              </div>
              <p className="wf-muted">{bundle.description}</p>
              <Button
                variant="outline"
                disabled={busy || dirty || !!bundle.missing.length}
                onClick={() =>
                  request(async () => {
                    const result = await api<{ data: { workflows: Draft[] } }>(
                      `/workflow-bundles/${bundle.id}/prepare`,
                      "POST",
                    );
                    await Promise.all([
                      client.invalidateQueries({ queryKey: ["/api/objects"] }),
                      client.invalidateQueries({ queryKey: ["objects"] }),
                    ]);
                    setNotice(
                      result.data.workflows.length
                        ? t(
                            "Relaciones preparadas. Revisa los borradores y publica los que quieras activar.",
                          )
                        : t(
                            "Relaciones preparadas. Este paquete no añade flujos.",
                          ),
                    );
                  })
                }
              >
                {t("Preparar")} {bundle.label}
              </Button>
            </article>
          ))}
        </details>
      ) : null}
      {bundles.error ? (
        <WorkflowError
          error={
            errorText(bundles.error) ||
            t("No se pudieron cargar las plantillas.")
          }
          retryLabel={t("Reintentar")}
          onRetry={() => bundles.refetch()}
        />
      ) : null}
      <div className="wf-workspace">
        <aside className="wf-list" aria-label={t("Flujos guardados")}>
          <div className="wf-list-head">
            <span className="wf-list-title">{t("Flujos guardados")}</span>
            {typeof list.data?.data.length === "number" ? (
              <span className="wf-count">{list.data.data.length}</span>
            ) : null}
          </div>
          {list.isPending ? (
            <FlowListSkeleton label={t("Cargando flujos…")} />
          ) : null}
          {!list.isPending && !list.error && list.data?.data.length === 0 ? (
            <div className="wf-list-empty">
              <span className="wf-list-empty-icon" aria-hidden="true">
                <GitBranch size={18} />
              </span>
              <p>
                {t(
                  "Aún no hay flujos. Crea uno para definir cuándo se inicia y qué pasos ejecuta.",
                )}
              </p>
            </div>
          ) : null}
          {list.data?.data.map((flow) => {
            const active = draft?.id === flow.id;
            return (
              <button
                key={flow.id}
                disabled={busy || dirty}
                className="wf-list-item"
                aria-current={active ? "true" : undefined}
                onClick={() => choose(flow)}
              >
                <span className="wf-list-item-main">
                  <span className="wf-list-item-name">{flow.name}</span>
                  <span className="wf-list-item-meta">
                    <span
                      className={
                        flow.enabled
                          ? "wf-badge wf-badge-ok"
                          : "wf-badge wf-badge-muted"
                      }
                    >
                      {flow.enabled ? t("Activo") : t("Inactivo")}
                    </span>
                    <span className="wf-dot" aria-hidden="true">
                      ·
                    </span>
                    <span>
                      {flow.published_version ? t("publicado") : t("borrador")}{" "}
                      {flow.revision}
                    </span>
                  </span>
                </span>
                <ChevronRight
                  size={16}
                  className="wf-list-item-chevron"
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </aside>
        {draft ? (
          <div className="wf-detail">
            <div className="wf-toolbar">
              <label className="wf-name">
                {t("Nombre del flujo")}
                <Input
                  value={draft.name}
                  onChange={(e) => change({ ...draft, name: e.target.value })}
                />
              </label>
              <div className="wf-actions">
                <Button disabled={busy || !dirty} onClick={save}>
                  <Save size={16} />
                  {t("Guardar borrador")}
                </Button>
                {dirty ? (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      const saved = list.data?.data.find(
                        (f) => f.id === draft.id,
                      );
                      if (saved) choose(saved);
                      else {
                        setDraft(null);
                        setDirty(false);
                      }
                    }}
                  >
                    {t("Descartar cambios")}
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  disabled={busy || dirty || !draft.id}
                  onClick={() =>
                    request(async () => {
                      const result = await api<{ data: Draft }>(
                        `/workflows/${draft.id}/publish`,
                        "POST",
                        { revision: draft.revision },
                      );
                      setDraft(result.data);
                      setNotice(t("Versión publicada y activa."));
                    })
                  }
                >
                  {t("Publicar")}
                </Button>
                {draft.published_version ? (
                  <Button
                    variant="outline"
                    disabled={busy || dirty}
                    onClick={() =>
                      request(async () => {
                        const result = await api<{ data: Draft }>(
                          `/workflows/${draft.id}/enabled`,
                          "POST",
                          { enabled: !draft.enabled },
                        );
                        setDraft(result.data);
                      })
                    }
                  >
                    {draft.enabled ? t("Desactivar") : t("Activar")}
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="wf-statusline">
              <span
                className={
                  dirty ? "wf-badge wf-badge-warn" : "wf-badge wf-badge-muted"
                }
              >
                {dirty ? t("Cambios sin guardar") : t("Borrador guardado")}
              </span>
              <span
                className={
                  draft.enabled
                    ? "wf-badge wf-badge-ok"
                    : "wf-badge wf-badge-muted"
                }
              >
                {draft.enabled ? t("Versión publicada activa") : t("Inactivo")}
              </span>
              {draft.published_version ? (
                <span className="wf-badge wf-badge-muted">
                  {t("Publicado")}
                </span>
              ) : (
                <span className="wf-badge wf-badge-muted">
                  {t("Sin publicar")}
                </span>
              )}
            </div>
            <p className="wf-muted wf-status-hint">
              {t("Publicar no modifica las ejecuciones anteriores.")}
            </p>
            <TriggerEditor
              definition={draft.definition}
              objects={native}
              onChange={(definition) => change({ ...draft, definition })}
            />
            {draft.definition.trigger.type === "webhook" ? (
              draft.id ? (
                <WorkflowWebhookSettings key={draft.id} workflowId={draft.id} />
              ) : (
                <p className="wf-muted">
                  {t("Guarda el borrador para crear la URL del webhook.")}
                </p>
              )
            ) : null}
            {native.length < objects.length ? (
              <p className="wf-muted">
                {t("Las fuentes externas aún no admiten pasos de workflow.")}
              </p>
            ) : null}
            <div className="wf-editor">
              <div className="wf-canvas" aria-label={t("Secuencia de pasos")}>
                <ol>
                  {draft.definition.nodes.map((step, index) => (
                    <li key={step.id}>
                      <button
                        className="wf-step"
                        aria-pressed={selected === step.id}
                        onClick={() => setSelected(step.id)}
                      >
                        <span className="wf-step-number">{index + 1}</span>
                        <span>
                          <strong>
                            {step.label || t(stepLabels[step.type])}
                          </strong>
                          <small>
                            {step.type === "condition"
                              ? t("Sí → %{value0} · No → %{value1}", {
                                  value0: step.next ?? t("Fin"),
                                  value1: step.otherwise ?? t("Fin"),
                                })
                              : t("Siguiente → %{value0}", {
                                  value0: step.next ?? t("Fin"),
                                })}
                          </small>
                        </span>
                        {step.type === "condition" ? (
                          <GitBranch size={18} />
                        ) : null}
                      </button>
                      {index < draft.definition.nodes.length - 1 ? (
                        <ArrowDown
                          className="wf-connector"
                          size={18}
                          aria-hidden="true"
                        />
                      ) : null}
                    </li>
                  ))}
                </ol>
                <div className="wf-add">
                  <label>
                    {t("Tipo de paso")}
                    <select
                      value={kind}
                      onChange={(e) =>
                        setKind(e.target.value as WorkflowNode["type"])
                      }
                    >
                      {Object.entries(stepLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {t(label)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    variant="outline"
                    disabled={draft.definition.nodes.length >= 50}
                    onClick={() => {
                      let n = draft.definition.nodes.length + 1;
                      while (
                        draft.definition.nodes.some((s) => s.id === `step_${n}`)
                      )
                        n++;
                      const added = newStep(
                        kind,
                        `step_${n}`,
                        native[0]?.name ?? "",
                      );
                      const nodes = draft.definition.nodes.map((s, i) =>
                        i === draft.definition.nodes.length - 1 && !s.next
                          ? { ...s, next: added.id }
                          : s,
                      );
                      change({
                        ...draft,
                        definition: {
                          ...draft.definition,
                          nodes: [...nodes, added],
                        },
                      });
                      setSelected(added.id);
                    }}
                  >
                    <Plus size={16} />
                    {t("Añadir paso")}
                  </Button>
                </div>
              </div>
              <div>
                {node ? (
                  <>
                    <StepEditor
                      node={node}
                      definition={draft.definition}
                      objects={native}
                      onChange={(next) =>
                        change({
                          ...draft,
                          definition: {
                            ...draft.definition,
                            nodes: draft.definition.nodes.map((n) =>
                              n.id === node.id ? next : n,
                            ),
                          },
                        })
                      }
                    />
                    <Button
                      variant="ghost"
                      disabled={draft.definition.nodes.length === 1}
                      onClick={() => {
                        const nodes = draft.definition.nodes
                          .filter((n) => n.id !== node.id)
                          .map((n) => ({
                            ...n,
                            ...(n.next === node.id ? { next: node.next } : {}),
                            ...(n.type === "condition" &&
                            n.otherwise === node.id
                              ? { otherwise: node.next }
                              : {}),
                          }));
                        change({
                          ...draft,
                          definition: { ...draft.definition, nodes },
                        });
                        setSelected(nodes[0].id);
                      }}
                    >
                      {t("Quitar paso")}
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
            {draft.definition.trigger.type === "manual" ? (
              <section className="wf-manual">
                <h3>{t("Ejecución manual")}</h3>
                <p className="wf-muted">
                  {t(
                    "Ejecuta la versión publicada con estos datos de entrada.",
                  )}
                </p>
                {manualObject
                  ? fieldEntries(manualObject).map(([key, field]) => (
                      <ValueInput
                        key={key}
                        label={field.label}
                        value={manualData[key] ?? ""}
                        variables={[]}
                        onChange={(v) =>
                          setManualData({ ...manualData, [key]: v })
                        }
                      />
                    ))
                  : null}
                <Button
                  disabled={busy || dirty || !draft.enabled}
                  onClick={() =>
                    request(async () => {
                      const fingerprint = JSON.stringify([
                        draft.id,
                        draft.published_version,
                        manualData,
                      ]);
                      if (manualAttempt.current?.fingerprint !== fingerprint)
                        manualAttempt.current = {
                          fingerprint,
                          key: crypto.randomUUID(),
                        };
                      const result = await api<{ data: Run }>(
                        `/workflows/${draft.id}/start`,
                        "POST",
                        { data: manualData, key: manualAttempt.current.key },
                      );
                      manualAttempt.current = null;
                      setRunId(result.data.id);
                      setNotice(
                        t(
                          "Ejecución enviada. Consulta su estado en el historial.",
                        ),
                      );
                    })
                  }
                >
                  <Play size={16} />
                  {t("Ejecutar versión publicada")}
                </Button>
              </section>
            ) : null}
            {draft.id ? (
              <section className="wf-history">
                <div className="wf-section-head">
                  <h3>
                    <History size={15} aria-hidden="true" />
                    {t("Historial de ejecuciones")}
                  </h3>
                  {typeof history.data?.data.length === "number" &&
                  history.data.data.length > 0 ? (
                    <span className="wf-count">{history.data.data.length}</span>
                  ) : null}
                </div>
                <WorkflowError
                  error={errorText(history.error)}
                  retryLabel={t("Reintentar")}
                  onRetry={() => history.refetch()}
                />
                {history.isPending ? (
                  <div
                    className="wf-skeleton-list"
                    role="status"
                    aria-live="polite"
                  >
                    <span className="sr-only">{t("Cargando historial…")}</span>
                    {Array.from({ length: 3 }, (_, i) => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))}
                  </div>
                ) : null}
                {!history.isPending &&
                !history.error &&
                history.data?.data.length === 0 ? (
                  <p className="wf-muted">{t("No hay ejecuciones todavía.")}</p>
                ) : null}
                <ul className="wf-runs">
                  {history.data?.data.map((run) => (
                    <li key={run.id}>
                      <button
                        className="wf-run-item"
                        onClick={() => setRunId(run.id)}
                        aria-pressed={run.id === runId}
                      >
                        <span className={runBadgeClass(run.status)}>
                          {statuses[run.status] ?? run.status}
                        </span>
                        <small className="wf-run-meta">
                          {run.created_at} · {run.id.slice(0, 8)}
                        </small>
                      </button>
                    </li>
                  ))}
                </ul>
                <WorkflowError
                  error={errorText(detail.error)}
                  retryLabel={t("Reintentar")}
                  onRetry={() => detail.refetch()}
                />
                {detail.data ? (
                  <article className="wf-run">
                    <div className="wf-run-head">
                      <span className={runBadgeClass(detail.data.data.status)}>
                        {statuses[detail.data.data.status]}
                      </span>
                      <small className="wf-run-meta">
                        {t("Versión")} {detail.data.data.version_id}{" "}
                        {t("· Paso")}{" "}
                        {detail.data.data.node_id ?? t("finalizado")}
                      </small>
                    </div>
                    {detail.data.data.status === "waiting" &&
                    !!detail.data.data.wake_at ? (
                      <p className="wf-muted">
                        {t("Próximo intento o reanudación:")}{" "}
                        {new Date(detail.data.data.wake_at).toLocaleString(
                          intlLocale(locale),
                        )}
                      </p>
                    ) : null}
                    {detail.data.data.error ? (
                      <WorkflowError error={detail.data.data.error} />
                    ) : null}
                    {detail.data.data.deliveries?.map((attempt) => (
                      <p
                        key={`${attempt.node_id}:${attempt.sequence}`}
                        className="wf-delivery"
                      >
                        <span className="wf-delivery-node">
                          {attempt.node_id}
                        </span>
                        <span className="wf-muted">
                          {t("· Intento")} {attempt.sequence} ·{" "}
                          {attempt.status
                            ? t("HTTP %{value0}", { value0: attempt.status })
                            : attempt.finished_at
                              ? t("Sin respuesta")
                              : t("Envío en curso o resultado pendiente")}
                          {attempt.error ? ` · ${attempt.error}` : ""}
                        </span>
                      </p>
                    ))}
                    {detail.data.data.jobs?.map((job) => (
                      <details key={job.node_id}>
                        <summary>
                          {job.node_id} ·{" "}
                          {t(stepLabels[job.type as WorkflowNode["type"]])}{" "}
                          {t("· intentos")} {job.attempts}
                        </summary>
                        <pre>{JSON.stringify(job.output, null, 2)}</pre>
                      </details>
                    ))}
                    {["failed", "blocked"].includes(detail.data.data.status) ? (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          request(async () => {
                            await api(
                              `/workflow-executions/${runId}/retry`,
                              "POST",
                            );
                          })
                        }
                      >
                        {t("Reintentar ejecución")}
                      </Button>
                    ) : null}
                    {["queued", "running", "waiting"].includes(
                      detail.data.data.status,
                    ) ? (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          request(async () => {
                            await api(
                              `/workflow-executions/${runId}/cancel`,
                              "POST",
                            );
                          })
                        }
                      >
                        {t("Cancelar ejecución")}
                      </Button>
                    ) : null}
                  </article>
                ) : null}
              </section>
            ) : null}
          </div>
        ) : (
          <div className="wf-empty">
            <span className="wf-empty-icon" aria-hidden="true">
              <GitBranch size={28} />
            </span>
            <h3>{t("Un evento, una secuencia de pasos")}</h3>
            <p className="wf-muted">
              {t(
                "Selecciona un flujo o crea uno. Puedes consultar y cambiar registros, evaluar condiciones, crear tareas o enviar notificaciones internas.",
              )}
            </p>
            <Button disabled={busy} onClick={() => choose(fresh())}>
              <Plus size={16} />
              {t("Crear mi primer flujo")}
            </Button>
          </div>
        )}
      </div>
      <section className="wf-inbox">
        <div className="wf-section-head">
          <h3>
            <Inbox size={15} aria-hidden="true" />
            {t("Mis tareas y notificaciones")}
          </h3>
          {typeof inbox.data?.data.length === "number" &&
          inbox.data.data.length > 0 ? (
            <span className="wf-count">{inbox.data.data.length}</span>
          ) : null}
        </div>
        <p className="wf-muted">
          <a href="/notifications">{t("Abrir la bandeja de notificaciones")}</a>
        </p>
        <WorkflowError
          error={errorText(inbox.error)}
          retryLabel={t("Reintentar")}
          onRetry={() => inbox.refetch()}
        />
        {inbox.isPending ? (
          <div className="wf-skeleton-list" role="status" aria-live="polite">
            <span className="sr-only">{t("Cargando…")}</span>
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : null}
        {!inbox.isPending && !inbox.error && inbox.data?.data.length === 0 ? (
          <div className="wf-inbox-empty">
            <p className="wf-muted">
              {t("No tienes elementos asignados por los flujos.")}
            </p>
          </div>
        ) : null}
        <ul className="wf-inbox-list">
          {inbox.data?.data.map((item) => (
            <li key={item.id} className="wf-inbox-item">
              <span className="wf-inbox-main">
                <span className="wf-inbox-title">{item.title}</span>
                <span className="wf-inbox-meta">
                  <span className="wf-badge wf-badge-muted">
                    {item.kind === "task" ? t("Tarea") : t("Notificación")}
                  </span>
                  <span
                    className={
                      item.status === "done"
                        ? "wf-badge wf-badge-ok"
                        : "wf-badge wf-badge-warn"
                    }
                  >
                    {item.status === "done" ? t("Resuelta") : t("Pendiente")}
                  </span>
                </span>
              </span>
              {item.status !== "done" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    request(async () => {
                      await api(`/workflow-inbox/${item.id}/resolve`, "POST");
                    })
                  }
                >
                  {t("Resolver")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
