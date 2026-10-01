import { useEffect, useState } from "react";
import type { ApiClient } from "@/api/api-client";
import type { MailContextReference } from "@savia/studio-shared/mail-contracts";
import type { TenantWorkspace } from "@/api/tenant-workspaces-client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  normalizeCollections,
  normalizeSchema,
  type ObjectsResponse,
} from "./data";
import { recordTitle } from "./summarize";
import type { WidgetRecord } from "./types";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
export const mailSelectClass = selectClass;
function useRead<T>(client: ApiClient, path: string | null) {
  const [state, setState] = useState<{
    path: string | null;
    client: ApiClient;
    data: T | null;
    error: boolean;
  }>({ path: null, client, data: null, error: false });
  useEffect(() => {
    if (!path) return;
    let active = true;
    const controller = new AbortController();
    void client.get<T>(path, { signal: controller.signal }).then(
      (data) => {
        if (active) setState({ path, client, data, error: false });
      },
      () => {
        if (active) setState({ path, client, data: null, error: true });
      },
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [client, path]);
  return state.path === path && state.client === client
    ? state
    : { data: null, error: false };
}
export function MailContextSelector({
  apiClient,
  onInsert,
}: {
  apiClient: ApiClient;
  onInsert: (value: { reference: MailContextReference; text: string }) => void;
}) {
  const [workspace, setWorkspace] = useState("");
  const [collection, setCollection] = useState("");
  const [recordId, setRecordId] = useState("");
  const [page, setPage] = useState(1);
  const [fields, setFields] = useState<string[]>([]);
  const tenants = useRead<{ data: TenantWorkspace[] }>(
    apiClient,
    "/v1/tenant-workspaces",
  );
  const metadata = useRead<ObjectsResponse>(
    apiClient,
    workspace ? `${workspace}/api/objects` : null,
  );
  const records = useRead<{ data: WidgetRecord[]; total?: number }>(
    apiClient,
    workspace && collection
      ? `${workspace}/api/records/${encodeURIComponent(collection)}?${new URLSearchParams({ page: String(page), perPage: "25", sort: "updated_at", order: "DESC" })}`
      : null,
  );
  const record = useRead<{ data: WidgetRecord }>(
    apiClient,
    workspace && collection && recordId
      ? `${workspace}/api/records/${encodeURIComponent(collection)}/${encodeURIComponent(recordId)}`
      : null,
  );
  const collections = metadata.data
    ? normalizeCollections(workspace, metadata.data)
    : [];
  const schema = metadata.data
    ? normalizeSchema(workspace, metadata.data, collection)
    : undefined;
  const readable =
    schema?.fields.filter(
      (field) =>
        record.data?.data && Object.hasOwn(record.data.data, field.name),
    ) ?? [];
  const chosen = readable.filter((field) => fields.includes(field.name));
  const valueText = (value: unknown): string => {
    const text =
      value === null || value === undefined
        ? "—"
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    return text.length > 1000 ? `${text.slice(0, 1000)}…` : text;
  };
  const preview = [
    schema?.label ?? collection,
    ...chosen.map(
      (field) => `${field.label}: ${valueText(record.data?.data[field.name])}`,
    ),
  ].join("\n");
  const failed =
    tenants.error || metadata.error || records.error || record.error;
  return (
    <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
      <p className="text-sm text-muted-foreground">
        Elige los campos que quieres compartir. Los datos se insertan al
        confirmar.
      </p>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          No pudimos leer este contexto. Revisa tus permisos o elige otro
          registro.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="mail-workspace">Espacio de datos</Label>
          <select
            id="mail-workspace"
            className={selectClass}
            value={workspace}
            onChange={(event) => {
              setWorkspace(event.target.value);
              setCollection("");
              setRecordId("");
              setFields([]);
              setPage(1);
            }}
          >
            <option value="">Elige un espacio</option>
            {tenants.data?.data.map((entry) => (
              <option key={entry.apiBasePath} value={entry.apiBasePath}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mail-collection">Colección de contexto</Label>
          <select
            id="mail-collection"
            className={selectClass}
            disabled={!workspace || !metadata.data}
            value={collection}
            onChange={(event) => {
              setCollection(event.target.value);
              setRecordId("");
              setFields([]);
              setPage(1);
            }}
          >
            <option value="">Elige una colección</option>
            {collections.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="mail-record">Registro de contexto</Label>
        <select
          id="mail-record"
          className={selectClass}
          disabled={!collection || !records.data}
          value={recordId}
          onChange={(event) => {
            setRecordId(event.target.value);
            setFields([]);
          }}
        >
          <option value="">Elige un registro</option>
          {records.data?.data.map((entry) => (
            <option key={String(entry.id)} value={String(entry.id)}>
              {recordTitle(entry, schema)}
            </option>
          ))}
        </select>
      </div>
      {collection ? (
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={page <= 1 || !records.data}
            aria-label="Página anterior"
            onClick={() => {
              setPage((value) => value - 1);
              setRecordId("");
              setFields([]);
            }}
          >
            Anterior
          </Button>
          <span className="text-xs text-muted-foreground">Página {page}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={
              !records.data ||
              (records.data.total === undefined
                ? records.data.data.length < 25
                : page * 25 >= records.data.total)
            }
            aria-label="Página siguiente"
            onClick={() => {
              setPage((value) => value + 1);
              setRecordId("");
              setFields([]);
            }}
          >
            Siguiente
          </Button>
        </div>
      ) : null}
      {recordId && !record.data && !record.error ? (
        <p role="status" className="text-sm text-muted-foreground">
          Cargando registro…
        </p>
      ) : null}
      {readable.length ? (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">
            Campos para compartir
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {readable.map((field) => (
              <label
                key={field.name}
                className="flex items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={fields.includes(field.name)}
                  onChange={(event) =>
                    setFields((previous) =>
                      event.target.checked
                        ? [...previous, field.name]
                        : previous.filter((name) => name !== field.name),
                    )
                  }
                />
                {field.label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {chosen.length ? (
        <pre
          className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-3 font-sans text-sm"
          aria-label="Vista previa del contexto"
        >
          {preview}
        </pre>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        disabled={!chosen.length || failed || chosen.length > 50}
        onClick={() =>
          onInsert({
            reference: {
              apiBasePath: workspace,
              collection,
              recordId,
              fields: chosen.map((field) => field.name),
            },
            text: preview,
          })
        }
      >
        Insertar contexto
      </Button>
    </div>
  );
}
