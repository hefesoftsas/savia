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
const actions = { create: "Crear", update: "Actualizar", keep: "Sin cambios" };
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "No se pudo completar la operación. Intenta de nuevo.";

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
      aria-label="Paquetes de soluciones"
      className="savia-surface-card space-y-5 p-6"
    >
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            Paquetes
          </h2>
          <StudioHelpTooltip
            label="Cómo funcionan los paquetes de soluciones"
            side="bottom"
          >
            Un paquete añade modelos y pantallas a este espacio. Revísalo antes
            de instalarlo.
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
        aria-label="Importar paquete"
        className="flex flex-wrap items-center gap-x-2 gap-y-3 border-y py-4"
      >
        <div className="flex items-center gap-2">
          <label htmlFor="solution-file" className="text-sm font-medium">
            Importar JSON
          </label>
          <StudioHelpTooltip
            label="Información sobre la importación de paquetes"
            side="bottom"
          >
            Máximo 2 MB. El archivo contiene definiciones, no registros ni
            credenciales.
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
                  "El archivo supera 2 MB. Selecciona un paquete más pequeño.",
                );
              let manifest: unknown;
              try {
                manifest = JSON.parse(await file.text());
              } catch {
                throw new Error(
                  "El archivo no contiene JSON válido. Revisa el archivo e intenta de nuevo.",
                );
              }
              await inspect(manifest);
            });
          }}
        />
      </section>
      <section aria-label="Catálogo de paquetes" className="space-y-2">
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Disponibles</h2>
          {!loading ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  disabled={busy}
                  onClick={() => void run(reload)}
                  aria-label="Actualizar catálogo"
                >
                  <RefreshCw aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={6}>
                Actualizar catálogo
              </TooltipContent>
            </Tooltip>
          ) : null}
        </header>
        {loading ? (
          <p role="status">Cargando paquetes…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay paquetes disponibles. Puedes importar un archivo JSON.
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
                        ? "Activo"
                        : "Inactivo"
                      : "Disponible"}
                  </Badge>
                  <StudioHelpTooltip
                    label={`Más información sobre ${manifest.label}`}
                    side="bottom"
                  >
                    <span className="block max-w-xs space-y-1">
                      <span className="block">{manifest.description}</span>
                      <span className="block text-primary-foreground/75">
                        Versión {manifest.version}
                        {installed
                          ? ` · ${installed.version === "0.0.0" ? "Configuración existente" : `Instalada ${installed.version}`}`
                          : ""}
                      </span>
                    </span>
                  </StudioHelpTooltip>
                  {installed ? (
                    <StudioHelpTooltip
                      label={`Qué ocurre al activar o desactivar ${manifest.label}`}
                      side="bottom"
                    >
                      Desactivar oculta sus pantallas y conserva los datos. Al
                      activarlo, las pantallas vuelven a estar disponibles.
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
                        aria-label={`Descargar ${manifest.label}`}
                      >
                        <Download aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={6}>
                      Descargar {manifest.label}
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
                          aria-label={`Exportar instalado ${manifest.label}`}
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
                        Exportar instalado
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
                      Revisar {manifest.label}
                    </Button>
                  ) : null}
                  {installed && installed.version !== manifest.version ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void run(() => inspect(manifest))}
                    >
                      Actualizar {manifest.label}
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
                              ? "Paquete desactivado. Sus datos se conservan."
                              : "Paquete activado. Sus pantallas están disponibles.",
                          );
                        })
                      }
                    >
                      {installed.enabled ? "Desactivar" : "Activar"}{" "}
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
          aria-label="Vista previa del paquete"
          className="space-y-3 border-t pt-4"
        >
          <h2 className="break-words font-semibold">
            Revisar {preview.id} · {preview.version}
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
                Resuelve estos conflictos antes de instalar:
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
                      ? "Paquete actualizado. Las pantallas están disponibles en este espacio."
                      : "Paquete instalado. Las pantallas están disponibles en este espacio.",
                  );
                })
              }
            >
              {busy
                ? "Procesando…"
                : isUpdating
                  ? "Actualizar paquete"
                  : "Instalar paquete"}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setPreview(null);
                setCandidate(null);
              }}
            >
              Cancelar revisión
            </Button>
          </div>
        </section>
      )}
    </section>
  );
}
