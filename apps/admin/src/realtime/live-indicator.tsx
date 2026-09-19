import { cn } from "@/lib/utils";
import type { RealtimeStatus } from "./use-realtime";

/**
 * Small live indicator for list actions. Hidden when realtime is off
 * (offline banner already covers that state) so it never adds noise.
 */
export function LiveIndicator({ status }: { status: RealtimeStatus }) {
  if (status === "unavailable") return null;
  const live = status === "live";
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs text-muted-foreground"
    >
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          live ? "animate-pulse bg-emerald-500" : "bg-muted-foreground/50",
        )}
      />
      {live ? "En vivo" : "Conectando…"}
    </span>
  );
}
