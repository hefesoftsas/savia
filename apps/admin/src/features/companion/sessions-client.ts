import { encodeStoredZip } from "@savia/plugin-authoring/zip";
import { ApiClient } from "@/api/api-client";
import type { RecordingNotes } from "./client";
const FULL_AUDIO_REQUEST_TIMEOUT_MS = 60_000;
export type SessionChunk = {
  source: "microphone" | "system";
  sequence: number;
  startSeconds: number;
  durationSeconds: number;
  bytes: number;
  format: "ogg" | "m4a";
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
    language: string;
    completedChunks: number;
    totalChunks: number;
    error?: string;
    transcripts: Record<string, NonNullable<RecordingNotes["transcript"]>>;
    summary: RecordingNotes["summary"];
  };
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
  process(
    id: string,
    retryAmbiguous: boolean,
    language?: string,
    retranscribe?: boolean,
  ): Promise<RecordingSession> {
    return this.api.post(
      `/v1/companion/sessions/${encodeURIComponent(id)}/notes`,
      { consent: true, retryAmbiguous, language, retranscribe },
    );
  }
  cancel(id: string): Promise<RecordingSession> {
    return this.api.post(
      `/v1/companion/sessions/${encodeURIComponent(id)}/cancel`,
    );
  }
  rename(id: string, name: string): Promise<RecordingSession> {
    return this.api.patch(`/v1/companion/sessions/${encodeURIComponent(id)}`, {
      name,
    });
  }
  remove(id: string): Promise<void> {
    return this.api.delete(`/v1/companion/sessions/${encodeURIComponent(id)}`);
  }
  async audio(
    id: string,
    chunk: SessionChunk,
    signal?: AbortSignal,
  ): Promise<Blob> {
    const { response, body } = await this.api.requestResponseWithBody(
      `/v1/companion/sessions/${encodeURIComponent(id)}/chunks/${chunk.source}/${chunk.sequence}`,
      { signal },
      async (result) => (result.ok ? result.blob() : null),
    );
    if (!response.ok || !body) throw new Error("Audio unavailable");
    return body;
  }
  /** Preserve uploaded bytes and formats, grouped by source in timeline order. */
  async originalAudioZip(
    session: RecordingSession,
    signal?: AbortSignal,
  ): Promise<Blob> {
    const entries: { name: string; data: Uint8Array }[] = [];
    const chunks = [...session.chunks].sort(
      (a, b) => a.source.localeCompare(b.source) || a.sequence - b.sequence,
    );
    // Fetch sequentially to bound concurrent audio requests for long sessions.
    for (const chunk of chunks) {
      signal?.throwIfAborted();
      const blob = await this.audio(session.id, chunk, signal);
      entries.push({
        name: `${chunk.source}/${String(chunk.sequence).padStart(6, "0")}.${chunk.format ?? "ogg"}`,
        data: new Uint8Array(await blob.arrayBuffer()),
      });
    }
    signal?.throwIfAborted();
    const bytes = encodeStoredZip(entries);
    return new Blob([bytes.buffer as ArrayBuffer], { type: "application/zip" });
  }
  /** Single concatenated Ogg file for one source, in timeline order. */
  async fullAudio(
    id: string,
    source: SessionChunk["source"],
    signal?: AbortSignal,
  ): Promise<Blob> {
    const { response, body } = await this.api.requestResponseWithBody(
      `/v1/companion/sessions/${encodeURIComponent(id)}/audio?source=${source}`,
      { signal },
      async (result) => (result.ok ? result.blob() : null),
      FULL_AUDIO_REQUEST_TIMEOUT_MS,
    );
    if (!response.ok || !body) throw new Error("Audio unavailable");
    return body;
  }
}
