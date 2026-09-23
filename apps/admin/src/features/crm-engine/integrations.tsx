import { ExternalErrorNotice } from "./external-error-notice";
import { useMessages, useAppLocale, intlLocale } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";
import { lazy, Suspense, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plug, Code2, ArrowUpRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { api } from "./api";
import { inspectDocument, type ApiOperation } from "@savia/crm-shared/openapi";
import { exampleOpenApi } from "@savia/crm-shared/seed";
import type { CrmObject } from "@savia/crm-shared/metadata";
import { FieldHelp } from "./field-help";
import "./integrations.css";
const DynamicForm = lazy(() => import("./dynamic-form"));
const defaultConnection = {
  mode: "demo",
  baseUrl: "",
  authType: "none",
  authHeader: "X-API-Key",
  supportsIdempotency: false,
};
export default function Integrations({
  onImported,
}: {
  onImported: (name: string) => void;
}) {
  const t = useMessages(automationMessages);
  const locale = useAppLocale();

  const [source, setSource] = useState(""),
    [sourceUrl, setSourceUrl] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [selected, setSelected] = useState<any>(null),
    [schema, setSchema] = useState(""),
    [objectName, setObjectName] = useState(""),
    [operation, setOperation] = useState<ApiOperation | null>(null);
  const [connection, setConnection] = useState<any>(defaultConnection),
    [secret, setSecret] = useState("");
  const queryClient = useQueryClient();
  const integrations = useQuery({
    queryKey: ["integrations"],
    queryFn: () => api("/integrations"),
  });
  const runs = useQuery({
    queryKey: ["integration-runs", selected?.id],
    queryFn: () => api(`/integrations/${selected.id}/runs`),
    enabled: !!selected,
  });
  const info = useMemo(
    () => (selected ? inspectDocument(selected.document) : null),
    [selected],
  );
  function choose(item: any) {
    setSelected(item);
    const doc = inspectDocument(item.document);
    setSchema(doc.schemas[0] ?? "");
    setObjectName((doc.schemas[0] ?? "").toLowerCase());
    setConnection({ ...defaultConnection, ...item.connection });
    setSecret("");
    setError("");
  }
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t("Integraciones")}</p>
          <div className="flex items-center gap-1.5">
            <h1>{t("De API a herramienta.")}</h1>
            <FieldHelp label={`${t("Integraciones")} (${t("Ayuda")})`}>
              {t(
                "Importa contratos, configura conexiones y convierte respuestas en registros.",
              )}
            </FieldHelp>
          </div>
        </div>
        <span className="neutral-badge">{t("OpenAPI 3.0 / 3.1")}</span>
      </div>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {integrations.error && (
        <p className="error-message" role="alert">
          {integrations.error.message}
        </p>
      )}
      <div className="integration-layout">
        <section className="integration-source">
          <h2>{t("Importa una API")}</h2>
          <p>{t("JSON o YAML, archivo de hasta 1 MB o URL pública HTTPS.")}</p>
          <div className="source-actions">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSource(JSON.stringify(exampleOpenApi, null, 2));
                setSourceUrl("");
              }}
            >
              <Code2 size={15} /> {t("Cargar ejemplo")}
            </Button>
            <label className="upload-button">
              {t("Cargar archivo")}
              <input
                type="file"
                aria-label={t("Cargar archivo OpenAPI")}
                accept=".json,.yaml,.yml"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 1024 * 1024) {
                    setError(t("El archivo supera 1 MB."));
                    return;
                  }
                  setSource(await f.text());
                  setSourceUrl("");
                }}
              />
            </label>
          </div>
          <Label htmlFor="contract-url">{t("URL del contrato")}</Label>
          <Input
            id="contract-url"
            type="url"
            placeholder={t("https://api.empresa.com/openapi.json")}
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
          />
          <textarea
            aria-label={t("Documento OpenAPI")}
            className="code-input"
            placeholder={t("openapi: 3.1.0")}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
          <Button
            disabled={busy || (!source.trim() && !sourceUrl.trim())}
            onClick={() =>
              act(async () => {
                const r = await api(
                  "/integrations",
                  "POST",
                  sourceUrl.trim()
                    ? { url: sourceUrl.trim() }
                    : { document: source },
                );
                choose(r.data);
                await integrations.refetch();
                toast.success(t("Contrato importado"));
              })
            }
          >
            <Plug size={16} />
            {busy ? t("Importando…") : t("Importar contrato")}
          </Button>
          <h3>{t("Contratos guardados")}</h3>
          {integrations.data?.data?.map((item: any) => (
            <button
              className="saved-integration"
              key={item.id}
              aria-pressed={selected?.id === item.id}
              onClick={() => choose(item)}
            >
              <Plug size={16} />
              {item.name}
            </button>
          ))}
          {!integrations.data?.data?.length && (
            <p>{t("Aún no has importado contratos.")}</p>
          )}
        </section>
        <section className="integration-detail">
          {info ? (
            <>
              <div className="connected-title">
                <span className="integration-symbol">
                  <Plug size={24} />
                </span>
                <div>
                  <span className="connected-label">
                    {t("Contrato guardado")}
                  </span>
                  <h2>{info.title}</h2>
                </div>
              </div>
              <h3>{t("Crear un objeto desde un esquema")}</h3>
              <p>
                {t(
                  "Los objetos anidados y arrays se editan como JSON con validación del contrato.",
                )}
              </p>
              <Label htmlFor="schema-select">{t("Esquema")}</Label>
              <select
                id="schema-select"
                className="select-input full-width"
                value={schema}
                onChange={(e) => {
                  setSchema(e.target.value);
                  setObjectName(e.target.value.toLowerCase());
                }}
              >
                {info.schemas.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <Label htmlFor="import-name">
                {t("Identificador del nuevo objeto")}
              </Label>
              <Input
                id="import-name"
                value={objectName}
                onChange={(e) => setObjectName(e.target.value)}
              />
              <Button
                className="form-submit"
                variant="outline"
                disabled={!schema || !objectName || busy}
                onClick={() =>
                  act(async () => {
                    await api(`/integrations/${selected.id}/import`, "POST", {
                      schema,
                      name: objectName,
                    });
                    await queryClient.invalidateQueries({
                      queryKey: ["objects"],
                    });
                    toast.success(t("Objeto creado"));
                    onImported(objectName);
                  })
                }
              >
                {t("Crear objeto")}
              </Button>
              <div className="connection-panel">
                <h3>{t("Conexión de ejecución")}</h3>
                <Label htmlFor="connection-mode">{t("Destino")}</Label>
                <select
                  id="connection-mode"
                  className="select-input full-width"
                  value={connection.mode}
                  onChange={(e) =>
                    setConnection({ ...connection, mode: e.target.value })
                  }
                >
                  <option value="demo">
                    {t("Cotizador local de demostración")}
                  </option>
                  <option value="external">
                    {t("Servicio externo HTTPS")}
                  </option>
                </select>
                {connection.mode === "external" && (
                  <>
                    <Label htmlFor="connection-url">{t("URL base")}</Label>
                    <Input
                      id="connection-url"
                      placeholder={t("https://api.empresa.com/v1")}
                      value={connection.baseUrl}
                      onChange={(e) =>
                        setConnection({
                          ...connection,
                          baseUrl: e.target.value,
                        })
                      }
                    />
                    <Label htmlFor="auth-type">{t("Credencial")}</Label>
                    <select
                      id="auth-type"
                      className="select-input full-width"
                      value={connection.authType}
                      onChange={(e) =>
                        setConnection({
                          ...connection,
                          authType: e.target.value,
                        })
                      }
                    >
                      <option value="none">{t("Sin credencial")}</option>
                      <option value="bearer">{t("Bearer token")}</option>
                      <option value="api-key">
                        {t("API key en cabecera")}
                      </option>
                    </select>
                    {connection.authType === "api-key" && (
                      <>
                        <Label htmlFor="auth-header">
                          {t("Nombre de cabecera")}
                        </Label>
                        <Input
                          id="auth-header"
                          value={connection.authHeader}
                          onChange={(e) =>
                            setConnection({
                              ...connection,
                              authHeader: e.target.value,
                            })
                          }
                        />
                      </>
                    )}
                    {connection.authType !== "none" && (
                      <>
                        <Label htmlFor="auth-secret">
                          {selected.hasSecret
                            ? t("Reemplazar credencial (opcional)")
                            : t("Credencial")}
                        </Label>
                        <Input
                          id="auth-secret"
                          type="password"
                          autoComplete="new-password"
                          value={secret}
                          onChange={(e) => setSecret(e.target.value)}
                        />
                        <small>
                          {t(
                            "Se cifra en el servidor. La credencial guardada no se devuelve al navegador.",
                          )}
                        </small>
                      </>
                    )}
                    <label className="integration-check">
                      <input
                        type="checkbox"
                        checked={connection.supportsIdempotency}
                        onChange={(e) =>
                          setConnection({
                            ...connection,
                            supportsIdempotency: e.target.checked,
                          })
                        }
                      />{" "}
                      {t(
                        "Este servicio garantiza idempotencia con la cabecera Idempotency-Key.",
                      )}
                    </label>
                  </>
                )}
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      const response = await api(
                        `/integrations/${selected.id}/connection`,
                        "PUT",
                        { ...connection, ...(secret ? { secret } : {}) },
                      );
                      setSelected({ ...selected, ...response.data });
                      setSecret("");
                      await integrations.refetch();
                      toast.success(t("Conexión guardada"));
                    })
                  }
                >
                  {t("Guardar conexión")}
                </Button>
                <p className="integration-hint">
                  {selected.connection?.mode
                    ? t(
                        "Conexión guardada. Los cambios requieren guardar de nuevo.",
                      )
                    : t("Guarda la conexión para habilitar la ejecución.")}
                </p>
              </div>
              <h3>{t("Operaciones")}</h3>
              {info.operations.map((op) => (
                <button
                  className="operation-row"
                  key={op.id}
                  disabled={!!op.error}
                  onClick={() => setOperation(op)}
                >
                  <span className="method-badge">{op.method}</span>
                  <span>
                    <strong>{op.summary}</strong>
                    <code>{op.path}</code>
                    {op.error && <small>{op.error}</small>}
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
              {!info.operations.length && (
                <p>{t("El contrato no define operaciones.")}</p>
              )}
              <details className="integration-support">
                <summary>{t("Compatibilidad y límites")}</summary>
                <p>
                  {t(
                    "Referencias locales, allOf, oneOf y anyOf; JSON anidado, parámetros escalares path/query/header y arrays query con form/explode. Cuerpos y respuestas JSON, conexión Bearer o API key. Sin OAuth, multipart, referencias externas ni esquemas cíclicos. Los esquemas con condicionales o keywords no soportadas se rechazan. Tiempo de espera: 10 s; respuesta: 1 MB. Las rutas y redirecciones internas están bloqueadas; se comprueba DNS público antes de llamar.",
                  )}
                </p>
                <p>
                  {t(
                    "GET admite un reintento. Escrituras solo reintentan cuando declaras que el proveedor soporta idempotencia. Un resultado desconocido requiere revisar el proveedor antes de intentar una nueva escritura.",
                  )}
                </p>
              </details>
            </>
          ) : (
            <div className="integration-empty">
              <Code2 size={36} />
              <h2>{t("Tu próxima herramienta empieza aquí")}</h2>
              <p>
                {t(
                  "Carga el ejemplo, guarda la conexión demo y ejecuta una cotización local.",
                )}
              </p>
            </div>
          )}
        </section>
      </div>
      {selected && (
        <section className="integration-runs">
          <div className="integration-runs-heading">
            <div>
              <h2>{t("Historial de ejecución")}</h2>
              <p>{t("Últimas 100 solicitudes de este contrato.")}</p>
            </div>
            <Button variant="outline" onClick={() => runs.refetch()}>
              <RefreshCw size={15} /> {t("Actualizar")}
            </Button>
          </div>
          {runs.error && <p role="alert">{runs.error.message}</p>}
          {runs.data?.data?.length ? (
            <div className="integration-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t("Operación")}</th>
                    <th>{t("Resultado")}</th>
                    <th>{t("HTTP")}</th>
                    <th>{t("Intentos")}</th>
                    <th>{t("Duración")}</th>
                    <th>{t("Fecha")}</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.data.data.map((r: any) => (
                    <tr key={r.id}>
                      <td>
                        {r.method} {r.operation_id}
                      </td>
                      <td>
                        {statusLabel(r.status, t)}
                        {r.error && <small>{r.error}</small>}
                      </td>
                      <td>{r.http_status ?? "—"}</td>
                      <td>{r.attempts}</td>
                      <td>
                        {r.duration_ms} {t("ms")}
                      </td>
                      <td>
                        {new Date(r.created_at).toLocaleString(
                          intlLocale(locale),
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>{t("Aún no hay ejecuciones.")}</p>
          )}
        </section>
      )}
      {operation && selected && (
        <Execution
          key={`${selected.id}:${operation.id}`}
          integration={selected}
          operation={operation}
          onClose={() => {
            setOperation(null);
            runs.refetch();
          }}
          onExecuted={() => runs.refetch()}
        />
      )}
    </>
  );
}
function statusLabel(
  status: string,
  t: ReturnType<typeof useMessages<typeof automationMessages>>,
) {
  return (
    (
      {
        succeeded: t("Correcta"),
        failed: t("Fallida"),
        unknown: t("Resultado desconocido"),
        running: t("En curso"),
        "invalid-response": t("Respuesta fuera de contrato"),
      } as Record<string, string>
    )[status] ?? status
  );
}
function Execution({
  integration,
  operation: op,
  onClose,
  onExecuted,
}: {
  integration: any;
  operation: ApiOperation;
  onClose: () => void;
  onExecuted: () => void;
}) {
  const t = useMessages(automationMessages);

  const [parameters, setParameters] = useState<Record<string, unknown>>({}),
    [rawBody, setRawBody] = useState("{}"),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<any>(null);
  const [key, setKey] = useState(() => crypto.randomUUID()),
    [target, setTarget] = useState(""),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [saved, setSaved] = useState(false);
  const objects = useQuery({
    queryKey: ["integration-target-objects"],
    queryFn: () => api("/objects"),
  });
  const targetObject: CrmObject | undefined = objects.data?.data?.find(
    (o: CrmObject) => o.name === target,
  );
  async function execute(body?: unknown) {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const params = Object.fromEntries(
        Object.entries(parameters).filter(([, v]) => v !== ""),
      );
      for (const p of op.parameters)
        if (
          p.schema.type === "array" &&
          typeof params[`${p.in}:${p.name}`] === "string"
        )
          params[`${p.in}:${p.name}`] = JSON.parse(
            params[`${p.in}:${p.name}`] as string,
          );
      const response = await api(
        `/integrations/${integration.id}/execute`,
        "POST",
        {
          operationId: op.id,
          parameters: params,
          ...(body !== undefined ? { body } : {}),
          confirmWrite: confirmed,
          idempotencyKey: key,
        },
      );
      setResult(response);
      onExecuted();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="record-dialog integration-execution">
        <DialogHeader>
          <DialogTitle>{op.summary}</DialogTitle>
          <DialogDescription>
            {op.method} {op.path} ·{" "}
            {integration.connection?.mode === "demo"
              ? t("Servicio local de demostración")
              : integration.connection?.baseUrl || t("Conexión sin guardar")}
          </DialogDescription>
        </DialogHeader>
        {op.parameters.map((p) => (
          <div className="integration-param" key={`${p.in}:${p.name}`}>
            <Label htmlFor={`param-${p.in}-${p.name}`}>
              {p.name}
              {p.required || p.in === "path" ? " *" : ""}{" "}
              <small>({p.in})</small>
            </Label>
            <Input
              id={`param-${p.in}-${p.name}`}
              placeholder={
                p.schema.type === "array"
                  ? t('["valor1", "valor2"]')
                  : (p.description ?? "")
              }
              value={String(parameters[`${p.in}:${p.name}`] ?? "")}
              onChange={(e) =>
                setParameters({
                  ...parameters,
                  [`${p.in}:${p.name}`]: e.target.value,
                })
              }
            />
          </div>
        ))}
        {op.method !== "GET" && (
          <label className="integration-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            {t(
              "Autorizo enviar esta solicitud de escritura a la conexión indicada.",
            )}
          </label>
        )}
        {!integration.connection?.mode && (
          <p role="alert">{t("Guarda primero una conexión.")}</p>
        )}
        <fieldset
          disabled={
            busy ||
            !integration.connection?.mode ||
            (op.method !== "GET" && !confirmed)
          }
          className="integration-execution-fields"
        >
          {op.object ? (
            <Suspense fallback={<p>{t("Cargando formulario…")}</p>}>
              <DynamicForm
                object={op.object}
                submitLabel={t("Ejecutar solicitud")}
                onSave={async (data) => {
                  const body = { ...data };
                  for (const [name, field] of Object.entries(
                    op.object!.config.fields,
                  )) {
                    if (body[name] === null || body[name] === "") {
                      if (!field.required) delete body[name];
                    } else if (
                      field.config?.jsonSchema &&
                      typeof body[name] === "string"
                    )
                      body[name] = JSON.parse(body[name] as string);
                  }
                  await execute(body);
                }}
              />
            </Suspense>
          ) : (
            <>
              {op.bodySchema && (
                <>
                  <Label htmlFor="request-json">
                    {t("Cuerpo JSON")} {op.bodyRequired ? "*" : ""}
                  </Label>
                  <textarea
                    id="request-json"
                    className="code-input"
                    value={rawBody}
                    onChange={(e) => setRawBody(e.target.value)}
                  />
                </>
              )}
              <Button
                onClick={async () => {
                  try {
                    await execute(
                      op.bodySchema && rawBody.trim()
                        ? JSON.parse(rawBody)
                        : undefined,
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {busy ? t("Ejecutando…") : t("Ejecutar solicitud")}
              </Button>
            </>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        {result && (
          <div className="operation-result">
            <h3>
              {statusLabel(result.run.status, t)} {t("· HTTP")}{" "}
              {result.run.httpStatus ?? "—"}
            </h3>
            <p>
              {result.run.attempts} {t("intento(s)")}
              {result.replayed
                ? t(" · respuesta recuperada por idempotencia")
                : ""}
            </p>
            {result.run.error && <ExternalErrorNotice error={{message:result.run.error, status:result.run.httpStatus}} />}
            <pre>{JSON.stringify(result.data, null, 2)}</pre>
            <Button
              variant="outline"
              onClick={() => {
                setKey(crypto.randomUUID());
                setResult(null);
                setConfirmed(false);
              }}
            >
              {t("Preparar una nueva solicitud")}
            </Button>
            {result.run.status === "succeeded" && (
              <div className="integration-mapping">
                <h3>{t("Guardar respuesta en Studio")}</h3>
                <Label htmlFor="response-target">
                  {t("Objeto de destino")}
                </Label>
                <select
                  id="response-target"
                  className="select-input full-width"
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    setMapping({});
                    setSaved(false);
                  }}
                >
                  <option value="">{t("Seleccionar objeto")}</option>
                  {objects.data?.data?.map((o: CrmObject) => (
                    <option key={o.name} value={o.name}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p>
                  {t(
                    "Relaciona cada campo con una ruta de la respuesta: /project, /monthlyTotal. Deja vacíos los campos que no quieras guardar.",
                  )}
                </p>
                {targetObject &&
                  Object.entries(targetObject.config.fields).map(
                    ([name, f]) => (
                      <div className="integration-mapping-row" key={name}>
                        <Label htmlFor={`mapping-${name}`}>
                          {f.label}
                          {f.required ? " *" : ""}
                        </Label>
                        <Input
                          id={`mapping-${name}`}
                          placeholder={`/${name}`}
                          value={mapping[name] ?? ""}
                          onChange={(e) =>
                            setMapping({ ...mapping, [name]: e.target.value })
                          }
                        />
                      </div>
                    ),
                  )}
                <Button
                  disabled={!target || busy || saved}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api(
                        `/integrations/${integration.id}/runs/${result.run.id}/save`,
                        "POST",
                        {
                          object: target,
                          mapping: Object.fromEntries(
                            Object.entries(mapping).filter(([, v]) => v.trim()),
                          ),
                        },
                      );
                      setSaved(true);
                      toast.success(t("Respuesta guardada como registro"));
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {saved ? t("Registro guardado") : t("Guardar registro")}
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
