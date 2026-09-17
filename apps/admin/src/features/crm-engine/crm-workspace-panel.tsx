import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, CheckCircle2, RefreshCw, Sparkles } from "lucide-react";

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

export default function CrmWorkspacePanel({
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
          "No se instaló ninguna pantalla. Revisa los permisos de la conexión HubSpot y vuelve a consultar la disponibilidad.",
        );
      await client.invalidateQueries();
      const first = installed.objects[0];
      await onInstalled(first);
      setNotice(
        `${installed.objects.length} pantallas de HubSpot listas.${
          installed.unavailable?.length
            ? ` ${installed.unavailable.length} no disponibles con esta conexión.`
            : ""
        }`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No se pudieron instalar las pantallas. Vuelve a intentarlo.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Card
      aria-labelledby="connected-crm-title"
      className="overflow-hidden border-border/80 shadow-xs"
    >
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <CardTitle id="connected-crm-title" className="text-base font-semibold">
              CRM conectado · HubSpot
            </CardTitle>
            {workspace.data?.connected ? (
              <Badge variant="secondary" className="text-xs font-normal">
                Conectado
              </Badge>
            ) : null}
          </div>
          <CardDescription className="text-xs leading-relaxed">
            Crea las pantallas del CRM para trabajar con los registros y sus
            relaciones desde Savia.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {workspace.isPending && (
          <div
            role="status"
            aria-live="polite"
            className="space-y-3 rounded-lg border bg-muted/20 p-4"
          >
            <p className="text-xs text-muted-foreground">
              Consultando la conexión y las pantallas disponibles…
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Skeleton className="h-9 w-full rounded-md" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          </div>
        )}

        {workspace.error && (
          <Alert variant="destructive" className="py-2.5">
            <AlertCircle className="size-4" />
            <AlertDescription className="text-xs">
              No se pudo consultar HubSpot: {workspace.error.message}
            </AlertDescription>
          </Alert>
        )}

        {workspace.data && !workspace.data.connected && (
          <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-xs text-muted-foreground">
            No hay una conexión HubSpot activa en este dominio. Configúrala en
            las integraciones de Savia y actualiza la disponibilidad.
          </div>
        )}

        {workspace.data?.connected && (
          <div className="space-y-3">
            <p className="text-xs font-medium text-foreground">
              {workspace.data.accountLabel || "HubSpot"} · {available.length} de{" "}
              {workspace.data.objects.length} pantallas disponibles
            </p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {workspace.data.objects.map((object) => (
                <li
                  key={object.resource}
                  className="flex flex-col justify-between rounded-lg border bg-card p-2.5 text-xs transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">
                      {object.label}
                    </span>
                    <Badge
                      variant={object.available ? "outline" : "secondary"}
                      className="text-xs font-normal"
                    >
                      {object.available ? "Disponible" : "No disponible"}
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
            <p className="text-xs text-muted-foreground">
              Las operaciones disponibles dependen de los permisos de HubSpot.
              Puedes repetir la instalación sin duplicar pantallas.
            </p>
          </div>
        )}

        {error && (
          <Alert variant="destructive" className="py-2.5">
            <AlertCircle className="size-4" />
            <AlertDescription className="text-xs">
              {error}
            </AlertDescription>
          </Alert>
        )}

        {notice && (
          <Alert className="border-emerald-500/20 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 py-2.5" role="status">
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
            <AlertDescription className="text-xs font-medium">
              {notice}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>

      <CardFooter className="flex flex-wrap items-center gap-2 border-t bg-muted/20 py-3">
        <Button
          type="button"
          size="sm"
          disabled={busy || workspace.isFetching || !available.length}
          onClick={() => void install()}
        >
          <Sparkles className="size-3.5 mr-1.5" />
          {busy
            ? "Instalando pantallas…"
            : "Instalar todas las pantallas disponibles"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || workspace.isFetching}
          onClick={() => void workspace.refetch()}
        >
          <RefreshCw
            className={`size-3.5 mr-1.5 ${workspace.isFetching ? "animate-spin" : ""}`}
          />
          {workspace.isFetching ? "Consultando…" : "Actualizar disponibilidad"}
        </Button>
      </CardFooter>
    </Card>
  );
}
