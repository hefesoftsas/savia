import { ApiClientError } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n/core";
import { assistantSyncMessages } from "./assistant-sync-messages";
import type { useAssistantThreads } from "./use-assistant-threads";
export function AssistantSyncStatus({
  history,
}: {
  history: ReturnType<typeof useAssistantThreads>;
}) {
  const t = useMessages(assistantSyncMessages);
  const tooLarge =
    history.error instanceof ApiClientError && history.error.status === 413;
  const invalid =
    history.error instanceof ApiClientError && history.error.status === 400;
  const needsReload = history.conflict || tooLarge || invalid;
  return (
    <div className="border-b px-4 py-2 text-xs text-muted-foreground">
      {history.error ? (
        <div role="alert" className="space-y-2 text-destructive">
          <p>
            {t(
              tooLarge
                ? "Conversation is too large to sync. Copy your draft, then load the latest version and use smaller attachments."
                : invalid
                  ? "Conversation could not be saved. Copy your draft, then load the latest version."
                  : history.conflict
                    ? "Updated on another device. Copy your draft before loading the latest conversation."
                    : "Could not sync. Your messages remain here. Retry before leaving.",
            )}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              needsReload ? void history.refresh(true) : void history.retry()
            }
          >
            {t(needsReload ? "Load latest" : "Retry")}
          </Button>
        </div>
      ) : (
        <p role="status">
          {t(
            history.loading
              ? "Loading conversations…"
              : history.saving
                ? "Saving conversation…"
                : "Synced across devices",
          )}
        </p>
      )}
      {history.legacyAvailable && !history.loading && (
        <Button
          variant="link"
          size="sm"
          className="h-auto px-0 py-2 text-xs"
          disabled={history.saving}
          onClick={() => void history.importLegacy()}
        >
          {t("Import browser history")}
        </Button>
      )}
    </div>
  );
}
