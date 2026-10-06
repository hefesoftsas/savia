import { ApiClient, ApiClientError } from "@/api/api-client";
export const MAX_RECORDING_BYTES = 50_000_000;
export type AudioFormat = "ogg" | "wav" | "mp3" | "m4a";
export type DriveProvider =
  "google_drive" | "onedrive_personal" | "onedrive_business";
export type ConnectedDrive = { provider: DriveProvider; label: string };
export type DriveAudioFile = {
  id: string;
  name: string;
  mimeType: string | null;
};
export function audioFormat(name: string): AudioFormat | null {
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "opus" || extension === "oga") return "ogg";
  return extension && ["ogg", "wav", "mp3", "m4a"].includes(extension)
    ? (extension as AudioFormat)
    : null;
}
export type Recording = {
  id: string;
  source: "microphone" | "system" | "upload";
  format: AudioFormat;
  name?: string;
  origin?: "local" | DriveProvider;
  bytes: number;
  durationSeconds: number | null;
  createdAt: string;
  sha256: string;
};
export type RecordingNotes = {
  language?: string;
  transcript: {
    text: string;
    source: Recording["source"];
    model: string;
    durationSeconds: number | null;
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
  async upload(file: File): Promise<Recording> {
    const format = audioFormat(file.name);
    if (!format || !file.size || file.size > MAX_RECORDING_BYTES)
      throw new Error("Choose an audio file up to 50 MB.");
    const query = new URLSearchParams({
      id: crypto.randomUUID(),
      name: file.name,
      format,
      consent: "true",
    });
    return this.api.request(`/v1/companion/recordings/upload?${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
  }
  importFile(provider: DriveProvider, fileId: string): Promise<Recording> {
    return this.api.post("/v1/companion/recordings/import", {
      id: crypto.randomUUID(),
      provider,
      fileId,
      consent: true,
    });
  }
  async connectedDrives(): Promise<ConnectedDrive[]> {
    const [providers, connections] = await Promise.all([
      this.api.get<{
        data: {
          id: string;
          attributes: { availability: string; displayName: string };
        }[];
      }>("/v1/personal-integrations/providers"),
      this.api.get<{
        data: {
          attributes: {
            provider: string;
            status: string;
            externalAccountLabel: string | null;
          };
        }[];
      }>("/v1/personal-integrations/connections"),
    ]);
    return connections.data.flatMap(({ attributes: connection }) => {
      const provider = providers.data.find(
        (p) =>
          p.id === connection.provider &&
          p.attributes.availability === "enabled",
      );
      if (
        !provider ||
        connection.status !== "connected" ||
        !["google_drive", "onedrive_personal", "onedrive_business"].includes(
          connection.provider,
        )
      )
        return [];
      return [
        {
          provider: connection.provider as DriveProvider,
          label: [
            provider.attributes.displayName,
            connection.externalAccountLabel,
          ]
            .filter(Boolean)
            .join(" · "),
        },
      ];
    });
  }
  async searchFiles(
    provider: DriveProvider,
    term: string,
  ): Promise<DriveAudioFile[]> {
    const query = new URLSearchParams({ provider, query: term });
    const response = await this.api.get<{ data: DriveAudioFile[] }>(
      `/v1/personal-integrations/files?${query}`,
    );
    return response.data.filter((file) => audioFormat(file.name));
  }
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
  generate(
    id: string,
    language?: string,
    retranscribe?: boolean,
  ): Promise<RecordingNotes> {
    return this.api.post(
      `/v1/companion/recordings/${encodeURIComponent(id)}/notes`,
      { consent: true, language, retranscribe },
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
