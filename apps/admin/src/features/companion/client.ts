import { ApiClient, ApiClientError } from "@/api/api-client";
export type Recording = {
  id: string;
  source: "microphone" | "system";
  format: "ogg";
  bytes: number;
  durationSeconds: number;
  createdAt: string;
  sha256: string;
};
export type RecordingNotes = {
  transcript: {
    text: string;
    source: Recording["source"];
    model: string;
    durationSeconds: number;
  } | null;
  summary: {
    summary: string;
    decisions: string[];
    actions: {
      description: string;
      owner: string | null;
      dueDate: string | null;
    }[];
    openQuestions: string[];
  } | null;
};
export class CompanionRecordingsClient {
  constructor(private api: ApiClient) {}
  list(
    cursor?: string,
  ): Promise<{ recordings: Recording[]; cursor: string | null }> {
    return this.api.get(
      `/v1/companion/recordings${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
  }
  notes(id: string): Promise<RecordingNotes> {
    return this.api.get(
      `/v1/companion/recordings/${encodeURIComponent(id)}/notes`,
    );
  }
  generate(id: string): Promise<RecordingNotes> {
    return this.api.post(
      `/v1/companion/recordings/${encodeURIComponent(id)}/notes`,
      { consent: true },
    );
  }
  remove(id: string): Promise<void> {
    return this.api.delete(
      `/v1/companion/recordings/${encodeURIComponent(id)}`,
    );
  }
  async audio(id: string, signal?: AbortSignal): Promise<Blob> {
    const response = await this.api.requestResponse(
      `/v1/companion/recordings/${encodeURIComponent(id)}`,
      { signal },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ApiClientError(
        response.status,
        body?.error?.code ?? "AUDIO_UNAVAILABLE",
        body?.error?.message ?? "Audio unavailable",
      );
    }
    return response.blob();
  }
}
