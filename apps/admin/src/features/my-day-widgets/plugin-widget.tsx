import { Component, useEffect, useMemo, useState } from "react";
import type { ApiClient } from "@/api/api-client";
import type { MyDayWidget } from "@savia/studio-shared/my-day-widgets";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  isPluginWidgetEnabled,
  listWidgetExtensions,
  parsePluginKind,
  pluginApiFor,
  pluginContributionFor,
  type ExtensionInstallation,
} from "./plugins";

function PluginWidgetSkeleton() {
  return (
    <div role="status" aria-label="Cargando widget…" className="space-y-2">
      <span className="sr-only">Cargando widget…</span>
      <Skeleton className="h-8 w-24" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

class WidgetErrorBoundary extends Component<
  { children: React.ReactNode; title: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Este widget no se pudo mostrar.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => this.setState({ failed: false })}
            aria-label={`Reintentar widget ${this.props.title}`}
          >
            Reintentar
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function PluginWidgetBody({
  apiClient,
  widget,
}: {
  apiClient: ApiClient | undefined;
  widget: Extract<MyDayWidget, { apiBasePath: string; collection: string }>;
}) {
  const [extensions, setExtensions] = useState<
    ExtensionInstallation[] | undefined
  >(undefined);
  const [failed, setFailed] = useState(false);

  const ref = useMemo(() => parsePluginKind(widget.kind), [widget.kind]);
  const contribution = ref ? pluginContributionFor(ref) : undefined;

  useEffect(() => {
    if (!apiClient || !ref || !contribution) return;
    let active = true;
    setFailed(false);
    void listWidgetExtensions(apiClient, widget.apiBasePath).then(
      (result) => {
        if (active) setExtensions(result);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [apiClient, ref, contribution, widget.apiBasePath]);

  const savia = useMemo(
    () =>
      apiClient && ref
        ? pluginApiFor(ref.extensionId, apiClient, widget.apiBasePath)
        : undefined,
    [apiClient, ref, widget.apiBasePath],
  );

  if (!apiClient) return <PluginWidgetSkeleton />;
  if (!ref || !contribution) {
    return (
      <p className="text-sm text-muted-foreground">
        Este tipo de widget estará disponible próximamente. Mientras tanto
        puedes abrir la colección completa.
      </p>
    );
  }
  if (failed) {
    return (
      <p className="text-sm text-muted-foreground">
        No pudimos verificar la extensión de este widget. Reintenta desde
        Actualizar.
      </p>
    );
  }
  if (extensions === undefined || !savia) return <PluginWidgetSkeleton />;
  const enabled = isPluginWidgetEnabled(contribution, extensions);
  if (!enabled) {
    return (
      <p className="text-sm text-muted-foreground">
        Activa la extensión {contribution.title.es} para ver este widget.
      </p>
    );
  }

  const Widget = contribution.Widget;
  return (
    <WidgetErrorBoundary title={contribution.title.es}>
      <Widget savia={savia} widget={widget} />
    </WidgetErrorBoundary>
  );
}
