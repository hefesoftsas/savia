import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export function PageHeaderSkeleton({
  hasEyebrow = true,
  hasActions = true,
  className,
}: {
  hasEyebrow?: boolean;
  hasActions?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-end justify-between gap-4 pb-2",
        className,
      )}
      role="status"
      aria-label="Cargando cabecera…"
    >
      <div className="space-y-2">
        {hasEyebrow ? <Skeleton className="h-3.5 w-28" /> : null}
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      {hasActions ? (
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-28 rounded-md" />
          <Skeleton className="h-9 w-9 rounded-md" />
        </div>
      ) : null}
    </div>
  );
}

export function ScreenListSkeleton({
  count = 5,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("w-full space-y-5", className)}
      role="status"
      aria-label="Cargando pantallas…"
      aria-live="polite"
    >
      <span className="sr-only">Cargando pantallas…</span>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-44 rounded-md" />
          <Skeleton className="h-9 w-10 rounded-md" />
        </div>
      </div>

      {/* Filter / Search input */}
      <div className="pt-1">
        <Skeleton className="h-10 w-full max-w-md rounded-md" />
      </div>

      {/* Section title */}
      <div className="pt-2">
        <Skeleton className="h-4 w-36" />
      </div>

      {/* Screen rows */}
      <div className="divide-y rounded-xl border bg-card shadow-xs overflow-hidden">
        {Array.from({ length: count }, (_, index) => (
          <div
            key={index}
            className="flex items-center justify-between gap-4 px-5 py-4"
          >
            <div className="flex items-center gap-3.5 min-w-0 flex-1">
              <Skeleton className="size-8 shrink-0 rounded-lg" />
              <div className="space-y-2 min-w-0 flex-1">
                <Skeleton
                  className={cn(
                    "h-4",
                    index % 3 === 0
                      ? "w-28"
                      : index % 3 === 1
                        ? "w-36"
                        : "w-44",
                  )}
                />
                <Skeleton
                  className={cn(
                    "h-3",
                    index % 2 === 0 ? "w-48" : "w-56",
                  )}
                />
              </div>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-5 w-9 rounded-full" />
              <Skeleton className="size-8 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CardsGridSkeleton({
  cards = 2,
  itemsPerCard = 3,
  className,
}: {
  cards?: number;
  itemsPerCard?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("w-full space-y-6", className)}
      role="status"
      aria-label="Cargando contenido…"
      aria-live="polite"
    >
      <span className="sr-only">Cargando contenido…</span>
      <div className="space-y-4">
        {Array.from({ length: cards }, (_, cardIndex) => (
          <div
            key={cardIndex}
            className="overflow-hidden rounded-xl border bg-card shadow-xs"
          >
            <div className="border-b px-5 py-3.5">
              <Skeleton className="h-4 w-28" />
            </div>
            <div className="divide-y">
              {Array.from({ length: itemsPerCard }, (_, itemIndex) => (
                <div
                  key={itemIndex}
                  className="flex items-center justify-between gap-3 px-5 py-3.5"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Skeleton className="size-8 shrink-0 rounded-md" />
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-48" />
                    </div>
                  </div>
                  <Skeleton className="h-8 w-24 shrink-0 rounded-md" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SidebarFlowsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div
      className="space-y-1 px-2 py-1"
      role="status"
      aria-label="Cargando flujos…"
    >
      <span className="sr-only">Cargando flujos…</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-2 px-2 py-1.5">
          <Skeleton className="size-4 shrink-0 rounded" />
          <Skeleton
            className={cn(
              "h-3.5",
              i === 0 ? "w-28" : i === 1 ? "w-20" : "w-24",
            )}
          />
        </div>
      ))}
    </div>
  );
}

export function SettingsPanelSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("w-full space-y-6", className)}
      role="status"
      aria-label="Cargando configuración…"
      aria-live="polite"
    >
      <span className="sr-only">Cargando configuración…</span>

      {/* Tabs list */}
      <div className="flex gap-2 border-b pb-2">
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-8 w-28 rounded-md" />
      </div>

      {/* Panel card */}
      <div className="space-y-5 rounded-xl border bg-card p-6 shadow-xs">
        <div className="space-y-2 border-b pb-4">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="space-y-4 max-w-xl">
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
          <div className="pt-2">
            <Skeleton className="h-9 w-32 rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}
