import { cn } from "@/lib/utils";
import type { RealtimeStatus } from "./use-realtime";

/**
 * Small live indicator for list actions. Only rendered when realtime is
 * actually live; connecting and unavailable states render nothing so a slow
 * or missing socket never leaves a stuck "Conectando…" pill in the actions
 * bar (offline banner already covers offline, lists still work via refetch).
 */
export function LiveIndicator({ status }: { status: RealtimeStatus }) {
  if (status !== "live") return null;
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs text-muted-foreground"
    >
      <span
        aria-hidden
        className={cn("size-2 animate-pulse rounded-full bg-emerald-500")}
      />
      En vivo
    </span>
  );
}
