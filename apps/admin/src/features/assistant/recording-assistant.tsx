import { useId } from "react";
import { MessageSquare } from "lucide-react";
import { useMessages } from "@/i18n/core";
import { AssistantConversation } from "./assistant-bar";
import { AssistantSyncStatus } from "./assistant-sync-status";
import { assistantSyncMessages } from "./assistant-sync-messages";
import { useAssistantThreads } from "./use-assistant-threads";
import type { RecordingContext } from "./assistant-threads-client";

export function RecordingAssistant({ context }: { context: RecordingContext }) {
  // Source changes start a distinct runtime and never reuse an old recording's draft.
  return (
    <RecordingConversation
      key={`${context.kind}:${context.id}`}
      context={context}
    />
  );
}
function RecordingConversation({ context }: { context: RecordingContext }) {
  const t = useMessages(assistantSyncMessages);
  const headingId = useId();
  const history = useAssistantThreads(true, context);
  const thread = history.activeThread;
  return (
    <aside
      aria-labelledby={headingId}
      className="flex h-[min(44rem,80svh)] min-h-96 min-w-0 flex-col overflow-hidden rounded-xl border bg-background"
    >
      <header className="flex items-center gap-2 border-b px-4 py-4">
        <MessageSquare className="size-4 text-primary" aria-hidden="true" />
        <h2 id={headingId} className="text-base font-medium">
          {t("Chat about these notes")}
        </h2>
      </header>
      <AssistantSyncStatus history={history} />
      {thread && (
        <AssistantConversation
          key={`${thread.id}:${history.epoch}`}
          threadId={thread.id}
          initialMessages={thread.messages}
          onSaveThread={history.save}
          onOpenHistory={() => {}}
          threadTitle={thread.title}
          onRunningChange={history.setRunning}
          recordingContext={context}
          disabled={Boolean(history.error)}
        />
      )}
    </aside>
  );
}
