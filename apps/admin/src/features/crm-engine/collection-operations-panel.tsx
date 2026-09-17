import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { api } from "./api";
import { getCrmRuntime } from "./runtime";
import {
  operationNames,
  endpointSchema,
  type OperationMap,
  type EndpointCandidate,
  type OperationEndpoint,
  type CollectionOperation,
} from "@savia/crm-shared/collection-operations";
const labels = {
  list: "Listar",
  read: "Consultar un registro",
  create: "Crear",
  update: "Editar",
  delete: "Eliminar",
};
type Settings = {
  version: number;
  kind: string;
  resource: string;
  fields: { key: string; label: string }[];
  operations: OperationMap;
  candidates: EndpointCandidate[];
};
export default function CollectionOperationsPanel({
  name,
  label,
  onClose,
}: {
  name: string;
  label: string;
  onClose: () => void;
}) {
  const runtime = getCrmRuntime();
  const query = useQuery({
    queryKey: [
      "collection-operations",
      runtime.apiBasePath,
      runtime.domainId,
      name,
    ],
    queryFn: () =>
      api<{ data: Settings }>(
        `/collection-bindings/${encodeURIComponent(name)}/operations`,
      ),
  });
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        style={{
          width: "min(720px,100vw)",
          maxWidth: "100vw",
          overflowY: "auto",
        }}
      >
        <SheetHeader>
          <SheetTitle>Operaciones · {label}</SheetTitle>
          <SheetDescription>
            Elige el endpoint para cada acción. Una acción sin endpoint queda
            deshabilitada en el CRM.
          </SheetDescription>
        </SheetHeader>
        <div style={{ padding: "0 24px 24px" }}>
          {query.isPending ? (
            <p>Cargando operaciones…</p>
          ) : query.error ? (
            <p role="alert">{query.error.message}</p>
          ) : (
            query.data && (
              <OperationForm
                key={query.data.data.version}
                name={name}
                settings={query.data.data}
                onSaved={onClose}
              />
            )
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
function OperationForm({
  name,
  settings,
  onSaved,
}: {
  name: string;
  settings: Settings;
  onSaved: () => void;
}) {
  const client = useQueryClient();
  const [map, setMap] = useState(settings.operations);
  const [advanced, setAdvanced] = useState<Record<string, string>>(
    Object.fromEntries(
      operationNames.map((a) => [
        a,
        JSON.stringify(
          settings.operations[a] ? extra(settings.operations[a]!) : {},
          null,
          2,
        ),
      ]),
    ),
  );
  const [candidates, setCandidates] = useState(settings.candidates);
  const [document, setDocument] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const base = `/collection-bindings/${encodeURIComponent(name)}/operations`;
  function choose(
    action: CollectionOperation,
    endpoint: OperationEndpoint | null,
  ) {
    setMap((m) => ({ ...m, [action]: endpoint }));
    setAdvanced((a) => ({
      ...a,
      [action]: JSON.stringify(endpoint ? extra(endpoint) : {}, null, 2),
    }));
  }
  return (
    <form
      className="space-y-5"
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        setBusy(true);
        try {
          const operations = Object.fromEntries(
            operationNames.map((action) => [
              action,
              map[action]
                ? endpointSchema.parse({
                    ...map[action],
                    ...JSON.parse(advanced[action]),
                  })
                : null,
            ]),
          );
          await api(base, "PUT", { version: settings.version, operations });
          await client.invalidateQueries();
          onSaved();
        } catch (e) {
          setError(e instanceof Error ? e.message : "No se pudo guardar.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <details className="rounded-md border p-3">
        <summary>Detectar endpoints desde OpenAPI</summary>
        <p className="text-sm text-muted-foreground">
          Pega el documento OpenAPI 3 en JSON o YAML. Detectar candidatos no
          ejecuta operaciones ni cambia la configuración guardada.
        </p>
        <Textarea
          aria-label="Documento OpenAPI"
          value={document}
          onChange={(e) => setDocument(e.target.value)}
          rows={6}
        />
        <Button
          type="button"
          variant="outline"
          disabled={busy || !document.trim()}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const result = await api<{ data: EndpointCandidate[] }>(
                base + "/infer",
                "POST",
                { document },
              );
              setCandidates(result.data);
              setNotice(
                `${result.data.length} endpoints disponibles. Selecciona cuál usar para cada acción.`,
              );
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "No se pudo leer OpenAPI.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Detectar endpoints
        </Button>
      </details>
      {notice && <p role="status">{notice}</p>}
      {settings.kind === "domain" && (
        <p className="text-sm text-muted-foreground">
          Selecciona una operación compatible o escribe su ruta registrada en
          Savia. Se conservan las validaciones y el formato de respuesta del
          adaptador.
        </p>
      )}
      {operationNames.map((action) => {
        const endpoint = map[action];
        return (
          <section key={action} className="rounded-lg border p-3 space-y-3">
            <label className="font-medium" htmlFor={`operation-${action}`}>
              {labels[action]}
            </label>
            <select
              id={`operation-${action}`}
              className="h-9 w-full rounded-md border bg-background px-2"
              value={endpoint ? "current" : ""}
              onChange={(e) => {
                if (e.target.value === "") choose(action, null);
                else if (e.target.value === "manual")
                  choose(
                    action,
                    endpointSchema.parse({
                      method:
                        action === "list" || action === "read"
                          ? "GET"
                          : action === "create"
                            ? "POST"
                            : action === "update"
                              ? "PATCH"
                              : "DELETE",
                      path:
                        (settings.kind === "domain"
                          ? (settings.operations.list?.path ??
                            settings.resource)
                          : settings.resource) +
                        (["read", "update", "delete"].includes(action)
                          ? "/{id}"
                          : ""),
                      format: settings.kind === "domain" ? "domain" : "json",
                    }),
                  );
                else if (e.target.value !== "current")
                  choose(action, candidates[Number(e.target.value)].endpoint);
              }}
            >
              <option value="">Sin configurar</option>
              {!endpoint && !candidates.some((c) => c.action === action) && (
                <p className="text-sm text-muted-foreground">
                  No se detectó un endpoint para esta acción. Puedes escribir
                  una ruta compatible; debe existir en el API antes de guardar.
                </p>
              )}
              {endpoint && (
                <option value="current">
                  {endpoint.method} {endpoint.path}
                </option>
              )}
              {candidates
                .filter(
                  (c) => settings.kind !== "domain" || c.action === action,
                )
                .map((c) => (
                  <option
                    key={c.endpoint.method + c.endpoint.path}
                    value={candidates.indexOf(c)}
                  >
                    {c.endpoint.method} {c.endpoint.path}
                    {c.action === action ? " · Sugerido" : ""}
                  </option>
                ))}
              <option value="manual">Configurar endpoint manualmente</option>
            </select>
            {!endpoint && !candidates.some((c) => c.action === action) && (
              <p className="text-sm text-muted-foreground">
                No se detectó un endpoint para esta acción. Puedes escribir una
                ruta compatible; debe existir en el API antes de guardar.
              </p>
            )}
            {endpoint && (
              <>
                <div
                  className="grid gap-2"
                  style={{ gridTemplateColumns: "110px 1fr" }}
                >
                  <label>
                    Método
                    <select
                      aria-label={`Método · ${labels[action]}`}
                      className="h-9 w-full rounded-md border bg-background"
                      value={endpoint.method}
                      onChange={(e) =>
                        setMap((m) => ({
                          ...m,
                          [action]: {
                            ...endpoint,
                            method: e.target
                              .value as OperationEndpoint["method"],
                          },
                        }))
                      }
                    >
                      {["GET", "POST", "PATCH", "PUT", "DELETE"].map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Ruta
                    <Input
                      aria-label={`Ruta · ${labels[action]}`}
                      value={endpoint.path}
                      onChange={(e) =>
                        setMap((m) => ({
                          ...m,
                          [action]: { ...endpoint, path: e.target.value },
                        }))
                      }
                    />
                  </label>
                </div>
                {settings.kind !== "domain" && (
                  <p className="text-sm text-muted-foreground">
                    Ruta relativa a la URL de la fuente. Usa {"{id}"} para el
                    identificador del registro.
                  </p>
                )}
                <details>
                  <summary>
                    {settings.kind === "domain"
                      ? "Mapeo de campos"
                      : "Campos, respuesta y paginación"}
                  </summary>
                  <p className="text-sm text-muted-foreground">
                    {settings.kind === "domain"
                      ? "requestFields relaciona cada campo del CRM con el parámetro del comando. El adaptador conserva la respuesta y la paginación del dominio."
                      : "requestFields mapea campos del CRM a parámetros del API. responseFields usa rutas JSON como /nombre. dataPointer localiza los registros, idPointer su identificador e idBodyField el parámetro de ID en comandos sin {id} en la ruta. pageParameter, sizeParameter y searchParameter nombran los parámetros de consulta."}
                  </p>
                  <Textarea
                    aria-label={`Mapeo · ${labels[action]}`}
                    value={advanced[action]}
                    onChange={(e) =>
                      setAdvanced((d) => ({ ...d, [action]: e.target.value }))
                    }
                    rows={10}
                  />
                </details>
              </>
            )}
          </section>
        );
      })}
      <details>
        <summary>Campos disponibles</summary>
        <ul>
          {settings.fields.map((f) => (
            <li key={f.key}>
              {f.label} · <code>{f.key}</code>
            </li>
          ))}
        </ul>
      </details>
      {error && <p role="alert">{error}</p>}
      <Button disabled={busy}>
        {busy ? "Guardando…" : "Guardar operaciones"}
      </Button>
    </form>
  );
}
function extra(endpoint: OperationEndpoint) {
  if (endpoint.format === "domain")
    return { requestFields: endpoint.requestFields };
  const { method, path, operationId, ...rest } = endpoint;
  return rest;
}
