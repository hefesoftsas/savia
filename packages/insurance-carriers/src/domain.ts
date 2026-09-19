export const operations = [
  { value: "policy-status", label: "Consultar estado de póliza" },
  { value: "documents", label: "Solicitar documentos" },
  { value: "request-issuance", label: "Solicitar emisión" },
] as const;
export type CarrierIntent = {
  operation: string;
  policy: string;
  carrier: string;
  connectionId: string;
  operationKey: string;
};
export function createIntent(
  operation: string,
  policy: string,
  carrier: string,
  connectionId: string,
  operationKey: string,
): CarrierIntent {
  if (
    !operations.some((item) => item.value === operation) ||
    !policy.trim() ||
    policy.length > 200 ||
    !carrier.trim() ||
    carrier.length > 200 ||
    !connectionId.trim() ||
    operationKey.length < 8 ||
    operationKey.length > 200
  )
    throw Error(
      "Completa operación, referencia, aseguradora y conexión válidas.",
    );
  return {
    operation,
    policy: policy.trim(),
    carrier: carrier.trim(),
    connectionId,
    operationKey,
  };
}
export function parseIntent(payload: unknown): CarrierIntent {
  if (typeof payload !== "string") throw Error("Solicitud guardada no válida.");
  const value: unknown = JSON.parse(payload);
  if (!value || typeof value !== "object")
    throw Error("Solicitud guardada no válida.");
  const record = value as Record<string, unknown>;
  for (const key of [
    "operation",
    "policy",
    "carrier",
    "connectionId",
    "operationKey",
  ])
    if (typeof record[key] !== "string")
      throw Error("Solicitud guardada no válida.");
  return createIntent(
    record.operation as string,
    record.policy as string,
    record.carrier as string,
    record.connectionId as string,
    record.operationKey as string,
  );
}
