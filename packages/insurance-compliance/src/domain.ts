import { day, text } from "@savia/insurance-workbench/data";
import { duePriority, validateFields } from "@savia/insurance-workbench/schema";
import { fields } from "./fields";
type Row = Record<string, unknown>;
export function expired(record: Row, asOf: string) {
  const until = day(record.valid_until),
    now = day(asOf);
  return until !== null && now !== null && until < now;
}
export function readiness(records: readonly Row[], asOf: string) {
  return {
    total: records.length,
    expired: records.filter((r) => expired(r, asOf)).length,
    ready: records.filter(
      (r) =>
        !expired(r, asOf) &&
        ((r.stage === "approved" && text(r.evidence).trim()) ||
          (r.stage === "waived" &&
            text(r.outcome).trim() &&
            day(r.reviewed_date) !== null)),
    ).length,
  };
}
export function priority(record: Row, asOf: string) {
  if (expired(record, asOf)) return "overdue";
  return duePriority(record, "due_date", ["approved", "waived"], asOf);
}
export function validate(record: Row) {
  const error = validateFields(fields, record);
  if (error) return error;
  if (
    record.valid_until &&
    record.reviewed_date &&
    day(record.valid_until)! < day(record.reviewed_date)!
  )
    return "La validez no puede terminar antes de la revisión.";
  return null;
}
export type ChecklistTemplate = { name: string; requirements: string[] };
export function validateTemplate(template: ChecklistTemplate) {
  if (
    !template.name.trim() ||
    template.name.length > 120 ||
    !template.requirements.length ||
    template.requirements.length > 50 ||
    template.requirements.some((name) => !name.trim() || name.length > 160) ||
    new Set(template.requirements).size !== template.requirements.length
  )
    throw new Error(
      "Indica un nombre y entre 1 y 50 requisitos distintos, de máximo 160 caracteres.",
    );
}
export function checklist(
  template: ChecklistTemplate,
  version: number,
  customer: { id: string; name: string },
  owner: string,
  dueDate: string,
) {
  validateTemplate(template);
  if (
    !customer.id ||
    !customer.name.trim() ||
    !owner.trim() ||
    day(dueDate) === null ||
    !Number.isInteger(version) ||
    version < 1
  )
    throw new Error(
      "Selecciona cliente, responsable y fecha de compromiso válidos.",
    );
  return template.requirements.map((name, index) => ({
    name,
    customer: customer.name,
    customer_id: customer.id,
    owner,
    due_date: dueDate,
    stage: "pending",
    dossier_key: `${customer.id}:${version}:${index}`,
    details: `Plantilla: ${template.name} · versión ${version}`,
  }));
}
