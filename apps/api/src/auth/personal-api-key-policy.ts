import { AuthenticationError } from "./types";
import type { RecordingScope } from "./personal-api-keys";
export function authorizePersonalApiKeyRequest(
  request: Request,
  scopes: readonly RecordingScope[],
): void {
  const path = new URL(request.url).pathname,
    method = request.method;
  let scope: RecordingScope | undefined;
  if (
    method === "GET" &&
    path === "/v1/companion/capabilities" &&
    scopes.length
  )
    return;
  if (method === "GET" && path === "/v1/companion/recordings")
    scope = "recordings:read";
  if (
    method === "POST" &&
    ["/v1/companion/recordings", "/v1/companion/recordings/upload"].includes(
      path,
    )
  )
    scope = "recordings:upload";
  const recording = path.match(
    /^\/v1\/companion\/recordings\/([a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})(\/(?:notes|questions))?$/i,
  );
  if (recording) {
    if (method === "GET" && recording[2] !== "/questions")
      scope = "recordings:read";
    if (method === "DELETE" && !recording[2]) scope = "recordings:delete";
    if (method === "POST" && recording[2]) scope = "recordings:process";
  }
  if (scope && scopes.includes(scope)) return;
  throw new AuthenticationError(
    "INSUFFICIENT_SCOPE",
    scope
      ? `This key does not grant ${scope}`
      : "This operation is not available to personal API keys",
  );
}
