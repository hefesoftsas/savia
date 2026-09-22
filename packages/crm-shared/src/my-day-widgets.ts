import { z } from "zod";

export const myDayWidgetKinds = [
  "summary",
  "items",
  "chart",
  "actions",
] as const;

export const myDaySystemWidgetKinds = ["agenda", "quick_task"] as const;

export type MyDayWidgetKind = (typeof myDayWidgetKinds)[number];
export type MyDaySystemWidgetKind = (typeof myDaySystemWidgetKinds)[number];

/** Plugin widgets use `plugin:<extensionId>:<widgetId>`; reserved for phase 3. */
const pluginKindPattern = /^plugin:[a-z0-9_.-]{1,64}:[a-z0-9_-]{1,64}$/;

const widgetIdSchema = z.string().regex(/^[a-z0-9_-]{1,48}$/, {
  message: "El identificador del widget no es válido.",
});

const apiBasePathSchema = z
  .string()
  .regex(
    /^\/v1\/(data-domains\/[a-z][a-z0-9_-]{0,47}|dynamic-crm\/[1-9][0-9]*)$/,
    {
      message: "El dominio del widget no es válido.",
    },
  );

const collectionNameSchema = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/, {
  message: "La colección del widget no es válida.",
});

const fieldNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,47}$/, {
    message: "El campo del widget no es válido.",
  })
  .optional();

export const myDayWidgetConfigSchema = z
  .object({
    statusField: fieldNameSchema,
    amountField: fieldNameSchema,
    dateField: fieldNameSchema,
    groupField: fieldNameSchema,
    limit: z.number().int().min(1).max(10).optional(),
    sort: fieldNameSchema,
    order: z.enum(["ASC", "DESC"]).optional(),
  })
  .strict()
  .optional();

export const myDayCollectionWidgetSchema = z
  .object({
    id: widgetIdSchema,
    apiBasePath: apiBasePathSchema,
    collection: collectionNameSchema,
    kind: z.union([
      z.enum(myDayWidgetKinds),
      z.string().regex(pluginKindPattern),
    ]),
    title: z.string().trim().min(1).max(80).optional(),
    config: myDayWidgetConfigSchema,
    size: z.enum(["sm", "md", "lg"]).optional(),
  })
  .strict();

export const myDaySystemWidgetSchema = z
  .object({
    id: widgetIdSchema,
    kind: z.enum(myDaySystemWidgetKinds),
    title: z.string().trim().min(1).max(80).optional(),
    size: z.enum(["sm", "md", "lg"]).optional(),
  })
  .strict();

export const myDayWidgetSchema = z.union([
  myDayCollectionWidgetSchema,
  myDaySystemWidgetSchema,
]);

export type MyDayWidgetConfig = z.infer<typeof myDayWidgetSchema>;

/** A single widget instance on the My Day board. */
export type MyDayWidget = MyDayWidgetConfig;

export const myDayWidgetsLayoutSchema = z
  .object({
    version: z.literal(1),
    widgets: z.array(myDayWidgetSchema).max(12),
  })
  .strict();

export type MyDayWidgetsLayout = z.infer<typeof myDayWidgetsLayoutSchema>;

export class MyDayWidgetsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MyDayWidgetsError";
  }
}

export function defaultMyDayWidgets(): MyDayWidgetsLayout {
  return {
    version: 1,
    widgets: [
      { id: "agenda", kind: "agenda", size: "lg" },
      { id: "quick_task", kind: "quick_task", size: "md" },
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseMyDayWidgets(value: unknown): MyDayWidgetsLayout {
  if (!isRecord(value)) {
    throw new MyDayWidgetsError("My Day widgets layout is invalid");
  }
  const parsed = myDayWidgetsLayoutSchema.safeParse(value);
  if (!parsed.success) {
    throw new MyDayWidgetsError("My Day widgets layout is invalid");
  }
  const ids = new Set<string>();
  for (const widget of parsed.data.widgets) {
    if (ids.has(widget.id)) {
      throw new MyDayWidgetsError("My Day widget id is duplicated");
    }
    ids.add(widget.id);
  }
  return {
    version: 1,
    widgets: parsed.data.widgets.map((widget) => {
      if (!("apiBasePath" in widget) || !("collection" in widget)) {
        return { ...widget, size: widget.size ?? "md" };
      }
      return {
        ...widget,
        size: widget.size ?? "md",
        config: {
          limit: 5,
          sort: "updated_at",
          order: "DESC" as const,
          ...widget.config,
        },
      };
    }),
  };
}

export function createMyDayWidgetId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let suffix = "";
  for (const byte of bytes) suffix += alphabet[byte % alphabet.length];
  return `w_${suffix}`;
}

export function isMyDaySystemWidget(
  widget: MyDayWidget,
): widget is z.infer<typeof myDaySystemWidgetSchema> {
  return widget.kind === "agenda" || widget.kind === "quick_task";
}

export function isMyDayCollectionWidget(
  widget: MyDayWidget,
): widget is z.infer<typeof myDayCollectionWidgetSchema> {
  return !isMyDaySystemWidget(widget);
}
