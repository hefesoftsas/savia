import { requestResultSchema, type RequestResult } from "./contracts";
type RecordValue = Record<string, unknown>;
export type FlowDescriptor = {
  id: string;
  provider?: string;
  kind?: string;
  name?: string;
};
export type RunResult = {
  id: string;
  flowId: string;
  versionId: string | null;
  createdAt: string;
  mode: "mock" | "live";
  status: string;
  result: RecordValue | null;
  steps: Array<{ httpStatus?: number; responseJson?: unknown }>;
  error?: string;
};
const record = (value: unknown): RecordValue | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
const sensitive =
  /(?:password|passwd|nomusu|authorization|cookie|secret|token|session|sesion|api.?key|username|credential)/i;
export function safeFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeFields);
  const object = record(value);
  if (object)
    return Object.fromEntries(
      Object.entries(object)
        .filter(([key]) => !sensitive.test(key))
        .map(([key, item]) => [key, safeFields(item)]),
    );
  return value;
}
export interface ResultNormalizer {
  id: string;
  matches(flow: FlowDescriptor): boolean;
  normalize(flow: FlowDescriptor, run: RunResult): RequestResult;
}
export function normalizeResult(
  flow: FlowDescriptor,
  run: RunResult,
  normalizers: readonly ResultNormalizer[] = [],
): RequestResult {
  const adapter = normalizers.find((candidate) => candidate.matches(flow));
  if (adapter) return requestResultSchema.parse(adapter.normalize(flow, run));
  const raw =
    run.result && Object.hasOwn(run.result, "response")
      ? run.result.response
      : (run.result ?? run.steps.at(-1)?.responseJson ?? null);
  return requestResultSchema.parse({
    schemaVersion: "1.0",
    type: "request",
    status:
      run.status === "running"
        ? "pending"
        : run.status === "success"
          ? "success"
          : "error",
    data: { result: safeFields(raw) },
    warnings: [],
    errors:
      run.status === "running" || run.status === "success"
        ? []
        : [
            {
              code: "PROVIDER_EXECUTION_FAILED",
              message:
                "La operación no se completó. Consulta la ejecución original.",
              field: null,
            },
          ],
    metadata: {
      provider: flow.provider ?? null,
      flowId: flow.id,
      runId: run.id,
      versionId: run.versionId,
      createdAt: run.createdAt,
      simulated: run.mode === "mock",
      adapter: null,
      providerFields: {},
    },
  });
}

export function resultError(code: string, message: string): RequestResult {
  return requestResultSchema.parse({
    schemaVersion: "1.0",
    type: "unknown",
    status: "error",
    data: null,
    errors: [{ code, message, field: null }],
    warnings: [],
    metadata: {
      provider: null,
      flowId: null,
      runId: null,
      versionId: null,
      createdAt: null,
      simulated: null,
      adapter: null,
      providerFields: {},
    },
  });
}
