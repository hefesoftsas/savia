import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export function RouteLoading({
  label,
  compact = false,
  className,
}: {
  label?: string;
  compact?: boolean;
  className?: string;
}) {
  if (compact) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "flex items-center gap-2 text-sm text-muted-foreground",
          className,
        )}
      >
        <LoaderCircle
          className="size-4 shrink-0 animate-spin"
          aria-hidden="true"
        />
        {label ? <span>{label}</span> : null}
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "mx-auto w-full max-w-6xl space-y-6 py-6",
        className,
      )}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        {label ? (
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <LoaderCircle
              className="size-3.5 animate-spin"
              aria-hidden="true"
            />
            <span>{label}</span>
          </div>
        ) : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4 rounded-xl border bg-card p-6 shadow-xs">
          <div className="flex items-center justify-between border-b pb-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
          <div className="divide-y rounded-lg border">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                <Skeleton className="h-4 w-16" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="size-6 rounded-md" />
              </div>
            ))}
          </div>
        </div>

        <div className="h-fit space-y-4 rounded-xl border bg-card p-6 shadow-xs">
          <div className="border-b pb-4">
            <Skeleton className="h-5 w-28" />
          </div>
          <div className="space-y-4 pt-1">
            <div className="space-y-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
            <Skeleton className="h-9 w-full rounded-md mt-4" />
          </div>
        </div>
      </div>
    </div>
  );
}
