import type { CrmObject } from "@savia/crm-shared/metadata";
import { api } from "./api";
import { getCrmRuntime } from "./runtime";

export function supportsRecordHistory(object: CrmObject) {
  return (
    !object.config.studio?.collection &&
    !["managed-customer", "managed-agency"].includes(
      object.config.studio?.business ?? "",
    )
  );
}
const transports = new WeakMap<object, number>();
let sequence = 0;
export function historyScope() {
  const runtime = getCrmRuntime();
  const identity = runtime.transport ?? runtime;
  if (!transports.has(identity)) transports.set(identity, ++sequence);
  return JSON.stringify([
    runtime.apiBasePath,
    runtime.domainId,
    runtime.localWorkspace?.scope,
    transports.get(identity),
  ]);
}
export function historyRequest<T>(
  path: string,
  signal?: AbortSignal,
  data?: unknown,
) {
  return api<T>(path, data === undefined ? "GET" : "PUT", data, {
    signal,
    cache: "no-store",
  });
}
