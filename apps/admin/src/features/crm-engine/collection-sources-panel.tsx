import { useMessages } from "@/i18n/core";
import { studioMessages } from "@/i18n/locales/studio";
import {
  databaseKinds,
  isDatabaseKind,
  type DatabaseKind,
} from "@savia/crm-shared/database-sources";
import { DatabaseSourceFields } from "./database-source-fields";
import CrmWorkspacePanel from "./crm-workspace-panel";
import CollectionOperationsPanel from "./collection-operations-panel";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle,
  ArrowUp,
  CheckCircle2,
  Database,
  Globe,
  Layers,
  Link2,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Unlink,
} from "lucide-react";
import { getCrmRuntime } from "./runtime";
import { fieldEntries, type CrmObject } from "@savia/crm-shared/metadata";
import type { CollectionCapabilities } from "./collection-capabilities";

type Source =
  | {
      id: string;
      label: string;
      kind: "jsonapi";
      baseUrl: string;
      hasToken: boolean;
    }
  | {
      id: string;
      label: string;
      kind: DatabaseKind;
      writeEnabled?: boolean;
      authSource?: string;
      encrypt?: boolean;
      trustServerCertificate?: boolean;
      host: string;
      port: number;
      database: string;
      username: string;
      schema: string;
      ssl: boolean;
      hasPassword: boolean;
    };
type CatalogEntry = {
  domain: string;
  collection: string;
  title: string;
  description?: string;
  capabilities: CollectionCapabilities;
};
type Binding = {
  name: string;
  label: string;
  sourceId: string;
  resource: string;
  kind: string;
};
type SourceInspection = {
  resourceType?: string;
  fields?: Record<string, unknown>;
  relationships?: Record<string, { type: string; multiple?: boolean }>;
  total?: number;
  hasNext?: boolean | null;
  tables?: Array<{ schema: string; table: string; kind: string }>;
  primaryKey?: string[];
};
const readOnly: CollectionCapabilities = {
  list: true,
  read: true,
  create: false,
  update: false,
  delete: false,
  schema: false,
  customFields: false,
};
function normalizedIdentifier(value: string) {
  const identifier = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const prefixed = /^[a-z]/.test(identifier)
    ? identifier
    : `screen_${identifier}`;
  return prefixed.slice(0, 48).replace(/_+$/g, "") || "screen";
}
function suggestScreenIdentifier(value: string, usedNames: string[]) {
  const base = normalizedIdentifier(value);
  for (let number = 1; ; number += 1) {
    const suffix = number === 1 ? "" : `_${number}`;
    const candidate = `${base.slice(0, 48 - suffix.length)}${suffix}`;
    if (!usedNames.includes(candidate)) return candidate;
  }
}
function useScopedRequest() {
  const t = useMessages(studioMessages);
  const [runtime] = useState(getCrmRuntime);
  return {
    scope: runtime.domainId ?? runtime.apiBasePath,
    request: async <T,>(
      path: string,
      method = "GET",
      body?: unknown,
    ): Promise<T> => {
      if (runtime.embedded && !runtime.transport)
        throw new Error(t("Abre el estudio desde Savia."));
      const response = await (runtime.transport ?? fetch)(`/api${path}`, {
        method,
        ...(body === undefined
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }),
      });
      const result = (await response.json()) as {
        data: T;
        error?: string;
        message?: string;
      };
      if (!response.ok)
        throw new Error(
          result.error ??
            result.message ??
            t("No se pudo completar la operación."),
        );
      return result.data;
    },
  };
}

