import type { RequestResult } from "../../../../api/src/request-results/contracts";
import type { RequestAction } from "@savia/crm-shared/request-page";
import { getCrmRuntime } from "./runtime";
export type PageRun = {
  id: string;
  domainId: string;
  pageName: string;
  actionId: string;
  label: string;
  mode: "mock" | "live";
  status: "running" | "complete" | "failed";
  values: Record<string, unknown>;
  result: RequestResult | null;
  error: string | null;
  createdAt: string;
};
export async function requestPageApi<T>(
  path: string,
  body?: unknown,
): Promise<T> {
  const transport = getCrmRuntime().requestTransport;
  if (!transport)
    throw new Error("Abre esta página desde Savia para conectar sus requests.");
  const response = await transport(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await response.json()) as any;
  if (!response.ok)
    throw new Error(
      data.error?.message ?? data.error ?? "No se pudo completar la operación.",
    );
  return data;
}
export async function executeRequestPageAction(
  pageName: string,
  action: RequestAction,
  values: Record<string, unknown>,
  mode: PageRun["mode"] = "mock",
): Promise<PageRun> {
  return requestPageApi<PageRun>("/runs", {
    id: crypto.randomUUID(),
    domainId: getCrmRuntime().domainId ?? "platform",
    pageName,
    actionId: action.id,
    mode,
    values,
  });
}
