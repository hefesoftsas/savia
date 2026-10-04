import { ApiClient } from "@/api/api-client";
import type { AssistantThreadRecord } from "./assistant-thread-storage";

export type RecordingContext = {
  kind: "recording" | "session";
  id: string;
  title: string;
  tenantId?: number | null;
};
export type AssistantThreadSummary = Omit<AssistantThreadRecord, "messages"> & {
  revision: number;
  context?: RecordingContext;
  messageCount: number | null;
  preview: string;
};
export type SyncedThread = AssistantThreadRecord & {
  revision: number;
  context?: RecordingContext;
};
const path = "/api/assistant/threads";
export class AssistantThreadsClient {
  constructor(private api: ApiClient) {}
  async list(context?: RecordingContext): Promise<AssistantThreadSummary[]> {
    const query = context
      ? `?${new URLSearchParams({ contextKind: context.kind, contextId: context.id })}`
      : "";
    return (
      await this.api.get<{ threads: AssistantThreadSummary[] }>(
        `${path}${query}`,
      )
    ).threads;
  }
  get(id: string): Promise<SyncedThread> {
    return this.api.get(`${path}/${encodeURIComponent(id)}`);
  }
  save(thread: SyncedThread): Promise<SyncedThread> {
    const context = thread.context
      ? {
          kind: thread.context.kind,
          id: thread.context.id,
          title: thread.context.title,
        }
      : undefined;
    return this.api.put(`${path}/${encodeURIComponent(thread.id)}`, {
      title: thread.title,
      messages: thread.messages,
      context,
      expectedRevision: thread.revision,
    });
  }
  remove(
    thread: Pick<AssistantThreadSummary, "id" | "revision">,
  ): Promise<void> {
    return this.api.delete(
      `${path}/${encodeURIComponent(thread.id)}?expectedRevision=${thread.revision}`,
    );
  }
}
