import type { RecordingScope } from "./personal-api-keys";

const RECORDING_READ_SCOPE = "recordings:read" as const;
const RECORDING_UPLOAD_SCOPE = "recordings:upload" as const;
const RECORDING_PROCESS_SCOPE = "recordings:process" as const;

/** Returns a recording-specific scope only for the Companion operations it owns. */
export function requiredRecordingScope(
  request: Request,
): RecordingScope | null {
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
