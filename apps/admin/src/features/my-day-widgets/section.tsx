import { useEffect, useState } from "react";
import { Boxes, LayoutGrid, Plus, RefreshCw } from "lucide-react";
import type { ApiClient } from "@/api/api-client";
import type { UserPreferencesClient } from "@/api/user-preferences-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AddWidgetDialog } from "./add-widget-dialog";
import { listWidgetCollections } from "./data";
import { useMyDayWidgets } from "./use-my-day-widgets";
import { WidgetCard } from "./widgets";
import type { MyDayWidget } from "@savia/crm-shared/my-day-widgets";

const MAX_WIDGETS = 12;

function useCollectionLabels(
  apiClient: ApiClient | undefined,
  widgets: MyDayWidget[],
) {
  const [labels, setLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!apiClient || widgets.length === 0) return;
    let active = true;
    const domains = [...new Set(widgets.map((widget) => widget.apiBasePath))];
    void Promise.allSettled(
      domains.map((apiBasePath) =>
        listWidgetCollections(apiClient, apiBasePath).then((collections) => ({
          apiBasePath,
          collections,
        })),
      ),
    ).then((results) => {
      if (!active) return;
      const next: Record<string, string> = {};
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        for (const collection of result.value.collections) {
          next[`${collection.apiBasePath}:${collection.name}`] =
            collection.label;
        }
      }
      setLabels(next);
    });
    return () => {
      active = false;
    };
  }, [apiClient, widgets]);
  return labels;
}

export function MyDayWidgetsSection({
  apiClient,
  userPreferences,
}: {
  apiClient?: ApiClient;
  userPreferences?: UserPreferencesClient;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const {
    widgets,
    loading,
    saving,
    feedback,
    unavailable,
    add,
    remove,
    move,
    reload,
  } = useMyDayWidgets(userPreferences);
  const labels = useCollectionLabels(apiClient, widgets);

  if (unavailable) return null;

  const full = widgets.length >= MAX_WIDGETS;

  return (
    <section aria-label="Mis widgets" className="mt-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <LayoutGrid className="size-5 text-primary" aria-hidden="true" />
          <h2 className="text-xl font-semibold tracking-tight">Mis widgets</h2>
          {!loading && widgets.length > 0 ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
              {widgets.length}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading || saving}
            onClick={() => void reload()}
          >
            <RefreshCw
              className={loading ? "animate-spin" : undefined}
              aria-hidden="true"
            />
            Actualizar
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={loading || saving || full}
            onClick={() => setDialogOpen(true)}
          >
            <Plus aria-hidden="true" />
            Agregar widget
          </Button>
        </div>
      </div>

      {feedback ? (
        <Alert className="mb-4" aria-label={feedback}>
          <AlertDescription>{feedback}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
          role="status"
          aria-label="Cargando widgets…"
        >
          <span className="sr-only">Cargando widgets…</span>
          {[0, 1, 2].map((index) => (
            <div key={index} className="space-y-2 rounded-xl border p-4">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
      ) : widgets.length === 0 ? (
        <div
          className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 px-6 py-10 text-center"
          data-testid="my-day-widgets-empty"
        >
          <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20">
            <Boxes aria-hidden="true" className="size-7 text-primary" />
          </div>
          <h3 className="mt-5 text-lg font-semibold text-foreground">
            Sin widgets todavía
          </h3>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            Agrega un widget de cualquiera de tus colecciones para ver resúmenes
            y elementos recientes sin abrir cada pantalla.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-6"
            onClick={() => setDialogOpen(true)}
          >
            <Plus aria-hidden="true" />
            Agregar tu primer widget
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {widgets.map((widget, index) => (
            <WidgetCard
              key={widget.id}
              apiClient={apiClient}
              widget={widget}
              collectionLabel={
                labels[`${widget.apiBasePath}:${widget.collection}`] ??
                widget.title ??
                widget.collection
              }
              onRemove={(id) => void remove(id)}
              onMove={(id, direction) => void move(id, direction)}
              isFirst={index === 0}
              isLast={index === widgets.length - 1}
              disabled={saving}
            />
          ))}
        </div>
      )}

      <AddWidgetDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        apiClient={apiClient}
        onAdd={add}
        saving={saving}
      />
    </section>
  );
}