export default function CollectionSourcesPanel({
  onBound,
}: {
  onBound: (object: Pick<CrmObject, "name" | "label">) => void | Promise<void>;
}) {
  const t = useMessages(studioMessages);
  const errorText = (error: unknown) =>
    error instanceof Error
      ? error.message
      : t("No se pudo completar la operación.");
  const { scope, request } = useScopedRequest();
  const client = useQueryClient();
  const sources = useQuery({
    queryKey: ["collection-sources", scope],
    queryFn: () => request<Source[]>("/sources"),
    retry: false,
  });
  const catalog = useQuery({
    queryKey: ["collection-catalog", scope],
    queryFn: () => request<CatalogEntry[]>("/collection-catalog"),
    retry: false,
  });
  const bindings = useQuery({
    queryKey: ["collection-bindings", scope],
    queryFn: () => request<Binding[]>("/collection-bindings"),
    retry: false,
  });
  const [operationBinding, setOperationBinding] = useState<Binding | null>(
    null,
  );
  const [activeSection, setActiveSection] = useState<"collections" | "sources">(
    "collections",
  );
  const [sourceOpen, setSourceOpen] = useState(false);
  const [editingSource, setEditingSource] = useState(false);
  const [removeToken, setRemoveToken] = useState(false);
  const [confirmRemoval, setConfirmRemoval] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceKind, setSourceKind] = useState<"jsonapi" | DatabaseKind>(
    "jsonapi",
  );
  const [baseUrl, setBaseUrl] = useState("");
  const tokenInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const [pgHost, setPgHost] = useState("");
  const [pgPort, setPgPort] = useState("5432");
  const [pgDatabase, setPgDatabase] = useState("");
  const [pgUsername, setPgUsername] = useState("");
  const [pgSchema, setPgSchema] = useState("public");
  const [pgSsl, setPgSsl] = useState(true);
  const [writeEnabled, setWriteEnabled] = useState(false);
  const [authSource, setAuthSource] = useState("admin");
  const [trustCertificate, setTrustCertificate] = useState(false);
  const [databaseIdColumn, setDatabaseIdColumn] = useState("");
  const [mongoIdType, setMongoIdType] = useState<"string" | "objectId">(
    "objectId",
  );
  const [removePassword, setRemovePassword] = useState(false);
  const [allowFilters, setAllowFilters] = useState(false);
  const [allowSort, setAllowSort] = useState(false);
  const [totalPointer, setTotalPointer] = useState("");
  const [mode, setMode] = useState<"domain" | "jsonapi" | DatabaseKind>(
    "domain",
  );
  const [selected, setSelected] = useState("");
  const [remoteSource, setRemoteSource] = useState("");
  const [resource, setResource] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [relationships, setRelationships] = useState("{}");
  const [name, setName] = useState("");
  const [nameIsManual, setNameIsManual] = useState(false);
  const [label, setLabel] = useState("");
  const [fields, setFields] = useState(
    '{\n  "name": {"type": "Textbox", "label": "Nombre"}\n}',
  );
  const [writes, setWrites] = useState({
    create: false,
    update: false,
    delete: false,
  });
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const suggestName = (value: string) => {
    if (nameIsManual) return;
    setName(
      suggestScreenIdentifier(
        value,
        (bindings.data ?? []).map((binding) => binding.name),
      ),
    );
  };
  function resetSourceForm() {
    setSourceOpen(false);
    setSourceId("");
    setSourceLabel("");
    setSourceKind("jsonapi");
    setBaseUrl("");
    setPgHost("");
    setPgPort("5432");
    setPgDatabase("");
    setPgUsername("");
    setPgSchema("public");
    setPgSsl(true);
    setWriteEnabled(false);
    setAuthSource("admin");
    setTrustCertificate(false);
    setRemoveToken(false);
    setRemovePassword(false);
  }
  async function saveSource(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const token = tokenInput.current?.value;
    if (tokenInput.current) tokenInput.current.value = "";
    const password = passwordInput.current?.value;
    if (passwordInput.current) passwordInput.current.value = "";
    try {
      if (editingSource) {
        const editing = sources.data?.find((item) => item.id === sourceId);
        await request<Source>(
          `/sources/${encodeURIComponent(sourceId)}`,
          "PUT",
          {
            label: sourceLabel,
            ...(editing?.kind !== "jsonapi" ? { writeEnabled } : {}),
            ...(editing?.kind !== "jsonapi"
              ? removePassword
                ? { password: null }
                : password
                  ? { password }
                  : {}
              : removeToken
                ? { token: null }
                : token
                  ? { token }
                  : {}),
          },
        );
      } else if (isDatabaseKind(sourceKind)) {
        const port = Number.parseInt(pgPort, 10);
        if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
          throw new Error(t("El puerto debe estar entre 1 y 65535."));
        await request<Source>("/sources", "POST", {
          id: sourceId,
          label: sourceLabel,
          kind: sourceKind,
          host: pgHost.trim(),
          port,
          database: pgDatabase.trim(),
          ...(pgUsername.trim() ? { username: pgUsername.trim() } : {}),
          ...((sourceKind === "postgres" || sourceKind === "mssql") &&
          pgSchema.trim()
            ? { schema: pgSchema.trim() }
            : {}),
          ...(sourceKind === "mssql"
            ? { encrypt: pgSsl, trustServerCertificate: trustCertificate }
            : { ssl: pgSsl }),
          ...(sourceKind === "mongodb" ? { authSource } : {}),
          writeEnabled,
          ...(password ? { password } : {}),
        });
      } else
        await request<Source>("/sources", "POST", {
          id: sourceId,
          label: sourceLabel,
          kind: "jsonapi",
          baseUrl,
          ...(token ? { token } : {}),
          options: {
            allowFilters,
            allowSort,
            ...(totalPointer ? { totalPointer } : {}),
          },
        });
      await client.invalidateQueries({
        queryKey: ["collection-sources", scope],
      });
      setRemoteSource(sourceId);
      resetSourceForm();
      setNotice(t("Fuente guardada. Ya puedes vincular una colección."));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function remove(path: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(path, "DELETE");
      setConfirmRemoval("");
      await client.invalidateQueries();
      setNotice(
        path.startsWith("/collection-bindings")
          ? t("Pantalla desvinculada. Los registros de la fuente se conservan.")
          : t("Fuente eliminada."),
      );
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function inspectSource() {
    if (inFlight.current || !remoteSource) return;
    const selectedSource = sources.data?.find(
      (item) => item.id === remoteSource,
    );
    const table = resource.trim();
    if (!table && !isDatabaseKind(selectedSource?.kind)) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const inspection = await request<SourceInspection>(
        `/sources/${encodeURIComponent(remoteSource)}/inspect`,
        "POST",
        {
          ...(table ? { resource: table } : {}),
          ...(resourceType.trim() && selectedSource?.kind === "jsonapi"
            ? { resourceType: resourceType.trim() }
            : {}),
        },
      );
      if (inspection.tables) {
        setNotice(
          inspection.tables.length
            ? t(
                "Tablas disponibles: %{v1}%{v2}. Escribe una tabla y vuelve a analizar.",
                {
                  v1: inspection.tables
                    .slice(0, 20)
                    .map((entry) => entry.table)
                    .join(", "),
                  v2: inspection.tables.length > 20 ? "…" : "",
                },
              )
            : t("El esquema no tiene tablas visibles para este usuario."),
        );
        return;
      }
      if (!inspection.fields)
        throw new Error(t("La fuente no devolvió columnas."));
      setFields(JSON.stringify(inspection.fields, null, 2));
      setRelationships(JSON.stringify(inspection.relationships ?? {}, null, 2));
      if (inspection.resourceType) setResourceType(inspection.resourceType);
      suggestName(table);
      if (inspection.primaryKey)
        setNotice(
          inspection.primaryKey.length
            ? t(
                "Columnas inferidas. Identificador: %{v1}. Las operaciones respetan los permisos de la fuente.",
                { v1: inspection.primaryKey.join(", ") },
              )
            : t(
                "Columnas inferidas. Selecciona una clave única para operar por registro; sin ella solo podrás listar.",
              ),
        );
      else
        setNotice(
          inspection.total !== undefined
            ? t(
                "Esquema inferido de 1 registro; la fuente informa %{v1} en total.",
                { v1: inspection.total },
              )
            : inspection.hasNext
              ? t(
                  "Esquema inferido de 1 registro; la fuente tiene más páginas.",
                )
              : t("Esquema inferido de 1 registro."),
        );
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function bind(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const entry = catalog.data?.find(
        (item) => `${item.domain}/${item.collection}` === selected,
      );
      let payload: Record<string, unknown>;
      if (mode === "domain") {
        if (!entry) throw new Error(t("Selecciona una colección del dominio."));
        payload = {
          name,
          label,
          domain: entry.domain,
          collection: entry.collection,
        };
      } else if (isDatabaseKind(mode)) {
        const parsed: unknown = JSON.parse(fields);
        if (
          !parsed ||
          typeof parsed !== "object" ||
          Array.isArray(parsed) ||
          !Object.keys(parsed).length
        )
          throw new Error(t("Analiza la tabla para obtener sus columnas."));
        if (!remoteSource)
          throw new Error(t("Selecciona una fuente Postgres."));
        if (!resource.trim()) throw new Error(t("Indica la tabla a vincular."));
        payload = {
          name,
          label,
          sourceId: remoteSource,
          resource: resource.trim(),
          fields: parsed,
          ...(databaseIdColumn ? { idColumn: databaseIdColumn } : {}),
          ...(mode === "mongodb" ? { idType: mongoIdType } : {}),
        };
      } else {
        const parsed: unknown = JSON.parse(fields);
        if (
          !parsed ||
          typeof parsed !== "object" ||
          Array.isArray(parsed) ||
          !Object.keys(parsed).length
        )
          throw new Error(t("Define al menos un campo en el objeto JSON."));
        const relationshipMap: unknown = relationships.trim()
          ? JSON.parse(relationships)
          : {};
        if (
          !relationshipMap ||
          typeof relationshipMap !== "object" ||
          Array.isArray(relationshipMap)
        )
          throw new Error(t("Las relaciones deben ser un objeto JSON."));
        payload = {
          name,
          label,
          sourceId: remoteSource,
          resource,
          ...(resourceType.trim() ? { resourceType: resourceType.trim() } : {}),
          ...(Object.keys(relationshipMap).length
            ? { relationships: relationshipMap }
            : {}),
          fields: parsed,
          capabilities: { ...readOnly, ...writes },
        };
      }
      const object = await request<CrmObject>(
        "/collection-bindings",
        "POST",
        payload,
      );
      await client.invalidateQueries({
        queryKey: ["collection-bindings", scope],
      });
      setNotice(t("Colección %{v1} vinculada.", { v1: object.label }));
      onBound(object);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const editingKind = editingSource
    ? (sources.data?.find((item) => item.id === sourceId)?.kind ?? "jsonapi")
    : sourceKind;
  const showPostgresFields = isDatabaseKind(editingKind);

  return (
    <section className="mx-auto grid w-full max-w-5xl gap-6 pb-12">
      <header className="flex flex-col gap-1 pb-2 border-b border-border/60">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs font-normal">
            {t("Dominio ·")} {scope ?? t("Plataforma")}
          </Badge>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("Fuentes y colecciones")}
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t(
            "Conecta una fuente, elige sus datos y crea una pantalla para trabajar con ellos.",
          )}
        </p>
      </header>

      {error && (
        <Alert variant="destructive" className="py-2.5">
          <AlertCircle className="size-4" />
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}

      {notice && (
        <Alert
          className="border-emerald-500/20 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 py-2.5"
          role="status"
        >
          <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
          <AlertDescription className="text-xs font-medium">
            {notice}
          </AlertDescription>
        </Alert>
      )}

      {[sources.error, catalog.error, bindings.error]
        .filter(Boolean)
        .map((cause, index) => (
          <Alert key={index} variant="destructive" className="py-2.5">
            <AlertCircle className="size-4" />
            <AlertDescription className="text-xs">
              {errorText(cause)}
            </AlertDescription>
          </Alert>
        ))}

      <CrmWorkspacePanel
        scope={scope}
        request={request}
        onInstalled={onBound}
      />

      <Tabs
        value={activeSection}
        onValueChange={(value) =>
          setActiveSection(value as "collections" | "sources")
        }
        className="gap-5"
      >
        <TabsList
          variant="line"
          aria-label={t("Secciones de fuentes y colecciones")}
          className="border-b border-border/80 w-full justify-start rounded-none px-0 pb-px"
        >
          <TabsTrigger
            value="collections"
            onClick={() => setActiveSection("collections")}
          >
            {t("Colecciones")}
          </TabsTrigger>
          <TabsTrigger
            value="sources"
            onClick={() => setActiveSection("sources")}
          >
            {t("Fuentes externas")}
          </TabsTrigger>
        </TabsList>

        {/* --- SOURCES TAB --- */}
        <TabsContent value="sources" className="mt-0 grid gap-6">
          <Card className="shadow-xs overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-foreground">
                  {t("Fuentes configuradas")}
                </h2>
                <CardDescription className="text-xs leading-relaxed">
                  {t(
                    "Conexiones a servicios web JSON:API y a bases de datos externas con permisos de lectura y escritura.",
                  )}
                </CardDescription>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-8"
                    aria-label={t("Nueva fuente externa")}
                    onClick={() => {
                      setEditingSource(false);
                      setRemoveToken(false);
                      setRemovePassword(false);
                      setSourceId("");
                      setSourceLabel("");
                      setSourceKind("jsonapi");
                      setBaseUrl("");
                      setPgHost("");
                      setPgPort("5432");
                      setPgDatabase("");
                      setPgUsername("");
                      setPgSchema("public");
                      setPgSsl(true);
                      setWriteEnabled(false);
                      setAuthSource("admin");
                      setTrustCertificate(false);
                      setSourceOpen(!sourceOpen);
                    }}
                  >
                    <Plus aria-hidden="true" className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>
                  {t("Nueva fuente externa")}
                </TooltipContent>
              </Tooltip>
            </CardHeader>

            {sourceOpen && (
              <div className="border-t border-b bg-muted/20 p-5">
                <form onSubmit={saveSource} className="grid gap-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">
                      {editingSource
                        ? t("Actualizar acceso a fuente")
                        : isDatabaseKind(sourceKind)
                          ? t("Conexión de base de datos")
                          : t("Conexión JSON:API")}
                    </h3>
                    <Badge variant="outline" className="text-xs">
                      {editingSource ? t("Edición") : t("Nueva")}
                    </Badge>
                  </div>

                  {!editingSource && (
                    <div className="grid gap-1.5 text-sm">
                      <Label htmlFor="source-kind-select">
                        {t("Tipo de fuente")}
                      </Label>
                      <select
                        id="source-kind-select"
                        aria-label={t("Tipo de fuente")}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none"
                        value={sourceKind}
                        onChange={(e) => {
                          const kind = e.target.value as
                            "jsonapi" | DatabaseKind;
                          setSourceKind(kind);
                          if (isDatabaseKind(kind)) {
                            setPgPort(String(databaseKinds[kind].port));
                            setPgSchema(databaseKinds[kind].schema);
                          }
                        }}
                      >
                        <option value="jsonapi">{t("Recurso JSON:API")}</option>
                        {Object.entries(databaseKinds).map(([kind, info]) => (
                          <option key={kind} value={kind}>
                            {t("Base")} {info.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-1.5 text-sm">
                      <Label htmlFor="source-id-input">
                        {t("Identificador de la fuente")}
                      </Label>
                      <Input
                        id="source-id-input"
                        required
                        pattern="[a-z][a-z0-9_]*"
                        disabled={editingSource}
                        value={sourceId}
                        onChange={(e) => setSourceId(e.target.value)}
                        placeholder="crm_externo"
                      />
                    </div>
                    <div className="grid gap-1.5 text-sm">
                      <Label htmlFor="source-label-input">
                        {t("Nombre de la fuente")}
                      </Label>
                      <Input
                        id="source-label-input"
                        required
                        value={sourceLabel}
                        onChange={(e) => setSourceLabel(e.target.value)}
                        placeholder={t("CRM externo")}
                      />
                    </div>
                  </div>

                  {!showPostgresFields && (
                    <>
                      <div className="grid gap-1.5 text-sm">
                        <Label htmlFor="source-url-input">
                          {t("URL base HTTPS")}
                        </Label>
                        <Input
                          id="source-url-input"
                          required
                          type="url"
                          pattern="https://.*"
                          disabled={editingSource}
                          value={baseUrl}
                          onChange={(e) => setBaseUrl(e.target.value)}
                          placeholder="https://api.example.com/v1"
                        />
                      </div>

                      <div className="grid gap-1.5 text-sm">
                        <Label htmlFor="source-token-input">
                          {t("Token de acceso (opcional)")}
                        </Label>
                        <Input
                          id="source-token-input"
                          ref={tokenInput}
                          type="password"
                          autoComplete="off"
                          placeholder="••••••••••••"
                        />
                        <p className="text-xs text-muted-foreground">
                          {t(
                            "El token se guarda cifrado en el servidor y no se devuelve en el catálogo.",
                          )}
                        </p>
                      </div>

                      {editingSource && (
                        <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                          <input
                            type="checkbox"
                            className="size-4 rounded border-input accent-primary"
                            checked={removeToken}
                            onChange={(event) =>
                              setRemoveToken(event.target.checked)
                            }
                          />
                          <span>{t("Quitar token de acceso")}</span>
                        </label>
                      )}

                      <div className="flex flex-wrap gap-4 text-xs font-medium pt-1">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            className="size-4 rounded border-input accent-primary"
                            disabled={editingSource}
                            checked={allowFilters}
                            onChange={(e) => setAllowFilters(e.target.checked)}
                          />
                          <span>
                            {t("La fuente admite filtros de igualdad")}
                          </span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            className="size-4 rounded border-input accent-primary"
                            disabled={editingSource}
                            checked={allowSort}
                            onChange={(e) => setAllowSort(e.target.checked)}
                          />
                          <span>{t("La fuente admite ordenación")}</span>
                        </label>
                      </div>

                      <div className="grid gap-1.5 text-sm">
                        <Label htmlFor="source-pointer-input">
                          {t("Ruta JSON del total (opcional)")}
                        </Label>
                        <Input
                          id="source-pointer-input"
                          disabled={editingSource}
                          value={totalPointer}
                          onChange={(e) => setTotalPointer(e.target.value)}
                          placeholder="/meta/total"
                        />
                      </div>
                    </>
                  )}

                  {showPostgresFields && isDatabaseKind(editingKind) && (
                    <DatabaseSourceFields
                      kind={editingKind}
                      editing={editingSource}
                      passwordRef={passwordInput}
                      removePassword={removePassword}
                      onRemovePassword={setRemovePassword}
                      draft={{
                        host: pgHost,
                        port: pgPort,
                        database: pgDatabase,
                        username: pgUsername,
                        schema: pgSchema,
                        ssl: pgSsl,
                        writeEnabled,
                        authSource,
                        trustServerCertificate: trustCertificate,
                      }}
                      onChange={(patch) => {
                        if (patch.host !== undefined) setPgHost(patch.host);
                        if (patch.port !== undefined) setPgPort(patch.port);
                        if (patch.database !== undefined)
                          setPgDatabase(patch.database);
                        if (patch.username !== undefined)
                          setPgUsername(patch.username);
                        if (patch.schema !== undefined)
                          setPgSchema(patch.schema);
                        if (patch.ssl !== undefined) setPgSsl(patch.ssl);
                        if (patch.writeEnabled !== undefined)
                          setWriteEnabled(patch.writeEnabled);
                        if (patch.authSource !== undefined)
                          setAuthSource(patch.authSource);
                        if (patch.trustServerCertificate !== undefined)
                          setTrustCertificate(patch.trustServerCertificate);
                      }}
                    />
                  )}

                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSourceOpen(false)}
                    >
                      {t("Cancelar")}
                    </Button>
                    <Button type="submit" size="sm" disabled={busy}>
                      {busy ? t("Guardando…") : t("Guardar fuente")}
                    </Button>
                  </div>
                </form>
              </div>
            )}

            <CardContent className="p-5">
              {sources.isPending ? (
                <div
                  className="space-y-3"
                  role="status"
                  aria-live="polite"
                  aria-label={t("Cargando fuentes…")}
                >
                  <p className="sr-only">{t("Cargando fuentes…")}</p>
                  <div className="divide-y rounded-lg border bg-card">
                    {Array.from({ length: 2 }, (_, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between p-3.5"
                      >
                        <div className="space-y-1.5">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-3 w-56" />
                        </div>
                        <Skeleton className="h-8 w-24 rounded-md" />
                      </div>
                    ))}
                  </div>
                </div>
              ) : sources.data?.length ? (
                <ul className="divide-y rounded-lg border bg-card">
                  {sources.data.map((source) => (
                    <li
                      key={source.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 transition-colors hover:bg-muted/30"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <strong className="text-sm font-medium text-foreground">
                            {source.label}
                          </strong>
                          <Badge
                            variant="outline"
                            className="text-xs font-normal"
                          >
                            {source.kind !== "jsonapi"
                              ? databaseKinds[source.kind].label
                              : "JSON:API"}
                          </Badge>
                          <Badge
                            variant={
                              source.kind !== "jsonapi"
                                ? source.hasPassword
                                  ? "secondary"
                                  : "outline"
                                : source.hasToken
                                  ? "secondary"
                                  : "outline"
                            }
                            className="text-xs font-normal"
                          >
                            {source.kind !== "jsonapi"
                              ? source.hasPassword
                                ? t("Con contraseña")
                                : t("Sin contraseña")
                              : source.hasToken
                                ? t("Con autenticación")
                                : t("Sin token")}
                          </Badge>
                        </div>
                        <p className="break-all text-xs text-muted-foreground font-mono">
                          {source.kind !== "jsonapi"
                            ? `${source.host}:${source.port}/${source.database}${source.schema ? ` · ${source.schema}` : ""}`
                            : source.baseUrl}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {source.kind !== "jsonapi" && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              setError("");
                              try {
                                await request(
                                  `/sources/${encodeURIComponent(source.id)}/test`,
                                  "POST",
                                  {},
                                );
                                setNotice(t("Conexión verificada."));
                              } catch (e) {
                                setError(errorText(e));
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            {t("Probar conexión")}
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (tokenInput.current)
                              tokenInput.current.value = "";
                            if (passwordInput.current)
                              passwordInput.current.value = "";
                            setEditingSource(true);
                            setRemoveToken(false);
                            setRemovePassword(false);
                            setSourceId(source.id);
                            setSourceLabel(source.label);
                            setSourceKind(source.kind);
                            if (source.kind !== "jsonapi") {
                              setPgHost(source.host);
                              setPgPort(String(source.port));
                              setPgDatabase(source.database);
                              setPgUsername(source.username);
                              setPgSchema(source.schema ?? "");
                              setWriteEnabled(Boolean(source.writeEnabled));
                              setAuthSource(source.authSource ?? "admin");
                              setTrustCertificate(
                                Boolean(source.trustServerCertificate),
                              );
                              setPgSsl(
                                source.kind === "mssql"
                                  ? source.encrypt !== false
                                  : source.ssl !== false,
                              );
                            } else {
                              setBaseUrl(source.baseUrl);
                            }
                            setSourceOpen(true);
                          }}
                        >
                          {t("Actualizar acceso")}
                        </Button>
                        {!bindings.data?.some(
                          (binding) => binding.sourceId === source.id,
                        ) && (
                          <Button
                            type="button"
                            size="sm"
                            variant={
                              confirmRemoval === `source:${source.id}`
                                ? "destructive"
                                : "ghost"
                            }
                            disabled={busy}
                            onClick={() =>
                              confirmRemoval === `source:${source.id}`
                                ? void remove(
                                    `/sources/${encodeURIComponent(source.id)}`,
                                  )
                                : setConfirmRemoval(`source:${source.id}`)
                            }
                          >
                            {confirmRemoval === `source:${source.id}`
                              ? t("Confirmar eliminación de fuente")
                              : t("Eliminar fuente")}
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 p-8 text-center">
                  <Database className="size-8 text-muted-foreground/60 mb-2" />
                  <p className="text-sm font-medium text-foreground">
                    {t("Sin fuentes externas")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-md">
                    {t(
                      "Las colecciones existentes están disponibles sin configurar una fuente externa.",
                    )}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- COLLECTIONS TAB --- */}
        <TabsContent value="collections" className="mt-0 grid gap-6">
          <Card className="shadow-xs overflow-hidden">
            <CardHeader className="pb-4 border-b">
              <CardTitle className="text-base font-semibold">
                {t("Vincular colección a una pantalla")}
              </CardTitle>
              <CardDescription className="text-xs leading-relaxed">
                {t(
                  "Asocia una colección del catálogo de dominio, un recurso JSON:API o una tabla o colección de base de datos para generar vistas de CRM.",
                )}
              </CardDescription>
            </CardHeader>

            <form onSubmit={bind}>
              <CardContent className="space-y-4 pt-5">
                <div className="grid gap-1.5 text-sm">
                  <Label htmlFor="binding-mode-select">{t("Origen")}</Label>
                  <select
                    id="binding-mode-select"
                    aria-label={t("Origen")}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none"
                    value={mode}
                    onChange={(e) =>
                      setMode(
                        e.target.value as "domain" | "jsonapi" | DatabaseKind,
                      )
                    }
                  >
                    <option value="domain">
                      {t("Colección existente del dominio")}
                    </option>
                    <option value="jsonapi">
                      {t("Recurso JSON:API externo")}
                    </option>
                    {Object.entries(databaseKinds).map(([kind, info]) => (
                      <option key={kind} value={kind}>
                        {t("Base")} {info.label}
                      </option>
                    ))}
                  </select>
                </div>

                {mode === "domain" ? (
                  <div className="grid gap-1.5 text-sm">
                    <Label htmlFor="collection-catalog-select">
                      {t("Colección")}
                    </Label>
                    <select
                      id="collection-catalog-select"
                      required
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none"
                      aria-label={t("Colección")}
                      value={selected}
                      onChange={(e) => {
                        setSelected(e.target.value);
                        const entry = catalog.data?.find(
                          (item) =>
                            `${item.domain}/${item.collection}` ===
                            e.target.value,
                        );
                        if (entry) {
                          setLabel(entry.title);
                          suggestName(entry.title);
                        }
                      }}
                    >
                      <option value="">{t("Selecciona una colección")}</option>
                      {catalog.data?.map((entry) => (
                        <option
                          key={`${entry.domain}/${entry.collection}`}
                          value={`${entry.domain}/${entry.collection}`}
                        >
                          {entry.title} · {entry.domain}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-muted-foreground">
                      {t(
                        "La pantalla respetará las operaciones disponibles en esta colección.",
                      )}
                    </span>
                  </div>
                ) : (
                  <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
                    <div className="grid gap-1.5 text-sm">
                      <Label htmlFor="jsonapi-source-select">
                        {t("Fuente")}
                      </Label>
                      <select
                        id="jsonapi-source-select"
                        required
                        aria-label={t("Fuente")}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none"
                        value={remoteSource}
                        onChange={(e) => setRemoteSource(e.target.value)}
                      >
                        <option value="">{t("Selecciona una fuente")}</option>
                        {sources.data
                          ?.filter((source) =>
                            isDatabaseKind(mode)
                              ? source.kind === mode
                              : source.kind === "jsonapi",
                          )
                          .map((source) => (
                            <option key={source.id} value={source.id}>
                              {source.label}
                            </option>
                          ))}
                      </select>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                      <div className="grid gap-1.5 text-sm">
                        <Label htmlFor="remote-resource-input">
                          {isDatabaseKind(mode)
                            ? t("Tabla (vacío para listar)")
                            : t("Recurso remoto")}
                        </Label>
                        <Input
                          id="remote-resource-input"
                          aria-label={
                            isDatabaseKind(mode)
                              ? t("Tabla (vacío para listar)")
                              : t("Recurso remoto")
                          }
                          required={!isDatabaseKind(mode)}
                          value={resource}
                          onChange={(e) => {
                            setResource(e.target.value);
                            suggestName(e.target.value);
                          }}
                          placeholder={
                            isDatabaseKind(mode) ? "orders" : "contacts"
                          }
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={
                          busy ||
                          !remoteSource ||
                          (!isDatabaseKind(mode) && !resource.trim())
                        }
                        onClick={() => void inspectSource()}
                      >
                        <Search className="size-3.5 mr-1.5" />
                        {busy
                          ? t("Analizando…")
                          : isDatabaseKind(mode)
                            ? t("Analizar tabla")
                            : t("Analizar recurso")}
                      </Button>
                    </div>

                    {mode === "jsonapi" && (
                      <div className="grid gap-1.5 text-sm">
                        <Label htmlFor="resource-type-input">
                          {t("Tipo de recurso JSON:API (opcional)")}
                        </Label>
                        <Input
                          id="resource-type-input"
                          aria-label={t("Tipo de recurso JSON:API (opcional)")}
                          value={resourceType}
                          onChange={(event) =>
                            setResourceType(event.target.value)
                          }
                          placeholder="contacts"
                        />
                      </div>
                    )}

                    <div className="grid gap-1.5 text-sm">
                      <Label htmlFor="fields-textarea">
                        {t("Campos de la colección (JSON)")}
                      </Label>
                      <Textarea
                        id="fields-textarea"
                        aria-label={t("Campos de la colección (JSON)")}
                        required
                        rows={6}
                        className="font-mono text-xs bg-background"
                        value={fields}
                        onChange={(e) => setFields(e.target.value)}
                      />
                    </div>

                    {isDatabaseKind(mode) && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="grid gap-1.5">
                          <Label htmlFor="database-id-column">
                            {t("Identificador único (opcional)")}
                          </Label>
                          <Input
                            id="database-id-column"
                            value={databaseIdColumn}
                            onChange={(e) =>
                              setDatabaseIdColumn(e.target.value)
                            }
                            placeholder={
                              mode === "mongodb" ? "_id" : t("Clave primaria")
                            }
                          />
                        </div>
                        {mode === "mongodb" && (
                          <div className="grid gap-1.5">
                            <Label htmlFor="mongodb-id-type">
                              {t("Tipo de identificador")}
                            </Label>
                            <select
                              id="mongodb-id-type"
                              className="h-9 rounded-md border bg-background px-3"
                              value={mongoIdType}
                              onChange={(e) =>
                                setMongoIdType(
                                  e.target.value as "string" | "objectId",
                                )
                              }
                            >
                              <option value="objectId">ObjectId</option>
                              <option value="string">{t("Texto")}</option>
                            </select>
                          </div>
                        )}
                      </div>
                    )}
                    {isDatabaseKind(mode) ? (
                      <p className="text-xs text-muted-foreground">
                        {t(
                          "Las operaciones dependen del identificador único y de los permisos de escritura de la fuente. Las vistas son de solo lectura.",
                        )}
                      </p>
                    ) : (
                      <div className="grid gap-1.5 text-sm">
                        <Label htmlFor="relationships-textarea">
                          {t("Relaciones JSON:API (JSON)")}
                        </Label>
                        <Textarea
                          id="relationships-textarea"
                          aria-label={t("Relaciones JSON:API (JSON)")}
                          rows={3}
                          className="font-mono text-xs bg-background"
                          value={relationships}
                          onChange={(event) =>
                            setRelationships(event.target.value)
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          {t(
                            "Relaciona un campo de identificadores con su tipo remoto; por ejemplo:",
                          )}{" "}
                          <code>{`{"company_id":{"type":"companies"}}`}</code>
                          {t(
                            ". Usa multiple: true para varios identificadores.",
                          )}
                        </p>
                      </div>
                    )}

                    {mode === "jsonapi" && (
                      <fieldset className="grid gap-2 border-t pt-3">
                        <legend className="text-xs font-medium text-foreground">
                          {t(
                            "Operaciones de escritura admitidas por la fuente",
                          )}
                        </legend>
                        <p className="text-xs text-muted-foreground">
                          {t(
                            "Lectura habilitada. Activa únicamente las operaciones que soporte el recurso remoto.",
                          )}
                        </p>
                        <div className="flex flex-wrap gap-4 text-xs font-medium pt-1">
                          {(
                            [
                              ["create", t("Crear")],
                              ["update", t("Editar")],
                              ["delete", t("Eliminar")],
                            ] as const
                          ).map(([key, title]) => (
                            <label
                              key={key}
                              className="flex items-center gap-2 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                aria-label={title}
                                className="size-4 rounded border-input accent-primary"
                                checked={writes[key]}
                                onChange={(e) =>
                                  setWrites((previous) => ({
                                    ...previous,
                                    [key]: e.target.checked,
                                  }))
                                }
                              />
                              <span>{title}</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    )}
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2 pt-2">
                  <div className="grid gap-1.5 text-sm">
                    <Label htmlFor="screen-name-input">
                      {t("Identificador de la pantalla")}
                    </Label>
                    <Input
                      id="screen-name-input"
                      aria-label={t("Identificador de la pantalla")}
                      required
                      pattern="[a-z][a-z0-9_]*"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setNameIsManual(true);
                      }}
                      placeholder="contactos_externos"
                    />
                    <span className="text-xs text-muted-foreground">
                      {nameIsManual
                        ? t("Identificador personalizado.")
                        : t("Se propone automáticamente y puedes editarlo.")}
                    </span>
                  </div>

                  <div className="grid gap-1.5 text-sm">
                    <Label htmlFor="screen-label-input">
                      {t("Nombre de la pantalla")}
                    </Label>
                    <Input
                      id="screen-label-input"
                      aria-label={t("Nombre de la pantalla")}
                      required
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder={t("Contactos")}
                    />
                  </div>
                </div>
              </CardContent>

              <CardFooter className="border-t bg-muted/20 py-3 flex justify-end">
                <Button type="submit" disabled={busy}>
                  <Link2 className="size-3.5 mr-1.5" />
                  {busy ? t("Vinculando…") : t("Vincular colección")}
                </Button>
              </CardFooter>
            </form>
          </Card>

          {/* Connected Collections List */}
          <Card className="shadow-xs overflow-hidden">
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-semibold">
                {t("Colecciones vinculadas")}
              </CardTitle>
              <CardDescription className="text-xs leading-relaxed">
                {t(
                  "Pantallas disponibles en este dominio con su origen de datos.",
                )}
              </CardDescription>
            </CardHeader>

            <CardContent className="p-5 pt-0">
              {bindings.isPending ? (
                <div
                  className="space-y-3"
                  role="status"
                  aria-live="polite"
                  aria-label={t("Cargando colecciones…")}
                >
                  <p className="sr-only">{t("Cargando colecciones…")}</p>
                  <div className="divide-y rounded-lg border bg-card">
                    {Array.from({ length: 3 }, (_, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between p-3.5"
                      >
                        <div className="space-y-1.5">
                          <Skeleton className="h-4 w-36" />
                          <Skeleton className="h-3 w-48" />
                        </div>
                        <Skeleton className="h-8 w-28 rounded-md" />
                      </div>
                    ))}
                  </div>
                </div>
              ) : bindings.data?.length ? (
                <ul className="divide-y rounded-lg border bg-card">
                  {bindings.data.map((binding) => (
                    <li
                      key={binding.name}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 transition-colors hover:bg-muted/30"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <strong className="text-sm font-medium text-foreground">
                            {binding.label}
                          </strong>
                          <Badge
                            variant={
                              binding.kind === "domain"
                                ? "secondary"
                                : "outline"
                            }
                            className="text-xs font-normal"
                          >
                            {binding.kind === "domain"
                              ? t("Dominio")
                              : binding.kind === "crm"
                                ? "HubSpot"
                                : isDatabaseKind(binding.kind)
                                  ? databaseKinds[binding.kind].label
                                  : binding.sourceId}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {binding.kind === "domain"
                            ? t("Colección del dominio")
                            : binding.kind === "crm"
                              ? "HubSpot"
                              : isDatabaseKind(binding.kind)
                                ? `${databaseKinds[binding.kind].label} · ${binding.sourceId}`
                                : binding.sourceId}{" "}
                          · {binding.resource}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isDatabaseKind(binding.kind) && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              setError("");
                              try {
                                const object = await request<CrmObject>(
                                  `/objects/${encodeURIComponent(binding.name)}`,
                                );
                                const next = await request<CrmObject>(
                                  `/collection-bindings/${encodeURIComponent(binding.name)}/sync`,
                                  "POST",
                                  { version: object.version },
                                );
                                await client.invalidateQueries();
                                setNotice(
                                  next.config.studio?.collection?.schemaIssues
                                    ?.length
                                    ? next.config.studio.collection.schemaIssues.join(
                                        "; ",
                                      )
                                    : t("Campos sincronizados."),
                                );
                              } catch (e) {
                                setError(errorText(e));
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            {t("Sincronizar campos")}
                          </Button>
                        )}
                        {binding.kind !== "crm" &&
                          !isDatabaseKind(binding.kind) && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setOperationBinding(binding)}
                            >
                              <SlidersHorizontal className="size-3.5 mr-1.5" />
                              {t("Operaciones")}
                            </Button>
                          )}
                        <Button
                          type="button"
                          size="sm"
                          variant={
                            confirmRemoval === `binding:${binding.name}`
                              ? "destructive"
                              : "outline"
                          }
                          disabled={busy}
                          onClick={() =>
                            confirmRemoval === `binding:${binding.name}`
                              ? void remove(
                                  `/collection-bindings/${encodeURIComponent(binding.name)}`,
                                )
                              : setConfirmRemoval(`binding:${binding.name}`)
                          }
                        >
                          <Unlink className="size-3.5 mr-1.5" />
                          {confirmRemoval === `binding:${binding.name}`
                            ? t("Confirmar desvinculación")
                            : t("Desvincular pantalla")}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 p-8 text-center">
                  <Layers className="size-8 text-muted-foreground/60 mb-2" />
                  <p className="text-sm font-medium text-foreground">
                    {t("Aún no hay colecciones vinculadas en este dominio.")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                    {t(
                      "Selecciona una colección arriba para asociarla y habilitar pantallas interactivas en tu espacio de trabajo.",
                    )}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {operationBinding && (
            <CollectionOperationsPanel
              name={operationBinding.name}
              label={operationBinding.label}
              onClose={() => setOperationBinding(null)}
            />
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}

export function CollectionLayoutDesigner({
  object,
  onSaved,
}: {
  object: CrmObject;
  onSaved: () => void;
}) {
  const t = useMessages(studioMessages);
  const errorText = (error: unknown) =>
    error instanceof Error
      ? error.message
      : t("No se pudo completar la operación.");
  const { request } = useScopedRequest();
  const [draft, setDraft] = useState(() => structuredClone(object));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const order = fieldEntries(draft).map(([name]) => name);

  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await request(`/objects/${encodeURIComponent(object.name)}`, "PUT", {
        ...draft,
        version: object.version ?? 1,
      });
      onSaved();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="shadow-xs overflow-hidden">
      <CardHeader className="pb-4 border-b">
        <CardTitle className="text-base font-semibold">
          {t("Diseño de")} {object.label}
        </CardTitle>
        <CardDescription className="text-xs leading-relaxed">
          {t(
            "Define los nombres que verán los usuarios en tablas y formularios. El nombre visible no cambia el campo de origen ni la API.",
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 pt-5">
        <div className="grid gap-1.5 text-sm">
          <Label htmlFor="form-columns-select">
            {t("Columnas del formulario")}
          </Label>
          <select
            id="form-columns-select"
            aria-label={t("Columnas del formulario")}
            className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none"
            value={draft.config.studio?.columns ?? 1}
            onChange={(e) =>
              setDraft((previous) => ({
                ...previous,
                config: {
                  ...previous.config,
                  studio: {
                    ...previous.config.studio,
                    columns: Number(e.target.value) as 1 | 2,
                  },
                },
              }))
            }
          >
            <option value="1">{t("Una columna")}</option>
            <option value="2">{t("Dos columnas")}</option>
          </select>
        </div>

        <ol className="divide-y rounded-lg border bg-card">
          {order.map((fieldName, index) => (
            <li
              key={fieldName}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 transition-colors hover:bg-muted/30"
            >
              <div className="grid flex-1 min-w-48 gap-1 text-sm">
                <Label
                  htmlFor={`field-label-${fieldName}`}
                  className="text-xs font-medium"
                >
                  {t("Nombre visible")}
                </Label>
                <input
                  id={`field-label-${fieldName}`}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none"
                  aria-label={t("Nombre visible de %{v1}", { v1: fieldName })}
                  value={draft.config.fields[fieldName].label}
                  maxLength={100}
                  onChange={(e) =>
                    setDraft((previous) => ({
                      ...previous,
                      config: {
                        ...previous.config,
                        fields: {
                          ...previous.config.fields,
                          [fieldName]: {
                            ...previous.config.fields[fieldName],
                            label: e.target.value,
                          },
                        },
                      },
                    }))
                  }
                />
                <span className="text-xs text-muted-foreground">
                  {t("Campo de origen:")} {fieldName}
                </span>
              </div>

              <div className="flex items-center gap-3 self-end sm:self-center">
                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-input accent-primary"
                    checked={!draft.config.fields[fieldName].hidden}
                    onChange={(e) =>
                      setDraft((previous) => ({
                        ...previous,
                        config: {
                          ...previous.config,
                          fields: {
                            ...previous.config.fields,
                            [fieldName]: {
                              ...previous.config.fields[fieldName],
                              hidden: !e.target.checked,
                            },
                          },
                        },
                      }))
                    }
                  />
                  <span>{t("Visible")}</span>
                </label>

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={index === 0}
                  aria-label={t("Subir %{v1}", {
                    v1: draft.config.fields[fieldName].label,
                  })}
                  onClick={() => {
                    const next = [...order];
                    [next[index - 1], next[index]] = [
                      next[index],
                      next[index - 1],
                    ];
                    setDraft((previous) => ({
                      ...previous,
                      config: { ...previous.config, fieldOrder: next },
                    }));
                  }}
                >
                  <ArrowUp className="size-3.5 mr-1" />
                  {t("Subir")}
                </Button>
              </div>
            </li>
          ))}
        </ol>

        {error && (
          <Alert variant="destructive" className="py-2.5">
            <AlertCircle className="size-4" />
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>

      <CardFooter className="border-t bg-muted/20 py-3 flex justify-end">
        <Button type="button" disabled={busy} onClick={() => void save()}>
          {busy ? t("Guardando…") : t("Guardar diseño")}
        </Button>
      </CardFooter>
    </Card>
  );
}
