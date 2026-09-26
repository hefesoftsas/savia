import { resolveLocalizedContent } from "@savia/studio-shared/plugin-localization";
import { compareSolutionVersions } from "@savia/studio-shared/solution-package";
import { useAppLocale, useMessages } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";
import { useEffect, useMemo, useRef, useState } from "react";
import { PackageOpen, Search, ShieldCheck, Upload, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "./api";
import { CustomPluginFrame } from "./custom-plugin-frame";
import {
  StoreConnections,
  type StoreConnectorDeclaration,
} from "./store-connections";
import { StudioHelpTooltip } from "./studio-help-tooltip";

type StoreManifest = {
  id: string;
  version: string;
  label: string;
  description: string;
  labels?: Record<string, string>;
  descriptions?: Record<string, string>;
  requires: string[];
};

type StoreItem = {
  manifest: StoreManifest;
  version: string;
  sha256: string;
  sizeBytes: number;
  createdAt: string;
  declarations?: {
    actions: Array<{ id: string; kind: string }>;
    connectors: StoreConnectorDeclaration[];
    hasSettings: boolean;
  };
  installed: { version: string; enabled: boolean } | null;
};

type StatusFilter = "all" | "active" | "inactive" | "available" | "updates";

type GroupedPlugin = {
  id: string;
  latest: StoreItem;
  versions: StoreItem[];
};

function isActive(item: StoreItem) {
  return item.installed?.enabled === true;
}

function hasUpdate(item: StoreItem) {
  return (
    item.installed !== null &&
    compareSolutionVersions(item.version, item.installed.version) > 0
  );
}

function statusOf(item: StoreItem): "active" | "inactive" | "available" {
  if (item.installed?.enabled === true) return "active";
  if (item.installed) return "inactive";
  return "available";
}

function formatBytes(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return "—";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const kb = sizeBytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 2 : 1)} MB`;
}

/**
 * El backend devuelve un artefacto por versión subida; la UI agrupa por
 * id y muestra solo la última versión para no repetir la misma tarjeta.
 */
function groupById(items: StoreItem[]): GroupedPlugin[] {
  const byId = new Map<string, StoreItem[]>();
  for (const item of items) {
    const list = byId.get(item.manifest.id);
    if (list) list.push(item);
    else byId.set(item.manifest.id, [item]);
  }
  return [...byId.entries()].map(([id, versions]) => {
    let latest = versions[0];
    for (const candidate of versions) {
      if (compareSolutionVersions(candidate.version, latest.version) > 0)
        latest = candidate;
    }
    return {
      id,
      latest,
      versions: [...versions].sort((a, b) =>
        compareSolutionVersions(b.version, a.version),
      ),
    };
  });
}

export default function PluginStoreManager({
  onChanged,
}: {
  onChanged: () => void | Promise<unknown>;
}) {
  const t = useMessages(automationMessages);
  const locale = useAppLocale();
  const fileRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [openPluginId, setOpenPluginId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [deleteTarget, setDeleteTarget] = useState<GroupedPlugin | null>(null);

  const message = (reason: unknown) =>
    reason instanceof Error
      ? reason.message
      : t("No se pudo actualizar el plugin. Intenta de nuevo.");

  async function reload() {
    const response = await api<{ data: StoreItem[] }>("/plugin-store");
    setItems(response.data);
  }

  async function fetchInitial() {
    setLoading(true);
    setError("");
    try {
      await reload();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    api<{ data: StoreItem[] }>("/plugin-store")
      .then((response) => {
        if (active) setItems(response.data);
      })
      .catch((reason) => {
        if (active) setError(message(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(id: string, operation: () => Promise<unknown>) {
    setBusy(id);
    setError("");
    try {
      await operation();
      await reload();
      await onChanged();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File) {
    if (!/\.zip$/i.test(file.name)) {
      setError(t("El archivo debe ser un .zip válido."));
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      await api("/plugin-store/upload", "POST", form);
      await reload();
      await onChanged();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const grouped = useMemo(() => groupById(items), [items]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const list = grouped.filter(({ latest: item }) => {
      if (statusFilter === "active" && statusOf(item) !== "active")
        return false;
      if (statusFilter === "inactive" && statusOf(item) !== "inactive")
        return false;
      if (statusFilter === "available" && statusOf(item) !== "available")
        return false;
      if (statusFilter === "updates" && !hasUpdate(item)) return false;
      if (!normalized) return true;
      const label = resolveLocalizedContent(
        item.manifest.label,
        item.manifest.labels as never,
        locale,
      );
      const description = resolveLocalizedContent(
        item.manifest.description,
        item.manifest.descriptions as never,
        locale,
      );
      const haystack =
        `${item.manifest.id} ${label} ${description} ${item.version}`.toLowerCase();
      return haystack.includes(normalized);
    });
    return [...list].sort((a, b) => {
      const labelA = resolveLocalizedContent(
        a.latest.manifest.label,
        a.latest.manifest.labels as never,
        locale,
      );
      const labelB = resolveLocalizedContent(
        b.latest.manifest.label,
        b.latest.manifest.labels as never,
        locale,
      );
      return labelA.localeCompare(labelB, locale);
    });
  }, [grouped, query, statusFilter, locale]);

  const isFiltering = query.trim() !== "" || statusFilter !== "all";

  function clearFilters() {
    setQuery("");
    setStatusFilter("all");
  }

  const deleteLabel = deleteTarget
    ? resolveLocalizedContent(
        deleteTarget.latest.manifest.label,
        deleteTarget.latest.manifest.labels as never,
        locale,
      )
    : "";

  const filters: Array<{ value: StatusFilter; label: string }> = [
    { value: "all", label: t("Todos") },
    { value: "active", label: t("Activos") },
    { value: "inactive", label: t("Inactivos") },
    { value: "available", label: t("Disponibles") },
    { value: "updates", label: t("Con actualización") },
  ];

  return (
    <section aria-label={t("Mis plugins")} className="space-y-5">
      <div className="savia-surface-card overflow-hidden">
        <header className="flex flex-wrap items-center gap-2 border-b px-6 py-5">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            {t("Mis plugins")}
          </h2>
          <StudioHelpTooltip
            label={t("Cómo funcionan los plugins del store")}
            side="bottom"
          >
            {t(
              "Sube un .zip con savia-extension.json y dist/plugin.js compilado. Solo es visible en este espacio.",
            )}
          </StudioHelpTooltip>
          <span className="ms-auto">
            <input
              ref={fileRef}
              type="file"
              accept=".zip"
              className="hidden"
              aria-label={t("Subir plugin")}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <Button
              size="sm"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              <Upload aria-hidden="true" />
              {uploading ? t("Subiendo…") : t("Subir plugin")}
            </Button>
          </span>
        </header>

        <div className="flex flex-col gap-3 border-b px-6 py-4 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              className="ps-9 pe-9"
              aria-label={t("Buscar plugins")}
              placeholder={t("Buscar por nombre, descripción o ID…")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  setQuery("");
                }
              }}
            />
            {query ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute top-1/2 right-1 h-7 w-7 -translate-y-1/2 p-0"
                aria-label={t("Limpiar búsqueda")}
                onClick={() => setQuery("")}
              >
                <X aria-hidden="true" />
              </Button>
            ) : null}
          </div>
          <div
            role="group"
            aria-label={t("Filtrar por estado")}
            className="flex flex-wrap gap-1.5"
          >
            {filters.map((filter) => (
              <Button
                key={filter.value}
                type="button"
                size="sm"
                variant={
                  statusFilter === filter.value ? "secondary" : "outline"
                }
                aria-pressed={statusFilter === filter.value}
                onClick={() => setStatusFilter(filter.value)}
              >
                {filter.label}
              </Button>
            ))}
          </div>
        </div>

        {!loading && grouped.length > 0 ? (
          <p
            aria-live="polite"
            className="px-6 pt-4 text-xs text-muted-foreground"
          >
            {t("Mostrando %{value0} de %{value1} plugins", {
              value0: filtered.length,
              value1: grouped.length,
            })}
          </p>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="mx-6 mt-5 flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm"
          >
            <p className="min-w-0 flex-1 text-destructive">{error}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void fetchInitial()}
            >
              {t("Reintentar")}
            </Button>
          </div>
        ) : null}

        {loading ? (
          <div className="space-y-3 px-6 py-5">
            <p role="status" className="text-sm text-muted-foreground">
              {t("Cargando plugins…")}
            </p>
            <div
              aria-hidden="true"
              className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
            >
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  className="h-44 animate-pulse rounded-xl border bg-muted/40"
                />
              ))}
            </div>
          </div>
        ) : grouped.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-muted">
              <PackageOpen
                aria-hidden="true"
                className="size-5 text-muted-foreground"
              />
            </span>
            <p className="text-sm font-medium text-foreground">
              {t("Aún no subiste plugins a este espacio.")}
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {t(
                "Sube tu primer plugin para ampliar las capacidades de este espacio.",
              )}
            </p>
            <Button
              type="button"
              size="sm"
              className="mt-2"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              <Upload aria-hidden="true" />
              {uploading ? t("Subiendo…") : t("Subir plugin")}
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-muted">
              <Search
                aria-hidden="true"
                className="size-5 text-muted-foreground"
              />
            </span>
            <p className="text-sm font-medium text-foreground">
              {t("No hay coincidencias para esta búsqueda.")}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={clearFilters}
            >
              {t("Limpiar búsqueda y filtros")}
            </Button>
          </div>
        ) : (
          <div
            className="grid gap-4 p-6 sm:grid-cols-2 xl:grid-cols-3"
            role="list"
          >
            {filtered.map((group) => {
              const item = group.latest;
              const label = resolveLocalizedContent(
                item.manifest.label,
                item.manifest.labels as never,
                locale,
              );
              const description = resolveLocalizedContent(
                item.manifest.description,
                item.manifest.descriptions as never,
                locale,
              );
              const active = isActive(item);
              const updateAvailable = hasUpdate(item);
              const pending = busy === item.manifest.id;
              const open = openPluginId === item.manifest.id;
              return (
                <article
                  key={group.id}
                  role="listitem"
                  className="flex min-w-0 flex-col rounded-xl border bg-card p-5 shadow-xs"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3
                      className="min-w-0 flex-1 truncate font-medium text-foreground"
                      title={label}
                    >
                      {label}
                    </h3>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={active ? "secondary" : "outline"}>
                        {active
                          ? t("Activa")
                          : item.installed
                            ? t("Inactiva")
                            : t("Disponible")}
                      </Badge>
                      {updateAvailable ? (
                        <Badge variant="default">
                          {t("Actualización disponible")}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <p
                    className="mt-1.5 line-clamp-3 min-h-12 text-sm text-muted-foreground"
                    title={description}
                  >
                    {description}
                  </p>
                  <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
                    <div className="flex flex-wrap gap-x-1">
                      <dt className="font-medium text-foreground">
                        {t("Versión")}
                      </dt>
                      <dd>
                        {item.version}
                        {item.installed &&
                        item.installed.version !== item.version
                          ? ` · ${item.installed.version}`
                          : ""}
                      </dd>
                    </div>
                    <div className="flex flex-wrap gap-x-1">
                      <dt className="font-medium text-foreground">
                        {t("Tamaño")}
                      </dt>
                      <dd>{formatBytes(item.sizeBytes)}</dd>
                    </div>
                    {item.manifest.requires.length ? (
                      <div className="flex flex-wrap gap-x-1">
                        <dt className="sr-only">{t("Versión")}</dt>
                        <dd className="break-words">
                          {t(" · Requiere: %{value0}", {
                            value0: item.manifest.requires.join(", "),
                          })}
                        </dd>
                      </div>
                    ) : null}
                    {group.versions.length > 1 ? (
                      <div className="flex flex-wrap gap-x-1">
                        <dd>
                          {t("%{value0} versiones", {
                            value0: group.versions.length,
                          })}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                    <ShieldCheck
                      aria-hidden="true"
                      className="mt-0.5 size-3.5 shrink-0"
                    />
                    <span>
                      {t(
                        "Se ejecuta aislado: sin acceso a tus credenciales ni a otros espacios.",
                      )}
                    </span>
                  </p>
                  <div className="mt-auto pt-4">
                    <div className="flex flex-wrap gap-1.5 border-t pt-3">
                      {!item.installed ? (
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            void run(item.manifest.id, () =>
                              api(
                                `/extensions/${item.manifest.id}/install`,
                                "POST",
                              ),
                            )
                          }
                          aria-label={t("Instalar %{value0}", {
                            value0: label,
                          })}
                        >
                          {t("Instalar")}
                        </Button>
                      ) : (
                        <>
                          {updateAvailable ? (
                            <Button
                              size="sm"
                              disabled={pending}
                              onClick={() =>
                                void run(item.manifest.id, () =>
                                  api(
                                    `/extensions/${item.manifest.id}/install`,
                                    "POST",
                                  ),
                                )
                              }
                              aria-label={`${t("Actualizar")} ${label}`}
                            >
                              {t("Actualizar")}
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() =>
                              void run(item.manifest.id, () =>
                                api(
                                  `/extensions/${item.manifest.id}`,
                                  "PATCH",
                                  {
                                    enabled: !item.installed!.enabled,
                                  },
                                ),
                              )
                            }
                            aria-label={`${item.installed.enabled ? t("Desactivar") : t("Activar")} ${label}`}
                          >
                            {item.installed.enabled
                              ? t("Desactivar")
                              : t("Activar")}
                          </Button>
                        </>
                      )}
                      {active ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setOpenPluginId(open ? null : item.manifest.id)
                          }
                          aria-label={t("Ver plugin %{value0}", {
                            value0: label,
                          })}
                          aria-expanded={open}
                        >
                          {open ? t("Ocultar") : t("Ver")}
                        </Button>
                      ) : null}
                      {!active ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => setDeleteTarget(group)}
                          aria-label={t("Eliminar %{value0}", {
                            value0: label,
                          })}
                        >
                          {t("Eliminar")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {active && open ? (
                    <div className="pt-3">
                      <CustomPluginFrame
                        pluginId={item.manifest.id}
                        title={label}
                      />
                    </div>
                  ) : null}
                  {active && (item.declarations?.connectors.length ?? 0) > 0 ? (
                    <StoreConnections
                      extensionId={item.manifest.id}
                      connectors={item.declarations!.connectors}
                    />
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Eliminar plugin")}</DialogTitle>
            <DialogDescription>
              {t(
                "Esta acción eliminará %{value0} de este espacio. No podrás deshacerla.",
                { value0: deleteLabel || deleteTarget?.id || "" },
              )}
              {(deleteTarget?.versions.length ?? 0) > 1 ? (
                <>
                  <br />
                  {t("Se eliminarán %{value0} versiones.", {
                    value0: deleteTarget?.versions.length ?? 0,
                  })}
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
            >
              {t("Cancelar")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!deleteTarget || busy === deleteTarget.id}
              onClick={() => {
                const target = deleteTarget;
                if (!target) return;
                setDeleteTarget(null);
                void run(target.id, () =>
                  api(`/plugin-store/${target.id}`, "DELETE"),
                );
              }}
            >
              {t("Eliminar definitivamente")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
