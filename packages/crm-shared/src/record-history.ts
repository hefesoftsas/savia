import { z } from "zod";

export const recordHistorySettingsSchema = z
  .object({
    enabled: z.boolean(),
    fields: z
      .array(
        z
          .string()
          .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
          .max(128),
      )
      .max(50),
    retentionDays: z.number().int().min(1).max(365).default(90),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.fields).size !== value.fields.length)
      ctx.addIssue({
        code: "custom",
        message: "History fields must be unique.",
      });
    if (value.enabled && !value.fields.length)
      ctx.addIssue({
        code: "custom",
        message: "Choose at least one history field.",
      });
  });
export type RecordHistorySettings = z.infer<typeof recordHistorySettingsSchema>;
export const defaultRecordHistorySettings: RecordHistorySettings = {
  enabled: false,
  fields: [],
  retentionDays: 90,
};
const types = new Set([
  "Textbox",
  "Textarea",
  "Email",
  "Phone",
  "Url",
  "Address",
  "Number",
  "Currency",
  "Dropdown",
  "Autocomplete",
  "Toggle",
  "DateControl",
  "DateTime",
  "Time",
]);
export function isHistoryField(
  name: string,
  field:
    | {
        type: string;
        hidden?: boolean;
        readOnly?: boolean;
        readable?: boolean;
        config?: Record<string, unknown>;
      }
    | undefined,
): boolean {
  if (
    !field ||
    /^(id|_.*|created_at|createdAt|updated_at|updatedAt|deleted_at|deletedAt|created_by|createdBy|updated_by|updatedBy|constructor|prototype)$/.test(
      name,
    )
  )
    return false;
  const c = field.config;
  return (
    types.has(field.type) &&
    !field.hidden &&
    !field.readOnly &&
    field.readable !== false &&
    !c?.sensitive &&
    !c?.formula &&
    !c?.relation &&
    !c?.collectionRelation &&
    !c?.collectionRelationTarget &&
    !c?.multiple &&
    c?.readable !== false
  );
}
export type RecordHistoryEntry = {
  version: number;
  action: "created" | "updated" | "deleted" | "restored";
  createdAt: string;
  actor: {
    kind: "user" | "workflow" | "public-form" | "system";
    id: string | null;
    causeId: string | null;
  };
  fields: string[];
};
export type HistoryScalar = string | number | boolean | null;
export type RecordHistoryDetail = RecordHistoryEntry & {
  changes: Record<
    string,
    {
      before?: HistoryScalar;
      after?: HistoryScalar;
      beforeTruncated?: boolean;
      afterTruncated?: boolean;
    }
  >;
};
export type RecordHistoryPage = {
  data: RecordHistoryEntry[];
  nextCursor: string | null;
  enabled: boolean;
  retentionDays: number;
};
