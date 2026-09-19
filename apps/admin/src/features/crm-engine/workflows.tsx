import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowDown, Plus, Play, Save, GitBranch } from "lucide-react";
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
  version_id: string;
  node_id: string | null;
  error?: string;
  created_at: string;
  jobs?: { node_id: string; type: string; output: unknown; attempts: number }[];
};
const fresh = (): Draft => ({
  name: "Nuevo flujo",
  revision: 0,
  enabled: 0,
  definition: {
    trigger: { type: "manual" },
    nodes: [newStep("transform", "step_1", "")],
  },
});
const statuses: Record<string, string> = {
  queued: "En cola",
  running: "En ejecución",
  waiting: "En espera",
  completed: "Completado",
  failed: "Fallido",
  blocked: "Sin permiso",
  cancelled: "Cancelado",
};
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
          `Revisa la configuración: ${parsed.error.issues.map((i) => i.message).join(". ")}`,
        );
      const response = await api<{ data: Draft }>(
        draft!.id ? `/workflows/${draft!.id}` : "/workflows",
        draft!.id ? "PUT" : "POST",
        { ...parsed.data, ...(draft!.id ? { revision: draft!.revision } : {}) },
      );
      setDraft(response.data);
      setDirty(false);
      setNotice("Borrador guardado. Publica cuando esté listo.");
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
    <section className="wf-root" aria-label="Flujos de trabajo">
      <header className="wf-toolbar">
        <div>
          <h2>Flujos de trabajo</h2>
          <p className="wf-muted">
            Conecta eventos, decisiones y acciones sobre tus colecciones.
          </p>
        </div>
        <Button disabled={busy || dirty} onClick={() => choose(fresh())}>
          <Plus size={16} />
          Nuevo flujo
        </Button>
      </header>
      {error || list.error ? (
        <p role="alert" className="wf-error">
          {error || String(list.error)}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {list.isPending ? <p role="status">Cargando flujos…</p> : null}
      {bundles.data?.data.length ? (
        <details className="wf-bundles">
          <summary>Conectar colecciones con plantillas</summary>
          <p>
            Preparar añade relaciones y borradores. Revisa y publica cada flujo
            para activarlo. Los flujos existentes se conservan.
          </p>
          {bundles.data.data.map((bundle) => (
            <article key={bundle.id}>
              <h3>{bundle.label}</h3>
              <p>{bundle.description}</p>
              {bundle.missing.length ? (
                <p>Faltan colecciones: {bundle.missing.join(", ")}</p>
              ) : null}
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
                        ? "Relaciones preparadas. Revisa los borradores y publica los que quieras activar."
                        : "Relaciones preparadas. Este paquete no añade flujos.",
                    );
                  })
                }
              >
                Preparar {bundle.label}
              </Button>
            </article>
          ))}
        </details>
      ) : null}
      {bundles.error ? (
        <p role="alert">
          No se pudieron cargar las plantillas.{" "}
          <button onClick={() => bundles.refetch()}>Reintentar</button>
        </p>
      ) : null}
      <div className="wf-workspace">
        <aside className="wf-list" aria-label="Flujos guardados">
          {list.data?.data.length === 0 ? (
            <p className="wf-muted">
              Aún no hay flujos. Crea uno para definir cuándo se inicia y qué
              pasos ejecuta.
            </p>
          ) : null}
          {list.data?.data.map((flow) => (
            <button
              key={flow.id}
              disabled={busy || dirty}
              aria-current={draft?.id === flow.id ? "true" : undefined}
              onClick={() => choose(flow)}
            >
              <span>{flow.name}</span>
              <small>
                {flow.enabled ? "Activo" : "Inactivo"} · borrador{" "}
                {flow.revision}
              </small>
            </button>
          ))}
        </aside>
        {draft ? (
          <div className="wf-detail">
            <div className="wf-toolbar">
              <label className="wf-name">
                Nombre del flujo
                <Input
                  value={draft.name}
                  onChange={(e) => change({ ...draft, name: e.target.value })}
                />
              </label>
              <div className="wf-actions">
                <Button disabled={busy || !dirty} onClick={save}>
                  <Save size={16} />
                  Guardar borrador
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
                    Descartar cambios
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
                      setNotice("Versión publicada y activa.");
                    })
                  }
                >
                  Publicar
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
                    {draft.enabled ? "Desactivar" : "Activar"}
                  </Button>
                ) : null}
              </div>
            </div>
            <p className="wf-muted">
              {dirty ? "Cambios sin guardar" : "Borrador guardado"} ·{" "}
              {draft.enabled ? "Versión publicada activa" : "Inactivo"}.
              Publicar no modifica las ejecuciones anteriores.
            </p>
            <TriggerEditor
              definition={draft.definition}
              objects={native}
              onChange={(definition) => change({ ...draft, definition })}
            />
            {native.length < objects.length ? (
              <p className="wf-muted">
                Las fuentes externas aún no admiten pasos de workflow.
              </p>
            ) : null}
            <div className="wf-editor">
              <div className="wf-canvas" aria-label="Secuencia de pasos">
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
                          <strong>{step.label || stepLabels[step.type]}</strong>
                          <small>
                            {step.type === "condition"
                              ? `Sí → ${step.next ?? "Fin"} · No → ${step.otherwise ?? "Fin"}`
                              : `Siguiente → ${step.next ?? "Fin"}`}
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
                    Tipo de paso
                    <select
                      value={kind}
                      onChange={(e) =>
                        setKind(e.target.value as WorkflowNode["type"])
                      }
                    >
                      {Object.entries(stepLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
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
                    Añadir paso
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
                      Quitar paso
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
            {draft.definition.trigger.type === "manual" ? (
              <section className="wf-manual">
                <h3>Ejecución manual</h3>
                <p className="wf-muted">
                  Ejecuta la versión publicada con estos datos de entrada.
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
                        "Ejecución enviada. Consulta su estado en el historial.",
                      );
                    })
                  }
                >
                  <Play size={16} />
                  Ejecutar versión publicada
                </Button>
              </section>
            ) : null}
            {draft.id ? (
              <section className="wf-history">
                <h3>Historial de ejecuciones</h3>
                {history.error ? (
                  <p role="alert">{String(history.error)}</p>
                ) : null}
                {history.data?.data.length === 0 ? (
                  <p className="wf-muted">No hay ejecuciones todavía.</p>
                ) : null}
                <ul>
                  {history.data?.data.map((run) => (
                    <li key={run.id}>
                      <button
                        onClick={() => setRunId(run.id)}
                        aria-pressed={run.id === runId}
                      >
                        <span>{statuses[run.status] ?? run.status}</span>
                        <small>
                          {run.created_at} · {run.id.slice(0, 8)}
                        </small>
                      </button>
                    </li>
                  ))}
                </ul>
                {detail.error ? (
                  <p role="alert">{String(detail.error)}</p>
                ) : null}
                {detail.data ? (
                  <article className="wf-run">
                    <h4>{statuses[detail.data.data.status]}</h4>
                    <p className="wf-muted">
                      Versión {detail.data.data.version_id} · Paso{" "}
                      {detail.data.data.node_id ?? "finalizado"}
                    </p>
                    {detail.data.data.error ? (
                      <p role="alert">{detail.data.data.error}</p>
                    ) : null}
                    {detail.data.data.jobs?.map((job) => (
                      <details key={job.node_id}>
                        <summary>
                          {job.node_id} ·{" "}
                          {stepLabels[job.type as WorkflowNode["type"]]} ·
                          intentos {job.attempts}
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
                        Reintentar ejecución
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
                        Cancelar ejecución
                      </Button>
                    ) : null}
                  </article>
                ) : null}
              </section>
            ) : null}
          </div>
        ) : (
          <div className="wf-empty">
            <GitBranch size={32} />
            <h3>Un evento, una secuencia de pasos</h3>
            <p>
              Selecciona un flujo o crea uno. Puedes consultar y cambiar
              registros, evaluar condiciones, crear tareas o enviar
              notificaciones internas.
            </p>
          </div>
        )}
      </div>
      <section className="wf-inbox">
        <h3>Mis tareas y notificaciones</h3>
        {inbox.error ? <p role="alert">{String(inbox.error)}</p> : null}
        {inbox.data?.data.length === 0 ? (
          <p className="wf-muted">
            No tienes elementos asignados por los flujos.
          </p>
        ) : null}
        <ul>
          {inbox.data?.data.map((item) => (
            <li key={item.id}>
              <span>
                {item.title}
                <small>
                  {item.kind === "task" ? "Tarea" : "Notificación"} ·{" "}
                  {item.status === "done" ? "Resuelta" : "Pendiente"}
                </small>
              </span>
              {item.status !== "done" ? (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    request(async () => {
                      await api(`/workflow-inbox/${item.id}/resolve`, "POST");
                    })
                  }
                >
                  Resolver
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
