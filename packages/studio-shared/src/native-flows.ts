/** Private adapter for Savia Flows' transactional execution mode. */
export interface NativeFlowsCall {
  method: "GET" | "POST" | "PUT";
  path: string;
  body?: unknown;
}

const identifier = "[A-Za-z0-9_:.~-]{1,200}";
const allowed = [
  [
    "GET",
    "^/(workflows|workflow-inbox|workflow-webhook-destinations|workflow-bundles|objects|inventory)$",
  ],
  ["POST", "^/(workflows|workflow-webhook-destinations)$"],
  ["GET", `^/workflows/${identifier}(?:/(executions|webhook))?$`],
  ["PUT", `^/workflows/${identifier}$`],
  [
    "POST",
    `^/workflows/${identifier}/(publish|enabled|start|webhook(?:/rotate)?)$`,
  ],
  ["GET", `^/workflow-executions/${identifier}$`],
  ["POST", `^/workflow-executions/${identifier}/(cancel|retry)$`],
  ["POST", `^/workflow-inbox/${identifier}/resolve$`],
  ["PUT", `^/workflow-webhook-destinations/${identifier}$`],
  ["POST", `^/workflow-webhook-destinations/${identifier}/(secret|enabled)$`],
  ["POST", `^/workflow-bundles/${identifier}/prepare$`],
] as const;

export function isNativeFlowsCall(value: unknown): value is NativeFlowsCall {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const call = value as Record<string, unknown>;
  if (
    Object.keys(call).some((key) => !["method", "path", "body"].includes(key))
  )
    return false;
  if (typeof call.path !== "string" || typeof call.method !== "string")
    return false;
  if (call.method === "GET" && call.body !== undefined) return false;
  if (call.path.includes("..") || call.path.includes("%")) return false;
  return allowed.some(
    ([method, pattern]) =>
      method === call.method && new RegExp(pattern).test(call.path as string),
  );
}
