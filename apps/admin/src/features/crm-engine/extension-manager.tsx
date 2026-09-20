import { useMessages } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";
import { useEffect, useState } from "react";
import { Settings2, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { releaseCatalog } from "@savia/release-catalog";
import { ExtensionRuntimeClient } from "../../api/extension-runtime-client";
import { api } from "./api";
import {
  ExtensionConnections,
  type ExtensionConnectionConnector,
} from "./extension-connections";
import { StudioHelpTooltip } from "./studio-help-tooltip";

type ExtensionManifest = {
  id: string;
  version: string;
  label: string;
  description: string;
  requires: string[];
};

type ExtensionEntry = {
  manifest: ExtensionManifest;
  builtIn: boolean;
  installed: { version: string; enabled: boolean } | null;
};

function isActive(entry: ExtensionEntry) {
  return entry.builtIn || entry.installed?.enabled === true;
}

const extensionRuntimeClient = new ExtensionRuntimeClient();

function labelForField(name: string): string {
  return name
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export default function ExtensionManager({
  onChanged,
}: {
  onChanged: () => void | Promise<unknown>;
}) {
  const t = useMessages(automationMessages);
  function connectorsFor(extensionId: string): ExtensionConnectionConnector[] {
    return (
      releaseCatalog.extensionRegistry.get(extensionId)?.runtime?.connectors ??
      []
    ).map((connector) => {
      const schema = connector.configurationSchema as {
        shape?: Record<string, unknown>;
      };
      return {
        connectorId: connector.connectorId,
        label: connector.label,
        fields: Object.keys(schema.shape ?? {}).map((name) => ({
          name,
          label:
            name === "credentials"
              ? t("Credenciales (JSON)")
              : labelForField(name),
          secret: connector.secretFields.includes(name),
          multiline: name === "credentials",
          json: name === "credentials",
        })),
      };
    });
  }

  function state(entry: ExtensionEntry) {
    if (entry.builtIn) return t("Incluida");
    if (!entry.installed) return t("Disponible");
    return entry.installed.enabled ? t("Activa") : t("Inactiva");
  }

  const message = (error: unknown) =>
    error instanceof Error
      ? error.message
      : t("No se pudo actualizar la extensión. Intenta de nuevo.");

  const [entries, setEntries] = useState<ExtensionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [configuredExtensionId, setConfiguredExtensionId] = useState<
    string | null
  >(null);

  async function reload() {
    const response = await api<{ data: ExtensionEntry[] }>("/extensions");
    setEntries(response.data);
  }

  useEffect(() => {
    let active = true;
    api<{ data: ExtensionEntry[] }>("/extensions")
      .then((response) => {
        if (active) setEntries(response.data);
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

  return (
    <section aria-label={t("Extensiones disponibles")} className="space-y-5">
      <div className="savia-surface-card">
        <header className="flex items-center gap-2 border-b px-6 py-5">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            {t("Extensiones")}
          </h2>
          <StudioHelpTooltip
            label={t("Cómo funcionan las extensiones")}
            side="bottom"
          >
            {t(
              "Añaden capacidades incluidas en este release. Se activan solo para este espacio.",
            )}
          </StudioHelpTooltip>
        </header>
        {error ? (
          <p role="alert" className="px-6 pt-5 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {loading ? (
          <p role="status" className="px-6 py-5 text-sm text-muted-foreground">
            {t("Cargando extensiones…")}
          </p>
        ) : entries.length === 0 ? (
          <p className="px-6 py-5 text-sm text-muted-foreground">
            {t("No hay extensiones incluidas en este release.")}
          </p>
        ) : (
          <div className="divide-y" role="list">
            {entries.map((entry) => {
              const active = isActive(entry);
              const pending = busy === entry.manifest.id;
              const connectors = connectorsFor(entry.manifest.id);
              const connectionsOpen =
                configuredExtensionId === entry.manifest.id;
              return (
                <Collapsible
                  key={entry.manifest.id}
                  open={connectionsOpen}
                  role="listitem"
                  onOpenChange={(open) =>
                    setConfiguredExtensionId(open ? entry.manifest.id : null)
                  }
                >
                  <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
                    <div className="flex min-w-0 flex-1 basis-72 items-center gap-2">
                      <h3 className="font-medium text-foreground">
                        {entry.manifest.label}
                      </h3>
                      <Badge variant={active ? "secondary" : "outline"}>
                        {state(entry)}
                      </Badge>
                      <StudioHelpTooltip
                        label={t("Más información sobre %{value0}", {
                          value0: entry.manifest.label,
                        })}
                        side="bottom"
                      >
                        <span className="block max-w-xs space-y-1">
                          <span className="block">
                            {entry.manifest.description}
                          </span>
                          <span className="block text-primary-foreground/75">
                            {t("Versión")}{" "}
                            {entry.installed?.version ?? entry.manifest.version}
                            {entry.manifest.requires.length
                              ? t(" · Requiere: %{value0}", {
                                  value0: entry.manifest.requires.join(", "),
                                })
                              : ""}
                          </span>
                        </span>
                      </StudioHelpTooltip>
                    </div>
                    <div className="flex flex-col items-start gap-1 sm:flex-row sm:flex-wrap sm:items-center">
                      {!entry.builtIn && !entry.installed ? (
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            void run(entry.manifest.id, () =>
                              api(
                                `/extensions/${entry.manifest.id}/install`,
                                "POST",
                              ),
                            )
                          }
                          aria-label={t("Instalar %{value0}", {
                            value0: entry.manifest.label,
                          })}
                        >
                          {t("Instalar")}
                        </Button>
                      ) : null}
                      {!entry.builtIn && entry.installed ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() =>
                            void run(entry.manifest.id, () =>
                              api(`/extensions/${entry.manifest.id}`, "PATCH", {
                                enabled: !entry.installed!.enabled,
                              }),
                            )
                          }
                          aria-label={`${entry.installed.enabled ? t("Desactivar") : t("Activar")} ${entry.manifest.label}`}
                        >
                          {entry.installed.enabled
                            ? t("Desactivar")
                            : t("Activar")}
                        </Button>
                      ) : null}
                      {active && connectors.length ? (
                        <CollapsibleTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            aria-label={t("Configurar conexión de %{value0}", {
                              value0: entry.manifest.label,
                            })}
                          >
                            <Settings2 aria-hidden="true" />
                            {t("Configurar")}
                          </Button>
                        </CollapsibleTrigger>
                      ) : null}
                      {!entry.builtIn && active ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-8"
                              disabled={pending}
                              onClick={() =>
                                void run(entry.manifest.id, () =>
                                  api(
                                    `/extensions/${entry.manifest.id}/install`,
                                    "POST",
                                  ),
                                )
                              }
                              aria-label={t("Reparar instalación %{value0}", {
                                value0: entry.manifest.label,
                              })}
                            >
                              <Wrench aria-hidden="true" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" sideOffset={6}>
                            {t(
                              "Reaplica los requisitos sin desactivar la extensión.",
                            )}
                          </TooltipContent>
                        </Tooltip>
                      ) : null}
                    </div>
                    {active && connectors.length ? (
                      <CollapsibleContent className="basis-full -mx-6 -mb-5 mt-1">
                        <ExtensionConnections
                          client={extensionRuntimeClient}
                          connectors={connectors}
                          extensionId={entry.manifest.id}
                          label={entry.manifest.label}
                        />
                      </CollapsibleContent>
                    ) : null}
                  </div>
                </Collapsible>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
