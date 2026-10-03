import { ApiClient } from "@/api/api-client";
import type { RecordingAnswer, RecordingNotes } from "./client";
export type SessionChunk = {
  source: "microphone" | "system";
  sequence: number;
  startSeconds: number;
  durationSeconds: number;
  bytes: number;
};
export type RecordingSession = {
  id: string;
  name: string;
  createdAt: string;
  state: "uploading" | "ready";
  durationSeconds: number | null;
  chunks: SessionChunk[];
  job: {
    status:
      | "idle"
      | "queued"
      | "transcribing"
      | "summarizing"
      | "complete"
      | "needs_attention"
      | "cancelled"
      | "failed";
    completedChunks: number;
    totalChunks: number;
    error?: string;
    transcripts: Record<string, NonNullable<RecordingNotes["transcript"]>>;
    summary: RecordingNotes["summary"];
  };
};
export type SessionAnswer = RecordingAnswer & {
  partial: boolean;
  evidence: Pick<
    SessionChunk,
    "source" | "sequence" | "startSeconds" | "durationSeconds"
  >[];
};
export class CompanionSessionsClient {
  constructor(private api: ApiClient) {}
  list(
    cursor?: string,
  ): Promise<{ sessions: RecordingSession[]; cursor: string | null }> {
    return this.api.get(
      `/v1/companion/sessions${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
  }
  get(id: string, signal?: AbortSignal): Promise<RecordingSession> {
    return this.api.get(`/v1/companion/sessions/${encodeURIComponent(id)}`, {
      signal,
    });
  }
  process(id: string, retryAmbiguous: boolean): Promise<RecordingSession> {
    return this.api.post(
      `/v1/companion/sessions/${encodeURIComponent(id)}/notes`,
      { consent: true, retryAmbiguous },
    );
  }
  cancel(id: string): Promise<RecordingSession> {
    return this.api.post(
      `/v1/companion/sessions/${encodeURIComponent(id)}/cancel`,
    );
  }
  answer(id: string, question: string): Promise<SessionAnswer> {
    return this.api.post(
      `/v1/companion/sessions/${encodeURIComponent(id)}/questions`,
      { question, consent: true },
    );
  }
  async audio(
    id: string,
    chunk: SessionChunk,
    signal?: AbortSignal,
  ): Promise<Blob> {
    const response = await this.api.requestResponse(
      `/v1/companion/sessions/${encodeURIComponent(id)}/chunks/${chunk.source}/${chunk.sequence}`,
      { signal },
    );
    if (!response.ok) throw new Error("Audio unavailable");
    return response.blob();
  }
}
