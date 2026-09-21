import type { RequestVariable } from "./types";

export type TransferVariable = {
  key: string;
  value: string;
  secret: boolean;
};

export type TransferFlow = {
  flowId: string;
  variables: TransferVariable[];
};

export type SecretsFile = {
  version: 1;
  exportedAt: string;
  flows: TransferFlow[];
};

const KEY_PATTERN = /^[\w.-]{1,120}$/;
const MAX_FLOWS = 200;
const MAX_VARIABLES_PER_FLOW = 150;

export function buildSecretsFile(
  flows: TransferFlow[],
  exportedAt = new Date().toISOString(),
): string {
  const sorted = [...flows]
    .map((flow) => ({
      flowId: flow.flowId,
      variables: [...flow.variables]
        .map((variable) => ({
          key: variable.key,
          value: variable.value,
          secret: variable.secret,
        }))
        .sort((left, right) => left.key.localeCompare(right.key)),
    }))
    .sort((left, right) => left.flowId.localeCompare(right.flowId));
  return JSON.stringify(
    { version: 1, exportedAt, flows: sorted } satisfies SecretsFile,
    null,
    2,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseVariable(value: unknown): TransferVariable {
  if (
    !isRecord(value) ||
    typeof value.key !== "string" ||
    !KEY_PATTERN.test(value.key)
  )
    throw new Error(
      `Variable inválida: clave «${String(isRecord(value) ? value.key : value)}».`,
    );
  if (typeof value.value !== "string" || typeof value.secret !== "boolean")
    throw new Error(
      `Variable inválida: «${value.key}» debe tener value (texto) y secret (booleano).`,
    );
  return { key: value.key, value: value.value, secret: value.secret };
}

function parseFlow(value: unknown): TransferFlow {
  if (!isRecord(value) || typeof value.flowId !== "string" || !value.flowId)
    throw new Error("Cada flow debe tener un flowId no vacío.");
  if (!Array.isArray(value.variables))
    throw new Error(
      `El flow «${value.flowId}» debe traer una lista de variables.`,
    );
  if (value.variables.length > MAX_VARIABLES_PER_FLOW)
    throw new Error(`El flow «${value.flowId}» supera el máximo de variables.`);
  const variables = value.variables.map(parseVariable);
  if (
    new Set(variables.map((variable) => variable.key)).size !== variables.length
  )
    throw new Error(`El flow «${value.flowId}» tiene claves duplicadas.`);
  return { flowId: value.flowId, variables };
}

/**
 * Lee un archivo de secretos generado por la UI. Acepta el formato
 * `{ version, exportedAt, flows }` y, por compatibilidad, `{ flows }`.
 */
export function parseSecretsFile(text: string): SecretsFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("El archivo no es un JSON válido.");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.flows))
    throw new Error("El archivo debe contener una lista de flows.");
  if (parsed.version !== undefined && parsed.version !== 1)
    throw new Error("Versión de archivo no soportada.");
  if (parsed.flows.length < 1 || parsed.flows.length > MAX_FLOWS)
    throw new Error("El archivo no contiene flows válidos.");
  const flows = parsed.flows.map(parseFlow);
  if (new Set(flows.map((flow) => flow.flowId)).size !== flows.length)
    throw new Error("El archivo tiene flows duplicados.");
  const exportedAt =
    typeof parsed.exportedAt === "string" && parsed.exportedAt
      ? parsed.exportedAt
      : new Date().toISOString();
  return { version: 1, exportedAt, flows };
}

export type MergeResult = {
  merged: RequestVariable[];
  applied: number;
  skippedEmpty: number;
};

/**
 * Mezcla variables importadas sobre las actuales sin borrar nada: los valores
 * no vacíos del archivo ganan; los vacíos conservan el valor de destino.
 */
export function mergeVariables(
  current: RequestVariable[],
  imported: TransferVariable[],
): MergeResult {
  const merged = current.map((variable) => ({ ...variable }));
  let applied = 0;
  let skippedEmpty = 0;
  for (const variable of imported) {
    if (!variable.value) {
      skippedEmpty += 1;
      continue;
    }
    const index = merged.findIndex(
      (candidate) => candidate.key === variable.key,
    );
    if (index >= 0) {
      merged[index] = {
        ...merged[index]!,
        value: variable.value,
        secret: variable.secret,
      };
    } else {
      merged.push({
        key: variable.key,
        value: variable.value,
        secret: variable.secret,
      });
    }
    applied += 1;
  }
  return { merged, applied, skippedEmpty };
}

/** Elige la entrada del archivo que aplica al flow actual. */
export function pickFlowEntry(file: SecretsFile, flowId: string): TransferFlow {
  const exact = file.flows.find((flow) => flow.flowId === flowId);
  if (exact) return exact;
  if (file.flows.length === 1 && file.flows[0]) return file.flows[0];
  throw new Error("El archivo no contiene secretos para este flow.");
}

export function transferFileName(
  scope: string,
  exportedAt = new Date().toISOString(),
): string {
  const safe =
    scope
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "secretos";
  const day = exportedAt.slice(0, 10);
  return `savia-request-secretos-${safe}-${day}.json`;
}

export function downloadJsonFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
