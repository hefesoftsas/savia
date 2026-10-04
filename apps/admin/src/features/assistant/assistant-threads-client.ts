import { ApiClient } from "@/api/api-client";
import type { AssistantThreadRecord } from "./assistant-thread-storage";

export type RecordingContext = {
  kind: "recording" | "session";
  id: string;
  title: string;
};
export type SyncedThread = AssistantThreadRecord & {
  revision: number;
  context?: RecordingContext;
};
const path = "/api/assistant/threads";
export class AssistantThreadsClient {
  constructor(private api: ApiClient) {}
  async list(context?: RecordingContext): Promise<SyncedThread[]> {
    const query = context
      ? `?${new URLSearchParams({ contextKind: context.kind, contextId: context.id })}`
      : "";
    return (await this.api.get<{ threads: SyncedThread[] }>(`${path}${query}`))
      .threads;
  }
  get(id: string): Promise<SyncedThread> {
    return this.api.get(`${path}/${encodeURIComponent(id)}`);
  }
  save(thread: SyncedThread): Promise<SyncedThread> {
    return this.api.put(`${path}/${encodeURIComponent(thread.id)}`, {
      title: thread.title,
      messages: thread.messages,
      context: thread.context,
      expectedRevision: thread.revision,
    });
  }
  remove(thread: SyncedThread): Promise<void> {
    return this.api.delete(
      `${path}/${encodeURIComponent(thread.id)}?expectedRevision=${thread.revision}`,
    );
  }
}
