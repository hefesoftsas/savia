import { useMessages } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle,
  CheckCircle2,
  Info,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { FieldHelp } from "./field-help";

type WorkspaceObject = {
  name: string;
  label: string;
  resource: string;
  available: boolean;
  reason?: string;
};
type Workspace = {
  connected: boolean;
  accountLabel?: string;
  objects: WorkspaceObject[];
};
type InstalledWorkspace = {
  objects: Array<Pick<WorkspaceObject, "name" | "label">>;
  unavailable?: WorkspaceObject[];
};
type Request = <T>(path: string, method?: string, body?: unknown) => Promise<T>;

export default function StudioWorkspacePanel({
  scope,
  request,
  onInstalled,
}: {
  scope: string | undefined;
  request: Request;
  onInstalled: (
    object: Pick<WorkspaceObject, "name" | "label">,
  ) => void | Promise<void>;
}) {
  const t = useMessages(automationMessages);

  const client = useQueryClient();
  const workspace = useQuery({
    queryKey: ["crm-workspace", scope],
    queryFn: () => request<Workspace>("/crm-workspace"),
    retry: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  const available =
    workspace.data?.objects?.filter((object) => object.available) ?? [];

  // The panel is only relevant while the CRM integration is active.
  // A confirmed inactive connection renders nothing; query failures still
  // surface so they can be retried.
  if (!workspace.data?.connected && !workspace.isError) return null;

  async function install() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const installed = await request<InstalledWorkspace>(
        "/crm-workspace/install",
        "POST",
        {},
      );
      if (!installed.objects?.length)
        throw new Error(
          t(
            "No se instaló ninguna pantalla. Revisa los permisos de la conexión HubSpot y vuelve a consultar la disponibilidad.",
          ),
        );
      await client.invalidateQueries();
      const first = installed.objects[0];
      await onInstalled(first);
      setNotice(
        t("%{value0} pantallas de HubSpot listas.%{value1}", {
          value0: installed.objects.length,
          value1: installed.unavailable?.length
            ? t(" %{value0} no disponibles con esta conexión.", {
                value0: installed.unavailable.length,
              })
            : "",
        }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("No se pudieron instalar las pantallas. Vuelve a intentarlo."),
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Card
      aria-labelledby="connected-crm-title"
      className="overflow-hidden rounded-2xl border-border/60 shadow-sm"
    >
      <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-border/60 bg-muted/30 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <CardTitle
              id="connected-crm-title"
              className="text-base font-semibold"
            >
              {t("CRM conectado · HubSpot")}
            </CardTitle>
            <FieldHelp
              label={`${t("CRM conectado · HubSpot")} (${t("Ayuda")})`}
            >
              {t(
                "Crea las pantallas de Studio para trabajar con los registros y sus relaciones desde Savia.",
              )}
            </FieldHelp>
            {workspace.data?.connected ? (
              <Badge variant="secondary" className="text-xs font-normal">
                {t("Conectado")}
              </Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 p-5 pt-4 sm:p-6 sm:pt-4">
        {workspace.isPending && (
          <div
            role="status"
            aria-live="polite"
            className="space-y-3 rounded-xl border border-border/60 bg-muted/40 p-4"
          >
            <p className="text-xs text-muted-foreground">
              {t("Consultando la conexión y las pantallas disponibles…")}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Skeleton className="h-9 w-full rounded-md" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          </div>
        )}

        {workspace.error && (
          <Alert variant="destructive" className="rounded-2xl py-3">
            <AlertCircle className="size-4" />
            <AlertDescription className="text-xs">
              {t("No se pudo consultar HubSpot:")} {workspace.error.message}
            </AlertDescription>
          </Alert>
        )}

        {workspace.data && !workspace.data.connected && (
          <div className="flex items-start gap-2 rounded-xl border border-dashed border-border bg-muted/40 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <p>
              {t(
                "No hay una conexión HubSpot activa en este dominio. Configúrala en las integraciones de Savia y actualiza la disponibilidad.",
              )}
            </p>
          </div>
        )}

        {workspace.data?.connected && (
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-medium text-foreground">
                {workspace.data.accountLabel || "HubSpot"} · {available.length}{" "}
                {t("de")} {workspace.data.objects.length}{" "}
                {t("pantallas disponibles")}
              </p>
              <FieldHelp
                label={`${t("pantallas disponibles")} (${t("Ayuda")})`}
              >
                {t(
                  "Las operaciones disponibles dependen de los permisos de HubSpot. Puedes repetir la instalación sin duplicar pantallas.",
                )}
              </FieldHelp>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {workspace.data.objects.map((object) => (
                <li
                  key={object.resource}
                  className="flex flex-col justify-between rounded-xl border border-border/60 bg-card p-2.5 text-xs transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">
                      {object.label}
                    </span>
                    <Badge
                      variant={object.available ? "outline" : "secondary"}
                      className="text-xs font-normal"
                    >
                      {object.available ? t("Disponible") : t("No disponible")}
                    </Badge>
                  </div>
                  {!object.available && object.reason && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {object.reason}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <Alert variant="destructive" className="rounded-2xl py-3">
            <AlertCircle className="size-4" />
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        )}

        {notice && (
          <Alert
            className="rounded-2xl border-emerald-500/20 bg-emerald-500/10 py-3 text-emerald-800 dark:text-emerald-300"
            role="status"
          >
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
            <AlertDescription className="text-xs font-medium">
              {notice}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>

      <CardFooter className="flex flex-wrap items-center gap-2 border-t border-border/60 bg-muted/30 py-3">
        <Button
          type="button"
          size="sm"
          disabled={busy || workspace.isFetching || !available.length}
          onClick={() => void install()}
        >
          <Sparkles className="size-3.5" aria-hidden="true" />
          {busy
            ? t("Instalando pantallas…")
            : t("Instalar todas las pantallas disponibles")}
        </Button>
        <FieldHelp
          label={`${t("Instalar todas las pantallas disponibles")} (${t("Ayuda")})`}
        >
          {t(
            "Al instalar, todos los miembros activos de este tenant podrán consultar estas colecciones usando tu conexión. Solo los administradores podrán modificar registros, según los permisos de HubSpot.",
          )}
        </FieldHelp>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || workspace.isFetching}
          onClick={() => void workspace.refetch()}
        >
          <RefreshCw
            className={`size-3.5 ${workspace.isFetching ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          {workspace.isFetching
            ? t("Consultando…")
            : t("Actualizar disponibilidad")}
        </Button>
      </CardFooter>
    </Card>
  );
}
