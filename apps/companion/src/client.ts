import { invoke, isTauri } from "@tauri-apps/api/core";
export type Source = "microphone" | "system";
export type CaptureStatus = {
  state: "idle" | "recording" | "paused" | "ready" | "interrupted" | "error";
  elapsedSeconds: number;
  sessionId?: string | null;
  recovered?: boolean;
  interrupted?: boolean;
  chunks?: {
    source: Source;
    sequence: number;
    startSeconds: number;
    durationSeconds: number;
    bytes: number;
    sampleRate: number;
  }[];
  tracks: {
    source: Source;
    durationSeconds: number;
    sampleRate: number;
    bytes: number;
  }[];
  error: string | null;
};
export type Transcript = {
  text: string;
  source: Source;
  model: string;
  durationSeconds: number;
};
export type MeetingSummary = {
  summary: string;
  decisions: string[];
  actions: {
    description: string;
    owner: string | null;
    dueDate: string | null;
  }[];
  openQuestions: string[];
};
export type SavedRecording = {
  id: string;
  source: Source;
  format: "ogg";
  bytes: number;
  durationSeconds: number;
  createdAt: string;
  sha256: string;
};
export type Capabilities = {
  grantedRecordingScopes?: string[];
  storageAvailable: boolean;
  maxCompressedAudioBytes: number;
  audioFormats: ("wav" | "ogg")[];
  sttModel: string;
  summaryModel: string;
  maxDurationSeconds: number;
  maxAudioBytes: number;
  privacyRouting: string;
};
export function apiOrigin(value: string): string {
  const url = new URL(value.trim());
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "Use an HTTPS Savia origin, or HTTP on localhost, without a path or credentials.",
    );
  return url.origin;
}
export async function companionRequest<T = unknown>(
  origin: string,
  token: string,
  operation:
    | "capabilities"
    | "transcribe"
    | "summarize"
    | "save"
    | "recordings"
    | "sessioncreate"
    | "sessionchunk"
    | "sessionfinalize",
  body?: unknown,
  send?: typeof fetch,
): Promise<T> {
  const base = apiOrigin(origin);
  if (
    !token.trim() ||
    token.length > 8192 ||
    /[\r\n]/.test(token) ||
    token.trim().toLowerCase().startsWith("sk-or-")
  )
    throw new Error("Enter a Savia access token, never an OpenRouter API key.");
  if (isTauri() && !send)
    return invoke<T>("companion_request", {
      origin: base,
      token: token.trim(),
      operation,
      body: body ?? null,
    });
  let path: string =
    operation === "save"
      ? "recordings"
      : operation === "sessioncreate"
        ? "sessions"
        : operation;
  if (operation === "sessionchunk" || operation === "sessionfinalize") {
    const envelope = body as { sessionId?: string; payload?: unknown };
    if (
      !envelope?.sessionId ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        envelope.sessionId,
      )
    )
      throw new Error("Invalid recording session identifier.");
    path = `sessions/${envelope.sessionId}/${operation === "sessionchunk" ? "chunks" : "finalize"}`;
    body = envelope.payload;
  }
  // Browser preview supports layout/tests; deployed desktop calls through the native boundary.
  const response = await (send ?? fetch)(`${base}/v1/companion/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${token.trim()}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error",
    signal: AbortSignal.timeout(75000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      result?.error?.message ?? `Request failed (${response.status})`,
    );
  return result as T;
}
export async function native<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri())
    throw new Error(
      "Open the desktop app to capture audio. This browser view only previews the interface.",
    );
  return invoke<T>(command, args);
}

export function canUploadRecording(capabilities: Capabilities | null): boolean {
  return Boolean(
    capabilities?.storageAvailable &&
    (capabilities.grantedRecordingScopes === undefined ||
      capabilities.grantedRecordingScopes.includes("recordings:upload")),
  );
}

/** Maximum joined preview size: 120 Ogg segments of 512 KiB each. */
export const MAX_PREVIEW_BYTES = 64 * 1024 * 1024;

/** Join base64 Ogg segments into one playable buffer, in caller order. */
export function decodePreviewAudio(
  chunks: { base64: string }[],
): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  let total = 0;
  for (const chunk of chunks) {
    if (typeof chunk?.base64 !== "string" || !chunk.base64) {
      throw new Error("Captured audio is unavailable for preview.");
    }
    let binary: string;
    try {
      binary = atob(chunk.base64);
    } catch {
      throw new Error("Captured audio is unavailable for preview.");
    }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    total += bytes.length;
    if (total > MAX_PREVIEW_BYTES) {
      throw new Error("Captured audio exceeds the preview size limit.");
    }
    parts.push(bytes);
  }
  if (!parts.length) {
    throw new Error("There is no captured audio to preview yet.");
  }
  const joined = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}
