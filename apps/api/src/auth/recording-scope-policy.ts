import type { RecordingScope } from "./personal-api-keys";

const RECORDING_READ_SCOPE = "recordings:read" as const;
const RECORDING_UPLOAD_SCOPE = "recordings:upload" as const;
const RECORDING_PROCESS_SCOPE = "recordings:process" as const;
const RECORDING_DELETE_SCOPE = "recordings:delete" as const;

/** Narrow allowlist for bounded long-recording session operations. */
export function requiredSessionRecordingScope(
  request: Request,
): RecordingScope | null {
  const path = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  if (path === "/v1/companion/sessions") {
    if (method === "GET") return RECORDING_READ_SCOPE;
    if (method === "POST") return RECORDING_UPLOAD_SCOPE;
    return null;
  }
  const match = path.match(
    /^\/v1\/companion\/sessions\/[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?:\/(audio|chunks|finalize|notes|cancel|questions)(?:\/(microphone|system)\/(0|[1-9][0-9]{0,2}))?)?$/i,
  );
  if (!match) return null;
  const action = match[1];
  if (
    method === "GET" &&
    (!action ||
      action === "audio" ||
      (action === "chunks" && match[2] && Number(match[3]) < 120))
  )
    return RECORDING_READ_SCOPE;
  if (method === "PATCH" && !action) return RECORDING_UPLOAD_SCOPE;
  if (method === "DELETE" && !action) return RECORDING_DELETE_SCOPE;
  if (method === "POST" && !match[2]) {
    if (action === "chunks" || action === "finalize")
      return RECORDING_UPLOAD_SCOPE;
    if (action === "notes" || action === "cancel" || action === "questions")
      return RECORDING_PROCESS_SCOPE;
  }
  return null;
}

/** Returns a recording-specific scope only for the Companion operations it owns. */
export function requiredRecordingScope(
  request: Request,
): RecordingScope | null {
  const sessionScope = requiredSessionRecordingScope(request);
  if (sessionScope) return sessionScope;
  const path = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  if (method === "GET" && path === "/v1/companion/capabilities")
    return RECORDING_READ_SCOPE;
  if (method === "GET" && path === "/v1/companion/session")
    return RECORDING_READ_SCOPE;
  if (method === "GET" && path === "/v1/companion/recordings")
    return RECORDING_READ_SCOPE;
  if (method === "POST" && path === "/v1/companion/recordings")
    return RECORDING_UPLOAD_SCOPE;
  if (method === "POST" && path === "/v1/companion/recordings/upload")
    return RECORDING_UPLOAD_SCOPE;
  const recording = path.match(
    /^\/v1\/companion\/recordings\/[a-f0-9-]{36}(?:\/(notes|questions))?$/i,
  );
  if (!recording) return null;
  if (method === "GET" && recording[1] !== "questions")
    return RECORDING_READ_SCOPE;
  if (
    method === "POST" &&
    (recording[1] === "notes" || recording[1] === "questions")
  )
    return RECORDING_PROCESS_SCOPE;
  return null;
}
