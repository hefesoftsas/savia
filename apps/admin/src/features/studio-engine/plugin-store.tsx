import { resolveLocalizedContent } from "@savia/studio-shared/plugin-localization";
import { compareSolutionVersions } from "@savia/studio-shared/solution-package";
import { useAppLocale, useMessages } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";
import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

function isActive(item: StoreItem) {
  return item.installed?.enabled === true;
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

  const message = (reason: unknown) =>
    reason instanceof Error
      ? reason.message
      : t("No se pudo actualizar el plugin. Intenta de nuevo.");

  async function reload() {
    const response = await api<{ data: StoreItem[] }>("/plugin-store");
    setItems(response.data);
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

  return (
    <section aria-label={t("Mis plugins")} className="space-y-5">
      <div className="savia-surface-card">
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
        {error ? (
          <p role="alert" className="px-6 pt-5 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {loading ? (
          <p role="status" className="px-6 py-5 text-sm text-muted-foreground">
            {t("Cargando plugins…")}
          </p>
        ) : items.length === 0 ? (
          <p className="px-6 py-5 text-sm text-muted-foreground">
            {t("Aún no subiste plugins a este espacio.")}
          </p>
        ) : (
          <div className="divide-y" role="list">
            {items.map((item) => {
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
              const updateAvailable =
                item.installed !== null &&
                compareSolutionVersions(item.version, item.installed.version) >
                  0;
              const pending = busy === item.manifest.id;
              const open = openPluginId === item.manifest.id;
              return (
                <div
                  key={`${item.manifest.id}@${item.version}`}
                  role="listitem"
                >
                  <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
                    <div className="flex min-w-0 flex-1 basis-72 items-center gap-2">
                      <h3 className="font-medium text-foreground">{label}</h3>
                      <Badge variant={active ? "secondary" : "outline"}>
                        {active
                          ? t("Activa")
                          : item.installed
                            ? t("Inactiva")
                            : t("Disponible")}
                      </Badge>
                      <StudioHelpTooltip
                        label={t("Más información sobre %{value0}", {
                          value0: label,
                        })}
                        side="bottom"
                      >
                        <span className="block max-w-xs space-y-1">
                          <span className="block">{description}</span>
                          <span className="block text-primary-foreground/75">
                            {t("Versión")} {item.version}
                            {item.manifest.requires.length
                              ? t(" · Requiere: %{value0}", {
                                  value0: item.manifest.requires.join(", "),
                                })
                              : ""}
                          </span>
                          <span className="block text-primary-foreground/75">
                            {t(
                              "Se ejecuta aislado: sin acceso a tus credenciales ni a otros espacios.",
                            )}
                          </span>
                        </span>
                      </StudioHelpTooltip>
                    </div>
                    <div className="flex flex-col items-start gap-1 sm:flex-row sm:flex-wrap sm:items-center">
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
                        >
                          {open ? t("Ocultar") : t("Ver")}
                        </Button>
                      ) : null}
                      {!active ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() =>
                            void run(item.manifest.id, () =>
                              api(
                                `/plugin-store/${item.manifest.id}?version=${encodeURIComponent(item.version)}`,
                                "DELETE",
                              ),
                            )
                          }
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
                    <div className="px-6 pb-5">
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
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
