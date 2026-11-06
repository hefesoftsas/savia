import { z } from "zod";
import {
  accessGrantSchema,
  accessPolicySchema,
  type AccessGrant,
  type AccessPolicy,
  type AccessPredicate,
} from "@savia/studio-shared/access-control";
export const collection = "insurance_customer_portal";
export const policyFields = [
  "name",
  "inicio",
  "fin",
  "prima",
  "estado",
  "cliente",
];
export const createFields = [
  "name",
  "customer_id",
  "kind",
  "details",
  "policy_reference",
  "stage",
  "response",
  "response_date",
];
export const readFields = [...createFields];
export type Grant = Omit<AccessGrant, "id" | "roleId">;
export function blueprint(customerId: string): Grant[] {
  if (
    !customerId.trim() ||
    customerId !== customerId.trim() ||
    customerId.length > 200
  )
    throw new Error(
      "Indica el identificador exacto del cliente (máximo 200 caracteres).",
    );
  const customer = (): AccessPredicate => ({
    field: "customer_id",
    op: "eq",
    value: { literal: customerId },
  });
  const grants: Grant[] = [
    {
      resource: "collection:polizas",
      action: "read",
      predicate: { field: "cliente", op: "eq", value: { literal: customerId } },
      fields: policyFields,
    },
    {
      resource: "page:polizas",
      action: "read",
      predicate: { all: true },
      fields: [],
    },
    {
      resource: `collection:${collection}`,
      action: "read",
      predicate: customer(),
      fields: readFields,
    },
    {
      resource: `collection:${collection}`,
      action: "create",
      predicate: {
        and: [
          customer(),
          { field: "stage", op: "eq", value: { literal: "received" } },
          { field: "response", op: "eq", value: { literal: null } },
          { field: "response_date", op: "eq", value: { literal: null } },
        ],
      },
      fields: createFields,
    },
    {
      resource: `collection:${collection}`,
      action: "update",
      predicate: customer(),
      fields: [],
    },
    {
      resource: `page:${collection}`,
      action: "read",
      predicate: { all: true },
      fields: [],
    },
  ];
  return grants.map((g) =>
    accessGrantSchema.omit({ id: true, roleId: true }).parse(g),
  );
}
function canonical(value: unknown): string {
  if (Array.isArray(value))
    return "[" + value.map(canonical).sort().join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => JSON.stringify(key) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
/** This is a fail-closed configuration gate. Native backend ACL remains the security boundary. */
export function verifyAccess(raw: AccessPolicy | null | undefined): string {
  const parsed = accessPolicySchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      "Tu acceso al portal aún no está habilitado. Solicita a tu asesor que revise tus permisos.",
    );
  const policy = parsed.data;
  const read = policy.grants.find(
    (g) => g.resource === "collection:polizas" && g.action === "read",
  );
  const p = read?.predicate;
  if (
    !p ||
    !("field" in p) ||
    p.field !== "cliente" ||
    p.op !== "eq" ||
    !("literal" in p.value) ||
    typeof p.value.literal !== "string"
  )
    throw new Error("El portal requiere permisos individuales por cliente.");
  const id = p.value.literal;
  const expected = blueprint(id).map(canonical);
  const actual = policy.grants.map(({ id, roleId, ...g }) => canonical(g));
  if (
    actual.length !== expected.length ||
    expected.some((g) => !actual.includes(g))
  )
    throw new Error(
      "Los permisos actuales no corresponden a un acceso exclusivo de cliente. Pide a tu asesor que revise la configuración.",
    );
  return id;
}
const inputSchema = z
  .object({
    name: z.string().trim().min(3).max(160),
    kind: z.enum(["query", "certificate", "data_update", "complaint", "claim"]),
    details: z.string().trim().min(10).max(6000),
    policy_reference: z.string().trim().max(200),
  })
  .strict();
export function requestInput(customerId: string, input: unknown) {
  blueprint(customerId);
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(
      "Completa un asunto de 3 a 160 caracteres y una descripción de 10 a 6.000 caracteres. Selecciona un tipo válido.",
    );
  return { ...parsed.data, customer_id: customerId, stage: "received" };
}
export const statusLabels: Record<string, string> = {
  received: "Recibida",
  in_progress: "En revisión",
  waiting: "Esperando información",
  resolved: "Respondida",
  cancelled: "Cancelada",
};
