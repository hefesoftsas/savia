import type { WidgetCollectionSchema, WidgetRecord } from "./types";

const TITLE_FIELD_PRIORITY = ["name", "title", "nombre", "titulo", "label"];

const STATUS_FIELD_PRIORITY = [
  "estado",
  "status",
  "stage",
  "etapa",
  "situacion",
];

const DATE_FIELD_PRIORITY = [
  "fin",
  "vence",
  "due",
  "fecha",
  "date",
  "deadline",
];

function fieldByPriority(
  names: string[],
  priority: string[],
): string | undefined {
  for (const candidate of priority) {
    const match = names.find((name) => name.toLocaleLowerCase() === candidate);
    if (match) return match;
  }
  return undefined;
}

export function autoDetectWidgetConfig(schema: WidgetCollectionSchema): {
  statusField?: string;
  amountField?: string;
  dateField?: string;
} {
  const dropdowns = schema.fields.filter((field) => field.type === "Dropdown");
  const statusField =
    fieldByPriority(
      dropdowns.map((field) => field.name),
      STATUS_FIELD_PRIORITY,
    ) ?? dropdowns[0]?.name;

  const numerics = schema.fields.filter(
    (field) => field.type === "Number" || field.type === "Currency",
  );
  const amountField = numerics[0]?.name;

  const dates = schema.fields.filter(
    (field) =>
      field.type === "DateControl" ||
      field.type === "DateTime" ||
      field.type === "Time",
  );
  const dateField =
    fieldByPriority(
      dates.map((field) => field.name),
      DATE_FIELD_PRIORITY,
    ) ?? dates[0]?.name;

  return {
    ...(statusField ? { statusField } : {}),
    ...(amountField ? { amountField } : {}),
    ...(dateField ? { dateField } : {}),
  };
}

export function recordTitle(
  record: WidgetRecord,
  schema?: WidgetCollectionSchema,
): string {
  const names =
    schema?.fields.map((field) => field.name) ?? Object.keys(record);
  const priority =
    fieldByPriority(names, TITLE_FIELD_PRIORITY) ??
    schema?.fields.find((field) => field.type === "Textbox")?.name ??
    names.find(
      (name) =>
        typeof record[name] === "string" &&
        !["id", "created_at", "updated_at"].includes(name),
    );
  const value = priority ? record[priority] : undefined;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return `Registro ${String(record.id).slice(0, 8)}`;
}

export function recordStatus(
  record: WidgetRecord,
  statusField?: string,
): string | undefined {
  if (!statusField) return undefined;
  const value = record[statusField];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}

export function recordDateLabel(
  record: WidgetRecord,
  dateField?: string,
): string | undefined {
  const raw =
    (dateField ? record[dateField] : undefined) ??
    record.updated_at ??
    record.created_at;
  if (typeof raw !== "string" || !raw) return undefined;
  const date = new Date(raw.length === 10 ? `${raw}T12:00:00` : raw);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(date);
}

export function formatWidgetCount(value: number): string {
  return new Intl.NumberFormat("es-CO").format(value);
}

export function formatWidgetAmount(value: number): string {
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(
    value,
  );
}

export type ActionBucket = "overdue" | "today" | "week";

export type ActionItem = {
  record: WidgetRecord;
  bucket: ActionBucket;
  day: string;
};

function dayOf(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length < 10) return undefined;
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
}

function formatDay(year: number, month: number, day: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function todayDay(now = new Date()): string {
  return formatDay(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function addDays(day: string, amount: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const next = new Date(year, month - 1, date);
  next.setDate(next.getDate() + amount);
  return formatDay(next.getFullYear(), next.getMonth() + 1, next.getDate());
}

/**
 * Buckets records by a date field into overdue / today / coming week.
 * Pure and timezone-safe: compares calendar days, not instants.
 */
export function bucketActionItems(
  records: WidgetRecord[],
  dateField: string,
  today: string = todayDay(),
): ActionItem[] {
  const weekEnd = addDays(today, 7);
  return records
    .flatMap((record) => {
      const day = dayOf(record[dateField]);
      if (!day || day > weekEnd) return [];
      const bucket: ActionBucket =
        day < today ? "overdue" : day === today ? "today" : "week";
      return [{ record, bucket, day }];
    })
    .sort((left, right) => left.day.localeCompare(right.day));
}

export function actionBucketLabel(bucket: ActionBucket): string {
  return bucket === "overdue"
    ? "Vencido"
    : bucket === "today"
      ? "Hoy"
      : "Esta semana";
}
