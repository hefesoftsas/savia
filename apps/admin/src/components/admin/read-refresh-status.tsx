import { AlertCircle, LoaderCircle } from "lucide-react";
import { useMessages } from "@/i18n/core";
import { backgroundRefreshMessages } from "@/i18n/locales/background-refresh";
import { Button } from "@/components/ui/button";

export function ReadRefreshStatus({
  refreshing = false,
  error,
  onRetry,
}: {
  refreshing?: boolean;
  error?: string;
  onRetry?: () => void;
}) {
  const t = useMessages(backgroundRefreshMessages);
  if (!refreshing && !error) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-2 text-xs text-muted-foreground"
    >
      {refreshing ? (
        <>
          <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
          <span>{t("Updating")}</span>
        </>
      ) : (
        <>
          <AlertCircle
            aria-hidden="true"
            className="size-3.5 text-destructive"
          />
          <span>{t("Refresh failed: %{error}", { error: error ?? "" })}</span>
          {onRetry ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={onRetry}
            >
              {t("Retry")}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
