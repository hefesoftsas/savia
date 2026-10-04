import { requiredSessionRecordingScope } from "./recording-scope-policy";
import { AuthenticationError } from "./types";
import { isRecordingScope, type ApiKeyScope } from "./personal-api-keys";
export function authorizePersonalApiKeyRequest(
  request: Request,
  scopes: readonly ApiKeyScope[],
  tenantId?: number,
): void {
  const path = new URL(request.url).pathname,
    method = request.method;
  let scope: ApiKeyScope | undefined =
    requiredSessionRecordingScope(request) ?? undefined;
  if (
    method === "GET" &&
    path === "/v1/companion/capabilities" &&
    scopes.some(isRecordingScope)
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
  // Match only native record operations; adjacent Studio APIs stay unavailable.
  const studio =
    /^(?:\/v1\/(?:studio|dynamic-crm)\/([1-9][0-9]*)|\/v1\/tenants\/([1-9][0-9]*)\/crm)\/api\/(.*)$/.exec(
      path,
    );
  if (studio) {
    const routeTenant = Number(studio[1] ?? studio[2]);
    if (!Number.isSafeInteger(routeTenant) || routeTenant !== tenantId)
      throw new AuthenticationError(
        "INSUFFICIENT_SCOPE",
        "This key is bound to another tenant",
      );
    if (method === "GET" && studio[3] === "objects") scope = "records:read";
    const record =
      /^records\/([a-z][a-z0-9_]{0,47})(?:\/([a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}))?$/.exec(
        studio[3],
      );
    if (record) {
      if (method === "GET") scope = "records:read";
      if (method === "POST" && !record[2]) scope = "records:create";
      if (method === "PATCH" && record[2]) scope = "records:update";
    }
  }
  if (scope && scopes.includes(scope)) return;
  throw new AuthenticationError(
    "INSUFFICIENT_SCOPE",
    scope
      ? `This key does not grant ${scope}`
      : "This operation is not available to personal API keys",
  );
}
