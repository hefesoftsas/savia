import { WifiOff } from "lucide-react";
import { useTranslate } from "ra-core";
import { useOnlineStatus } from "./use-online-status";

/**
 * Fixed offline indicator. Rendered once at the app root so every screen
 * (lists, show, edit) behaves the same: cached reads stay visible behind
 * this banner instead of failing silently.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  const translate = useTranslate();
  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-50 flex max-w-sm items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-50 px-3 py-2 text-sm text-amber-900 shadow-md dark:bg-amber-950 dark:text-amber-100"
    >
      <WifiOff className="size-4 shrink-0" aria-hidden />
      <span>
        {translate("savia.offline.banner", {
          _: "Sin conexión — mostrando datos guardados. Los cambios requieren conexión.",
        })}
      </span>
    </div>
  );
}
