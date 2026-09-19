export type InsurancePolicySnapshot = Record<string, unknown>;

export type InsurancePortfolioSummary = {
  total: number;
  active: number;
  expiring: number;
  premiumTotal: number | null;
  asOf: string;
};

const statusFields = ["estado", "status", "estado_poliza", "policyStatus"];
const expirationFields = [
  "fecha_vencimiento",
  "fechaVencimiento",
  "vencimiento",
  "fin",
  "expirationDate",
  "expiresAt",
];
const premiumFields = ["prima", "premium", "valor_prima", "valorPrima"];
const activeStatuses = new Set([
  "vigente",
  "activa",
  "activo",
  "active",
  "in_force",
  "in-force",
  "en_vigor",
]);

function first(record: InsurancePolicySnapshot, fields: readonly string[]) {
  for (const field of fields) {
    const value = record[field];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function isActive(record: InsurancePolicySnapshot): boolean {
  const value = first(record, statusFields);
  return (
    typeof value === "string" &&
    activeStatuses.has(value.trim().toLocaleLowerCase("es-CO"))
  );
}

function expiration(record: InsurancePolicySnapshot): number | null {
  const value = first(record, expirationFields);
  if (typeof value !== "string" && typeof value !== "number") return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function premium(record: InsurancePolicySnapshot): number | null {
  const value = first(record, premiumFields);
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function summarizeInsurancePortfolio(
  policies: readonly InsurancePolicySnapshot[],
  asOf: string,
): InsurancePortfolioSummary {
  const reference = new Date(asOf).getTime();
  if (!Number.isFinite(reference)) throw new Error("Invalid portfolio asOf timestamp");
  const thirtyDaysLater = reference + 30 * 24 * 60 * 60 * 1000;
  let active = 0;
  let expiring = 0;
  let premiumTotal = 0;
  let hasPremium = false;

  for (const policy of policies) {
    if (!isActive(policy)) continue;
    active += 1;
    const expiresAt = expiration(policy);
    if (expiresAt !== null && expiresAt >= reference && expiresAt <= thirtyDaysLater)
      expiring += 1;
    const policyPremium = premium(policy);
    if (policyPremium !== null) {
      premiumTotal += policyPremium;
      hasPremium = true;
    }
  }

  return {
    total: policies.length,
    active,
    expiring,
    premiumTotal: hasPremium ? premiumTotal : null,
    asOf,
  };
}
