import { apiFetch, pluginApiFetch } from "./api";
import { getStudioRuntime } from "./runtime";

/** Explicit opt-in only: legacy plugins still receive backend acknowledgements. */
export function pluginRecordFetch<T>(
  path: string,
  init?: RequestInit,
  consistency?: string,
): Promise<T> {
  if (consistency === undefined) return pluginApiFetch<T>(path, init);
  const method = (init?.method ?? "GET").toUpperCase();
  const pathname = path.split("?")[0];
  const segments = pathname.split("/");
  const safeSegment = /^[A-Za-z0-9_-]+$/;
  const metadata = path === "/api/objects" && method === "GET";
  const records =
    segments[1] === "api" &&
    segments[2] === "records" &&
    safeSegment.test(segments[3] ?? "") &&
    ((segments.length === 4 && ["GET", "POST"].includes(method)) ||
      (segments.length === 5 &&
        safeSegment.test(segments[4]) &&
        segments[4] !== "bulk" &&
        ["GET", "PATCH", "DELETE"].includes(method)));
  if (
    consistency !== "local-first" ||
    path.includes("#") ||
    (!metadata && !records)
  )
    return Promise.reject(
      new Error("Local persistence is unavailable for this operation."),
    );
  const workspace = getStudioRuntime().localWorkspace;
  return workspace
    ? apiFetch<T>(path, init, workspace.transport)
    : pluginApiFetch<T>(path, init);
}
