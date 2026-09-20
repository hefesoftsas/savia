import { useMessages } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";
import { useEffect, useState } from "react";
import { Download, FileDown, RefreshCw } from "lucide-react";
import type { CrmObject } from "@savia/crm-shared/metadata";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "./api";
import { StudioHelpTooltip } from "./studio-help-tooltip";

type Manifest = {
  format: "savia.solution";
  formatVersion: 1;
  id: string;
  version: string;
  label: string;
  description: string;
  requires: string[];
  objects: CrmObject[];
};
type Entry = {
  manifest: Manifest;
  installed: null | { version: string; enabled: boolean };
};
type Preview = {
  id: string;
  version: string;
  objects: {
    name: string;
    label: string;
    action: "create" | "update" | "keep";
  }[];
  conflicts: string[];
  canInstall: boolean;
};

function download(manifest: Manifest) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${manifest.id}-${manifest.version}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SolutionManager({
  onChanged,
}: {
  onChanged: () => void | Promise<unknown>;
}) {
  const t = useMessages(automationMessages);
  const actions = {
    create: t("Crear"),
    update: t("Actualizar"),
    keep: t("Sin cambios"),
  };

  const message = (error: unknown) =>
    error instanceof Error
      ? error.message
      : t("No se pudo completar la operación. Intenta de nuevo.");

  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [candidate, setCandidate] = useState<unknown>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  async function reload() {
    const response = await api<{ data: Entry[] }>("/solutions");
    setEntries(response.data);
  }
  useEffect(() => {
    let active = true;
    api<{ data: Entry[] }>("/solutions")
      .then((response) => {
        if (active) setEntries(response.data);
      })
      .catch((error) => {
        if (active) setError(message(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function inspect(manifest: unknown) {
    setPreview(null);
    setCandidate(null);
    const response = await api<{ data: Preview }>(
      "/solutions/preview",
      "POST",
      manifest,
    );
    setCandidate(manifest);
    setPreview(response.data);
  }
  const isUpdating =
    preview !== null &&
    entries.some(
      ({ manifest, installed }) =>
        manifest.id === preview.id &&
        installed !== null &&
        installed.version !== preview.version,
    );
  return (
    <section
      aria-label={t("Paquetes de soluciones")}
      className="savia-surface-card space-y-5 p-6"
    >
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            {t("Paquetes")}
          </h2>
          <StudioHelpTooltip
            label={t("Cómo funcionan los paquetes de soluciones")}
            side="bottom"
          >
            {t(
              "Un paquete añade modelos y pantallas a este espacio. Revísalo antes de instalarlo.",
            )}
          </StudioHelpTooltip>
        </div>
      </header>
      {error && (
        <div role="alert" className="text-sm text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      <section
        aria-label={t("Importar paquete")}
        className="flex flex-wrap items-center gap-x-2 gap-y-3 border-y py-4"
      >
        <div className="flex items-center gap-2">
          <label htmlFor="solution-file" className="text-sm font-medium">
            {t("Importar JSON")}
          </label>
          <StudioHelpTooltip
            label={t("Información sobre la importación de paquetes")}
            side="bottom"
          >
            {t(
              "Máximo 2 MB. El archivo contiene definiciones, no registros ni credenciales.",
            )}
          </StudioHelpTooltip>
        </div>
        <Input
          className="max-w-xl"
          id="solution-file"
          type="file"
          accept=".json,application/json"
          disabled={busy || loading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void run(async () => {
              setCandidate(null);
              setPreview(null);
              if (file.size > 2 * 1024 * 1024)
                throw new Error(
                  t(
                    "El archivo supera 2 MB. Selecciona un paquete más pequeño.",
                  ),
                );
              let manifest: unknown;
              try {
                manifest = JSON.parse(await file.text());
              } catch {
                throw new Error(
                  t(
                    "El archivo no contiene JSON válido. Revisa el archivo e intenta de nuevo.",
                  ),
                );
              }
              await inspect(manifest);
            });
          }}
        />
      </section>
      <section aria-label={t("Catálogo de paquetes")} className="space-y-2">
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{t("Disponibles")}</h2>
          {!loading ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  disabled={busy}
                  onClick={() => void run(reload)}
                  aria-label={t("Actualizar catálogo")}
                >
                  <RefreshCw aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={6}>
                {t("Actualizar catálogo")}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </header>
        {loading ? (
          <p role="status">{t("Cargando paquetes…")}</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("No hay paquetes disponibles. Puedes importar un archivo JSON.")}
          </p>
        ) : (
          <ul className="divide-y">
            {entries.map(({ manifest, installed }) => (
              <li
                key={manifest.id}
                className="flex flex-wrap items-center justify-between gap-3 py-4"
              >
                <div className="flex min-w-0 flex-1 basis-64 items-center gap-2">
                  <h3 className="break-words font-medium">{manifest.label}</h3>
                  <Badge variant={installed?.enabled ? "secondary" : "outline"}>
                    {installed
                      ? installed.enabled
                        ? t("Activo")
                        : t("Inactivo")
                      : t("Disponible")}
                  </Badge>
                  <StudioHelpTooltip
                    label={t("Más información sobre %{value0}", {
                      value0: manifest.label,
                    })}
                    side="bottom"
                  >
                    <span className="block max-w-xs space-y-1">
                      <span className="block">{manifest.description}</span>
                      <span className="block text-primary-foreground/75">
                        {t("Versión")} {manifest.version}
                        {installed
                          ? ` · ${installed.version === "0.0.0" ? t("Configuración existente") : t("Instalada %{value0}", { value0: installed.version })}`
                          : ""}
                      </span>
                    </span>
                  </StudioHelpTooltip>
                  {installed ? (
                    <StudioHelpTooltip
                      label={t("Qué ocurre al activar o desactivar %{value0}", {
                        value0: manifest.label,
                      })}
                      side="bottom"
                    >
                      {t(
                        "Desactivar oculta sus pantallas y conserva los datos. Al activarlo, las pantallas vuelven a estar disponibles.",
                      )}
                    </StudioHelpTooltip>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            download(manifest);
                          })
                        }
                        aria-label={t("Descargar %{value0}", {
                          value0: manifest.label,
                        })}
                      >
                        <Download aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={6}>
                      {t("Descargar")} {manifest.label}
                    </TooltipContent>
                  </Tooltip>
                  {installed && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          disabled={busy}
                          aria-label={t("Exportar instalado %{value0}", {
                            value0: manifest.label,
                          })}
                          onClick={() =>
                            void run(async () => {
                              download(
                                await api<Manifest>(
                                  `/solutions/${encodeURIComponent(manifest.id)}/export`,
                                ),
                              );
                            })
                          }
                        >
                          <FileDown aria-hidden="true" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" sideOffset={6}>
                        {t("Exportar instalado")}
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {!installed ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void run(() => inspect(manifest))}
                    >
                      {t("Revisar")} {manifest.label}
                    </Button>
                  ) : null}
                  {installed && installed.version !== manifest.version ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void run(() => inspect(manifest))}
                    >
                      {t("Actualizar")} {manifest.label}
                    </Button>
                  ) : null}
                  {installed && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api(
                            `/solutions/${encodeURIComponent(manifest.id)}`,
                            "PATCH",
                            { enabled: !installed.enabled },
                          );
                          setPreview(null);
                          setCandidate(null);
                          await onChanged();
                          await reload();
                          setNotice(
                            installed.enabled
                              ? t(
                                  "Paquete desactivado. Sus datos se conservan.",
                                )
                              : t(
                                  "Paquete activado. Sus pantallas están disponibles.",
                                ),
                          );
                        })
                      }
                    >
                      {installed.enabled ? t("Desactivar") : t("Activar")}{" "}
                      {manifest.label}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {preview && (
        <section
          aria-label={t("Vista previa del paquete")}
          className="space-y-3 border-t pt-4"
        >
          <h2 className="break-words font-semibold">
            {t("Revisar")} {preview.id} · {preview.version}
          </h2>
          <ul className="space-y-2 text-sm">
            {preview.objects.map((object) => (
              <li
                key={object.name}
                className="flex flex-wrap justify-between gap-2"
              >
                <span className="break-words">{object.label}</span>
                <span className="text-muted-foreground">
                  {actions[object.action]}
                </span>
              </li>
            ))}
          </ul>
          {preview.conflicts.length > 0 && (
            <div role="alert">
              <p className="font-medium">
                {t("Resuelve estos conflictos antes de instalar:")}
              </p>
              <ul className="list-inside list-disc text-sm">
                {preview.conflicts.map((conflict, index) => (
                  <li key={index}>{conflict}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || !preview.canInstall}
              onClick={() =>
                void run(async () => {
                  await api("/solutions/install", "POST", candidate);
                  setPreview(null);
                  setCandidate(null);
                  await onChanged();
                  await reload();
                  setNotice(
                    isUpdating
                      ? t(
                          "Paquete actualizado. Las pantallas están disponibles en este espacio.",
                        )
                      : t(
                          "Paquete instalado. Las pantallas están disponibles en este espacio.",
                        ),
                  );
                })
              }
            >
              {busy
                ? t("Procesando…")
                : isUpdating
                  ? t("Actualizar paquete")
                  : t("Instalar paquete")}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setPreview(null);
                setCandidate(null);
              }}
            >
              {t("Cancelar revisión")}
            </Button>
          </div>
        </section>
      )}
    </section>
  );
}
