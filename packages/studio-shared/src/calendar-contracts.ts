import { z } from "zod";

export const calendarLimits = {
  maxSources: 20,
  maxBytes: 1024 * 1024,
  maxEvents: 2000,
  maxDays: 62,
  maxRecurrenceSteps: 100000,
  maxProviderPages: 20,
  maxRedirects: 3,
  fetchTimeoutMs: 10000,
  freshnessMs: 5 * 60 * 1000,
} as const;
export const calendarColors = [
  "blue",
  "emerald",
  "violet",
  "amber",
  "rose",
  "slate",
] as const;
export type CalendarColor = (typeof calendarColors)[number];
export const calendarTimeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "The calendar timezone is invalid");
const metadata = {
  name: z.string().trim().min(1).max(100),
  color: z.enum(calendarColors).default("blue"),
  timeZone: calendarTimeZoneSchema.default("UTC"),
};
export const createCalendarSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("subscription"),
      ...metadata,
      url: z.string().trim().min(1).max(4096),
    })
    .strict(),
  z
    .object({
      kind: z.literal("import"),
      ...metadata,
      content: z.string().min(1).max(calendarLimits.maxBytes),
    })
    .strict(),
]);
export type CreateCalendarSourceInput = z.input<
  typeof createCalendarSourceSchema
>;
export const updateCalendarSourceSchema = z
  .object({
    name: metadata.name.optional(),
    color: z.enum(calendarColors).optional(),
    timeZone: calendarTimeZoneSchema.optional(),
    visible: z.boolean().optional(),
  })
  .strict();
export type UpdateCalendarSourceInput = z.infer<
  typeof updateCalendarSourceSchema
>;
export const calendarSourceSchema = z.object({
  id: z.string(),
  kind: z.enum(["subscription", "import"]),
  ...metadata,
  visible: z.boolean(),
  hostname: z.string().nullable(),
  lastSyncedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CalendarSource = z.infer<typeof calendarSourceSchema>;
export const calendarOccurrenceSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  title: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  allDay: z.boolean(),
  busy: z.boolean().optional(),
  webLink: z.string().nullable(),
  timeZone: z.string(),
});
export type CalendarOccurrence = z.infer<typeof calendarOccurrenceSchema>;
export const calendarSourceEventsSchema = z.object({
  data: z.array(calendarOccurrenceSchema),
  stale: z.boolean(),
  error: z.string().nullable(),
  lastSyncedAt: z.string().nullable(),
});
export type CalendarSourceEvents = z.infer<typeof calendarSourceEventsSchema>;
export const calendarPreferencesSchema = z
  .object({
    google_calendar: z.boolean().default(true),
    outlook: z.boolean().default(true),
  })
  .strict();
export type CalendarPreferences = z.infer<typeof calendarPreferencesSchema>;
export const calendarRangeSchema = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    timeZone: calendarTimeZoneSchema.default("UTC"),
    refresh: z.enum(["true", "false"]).optional(),
  })
  .refine(({ from, to }) => {
    const duration = Date.parse(to) - Date.parse(from);
    return duration > 0 && duration <= calendarLimits.maxDays * 86400000;
  }, "The calendar range must be positive and at most 62 days");
export type CalendarRange = {
  from: string;
  to: string;
  timeZone: string;
  refresh?: boolean;
};
