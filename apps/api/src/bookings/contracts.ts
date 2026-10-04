import { z } from "@hono/zod-openapi";
const id = z.string().uuid();
const clock = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
  .refine(
    (v) => Number(v.slice(3)) % 5 === 0,
    "Times use five-minute increments.",
  );
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(`${v}T00:00:00Z`)) &&
      new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v,
  );
const zone = z
  .string()
  .max(100)
  .refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, "Use an IANA time zone.");
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v), "Use plain text.");
export const periodSchema = z
  .object({ day: z.number().int().min(0).max(6), start: clock, end: clock })
  .strict()
  .refine((v) => v.start < v.end, "The end must follow the start.");
export const exceptionSchema = z
  .object({
    date,
    periods: z
      .array(
        z
          .object({ start: clock, end: clock })
          .strict()
          .refine((v) => v.start < v.end),
      )
      .max(4),
  })
  .strict();
export const professionalSchema = z
  .object({
    id,
    principalId: z.string().min(1).max(200),
    enabled: z.boolean(),
    weekly: z.array(periodSchema).max(28),
    exceptions: z.array(exceptionSchema).max(200),
  })
  .strict();
export const serviceSchema = z
  .object({
    id,
    name: text(120).min(1),
    description: text(1000),
    durationMinutes: z.number().int().min(5).max(480).multipleOf(5),
    bufferMinutes: z.number().int().min(0).max(120).multipleOf(5),
    enabled: z.boolean(),
    professionalIds: z.array(id).max(50),
  })
  .strict();
export const settingsSchema = z
  .object({
    version: z.number().int().min(0),
    enabled: z.boolean(),
    published: z.boolean(),
    title: text(120).min(1),
    description: text(1000),
    conferenceProvider: z.enum(["automatic", "jitsi"]).default("automatic"),
    timeZone: zone,
    leadMinutes: z.number().int().min(0).max(43200),
    horizonDays: z.number().int().min(1).max(180),
    cancellationMinutes: z.number().int().min(0).max(43200),
    reminderMinutes: z.number().int().min(0).max(43200),
    services: z.array(serviceSchema).max(30),
    professionals: z.array(professionalSchema).max(50),
  })
  .strict()
  .superRefine((v, c) => {
    const fail = (message: string) => c.addIssue({ code: "custom", message });
    if (
      new Set(v.services.map((s) => s.id)).size !== v.services.length ||
      new Set(v.professionals.map((p) => p.id)).size !==
        v.professionals.length ||
      new Set(v.professionals.map((p) => p.principalId)).size !==
        v.professionals.length
    )
      fail("Services and professionals must be unique.");
    for (const s of v.services)
      if (
        new Set(s.professionalIds).size !== s.professionalIds.length ||
        s.professionalIds.some((i) => !v.professionals.some((p) => p.id === i))
      )
        fail("Select configured professionals.");
    for (const p of v.professionals) {
      if (new Set(p.exceptions.map((e) => e.date)).size !== p.exceptions.length)
        fail("Use one exception per date.");
      const groups = [
        ...Array.from({ length: 7 }, (_, d) =>
          p.weekly.filter((w) => w.day === d),
        ),
        ...p.exceptions.map((e) => e.periods),
      ];
      for (const periods of groups) {
        const sorted = [...periods].sort((a, b) =>
          a.start.localeCompare(b.start),
        );
        if (sorted.some((r, i) => i > 0 && r.start < sorted[i - 1].end))
          fail("Availability periods cannot overlap.");
      }
    }
    if (
      v.published &&
      (!v.enabled ||
        !v.services.some(
          (s) =>
            s.enabled &&
            s.professionalIds.some((i) =>
              v.professionals.some((p) => p.id === i && p.enabled),
            ),
        ))
    )
      fail("Enable a service and an assigned professional before publishing.");
  });
export type BookingSettings = z.infer<typeof settingsSchema>;
export type BookingProfessional = z.infer<typeof professionalSchema>;
export type BookingService = z.infer<typeof serviceSchema>;
export type BusyInterval = { start: string; end: string };
export const bookingConferenceSchema = z.object({
  provider: z.enum(["google_meet", "teams", "jitsi", "zoom"]).nullable(),
  joinUrl: z.string().url().nullable(),
  status: z.enum(["ready", "pending", "unsupported", "failed"]),
});
export type BookingConference = z.infer<typeof bookingConferenceSchema>;
export const reservationSchema = z.object({
  id,
  serviceId: id,
  professionalId: id,
  serviceName: z.string(),
  professionalName: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  customerName: z.string(),
  customerEmail: z.string(),
  status: z.enum(["confirmed", "cancelled"]),
  version: z.number(),
  deliveryStatus: z.string(),
  calendarStatus: z.string(),
  canGenerateConference: z.boolean().optional(),
  availableConferenceProviders: z.array(z.enum(["auto", "zoom"])).optional(),
  conference: bookingConferenceSchema.nullable().optional(),
});
export const managementBootstrapSchema = z.object({
  reservation: reservationSchema,
  publicUrl: z.string().nullable(),
  timeZone: zone,
  cancellationMinutes: z.number().int().nonnegative(),
  horizonDays: z.number().int().positive(),
  leadMinutes: z.number().int().nonnegative(),
  canReschedule: z.boolean(),
});
export type Reservation = z.infer<typeof reservationSchema>;
export const publicBookingSchema = z
  .object({
    serviceId: id,
    professionalId: id.optional(),
    customerLocale: z.enum(["en", "es", "pt"]).default("en"),
    startsAt: z.string().datetime({ offset: true }),
    customerName: text(120).min(1),
    customerEmail: z.string().trim().email().max(254),
    captchaToken: z.string().max(16000).default(""),
  })
  .strict();
export const bootstrapSchema = z.object({
  agenda: z.object({
    enabled: z.boolean(),
    sourceCount: z.number().int().min(0),
  }),
  settings: settingsSchema,
  candidates: z.array(
    z.object({ principalId: z.string(), displayName: z.string() }),
  ),
  canManage: z.boolean(),
  principalId: z.string(),
  publicUrl: z.string().nullable(),
  calendar: z.object({
    provider: z.enum(["google_calendar", "outlook"]).nullable(),
    status: z.string(),
    conferenceProvider: z.enum(["auto", "zoom"]).default("auto"),
    zoomStatus: z.enum(["connected", "not_connected", "reconnect_required"]),
  }),
});
export const revisionSchema = z
  .object({ version: z.number().int().positive() })
  .strict();
export const conferenceRequestSchema = revisionSchema.extend({
  provider: z.enum(["auto", "zoom"]).default("auto"),
});
export const slotQuerySchema = z.object({
  serviceId: id,
  professionalId: id,
  date,
});
export const ownAvailabilitySchema = z
  .object({
    version: z.number().int().positive(),
    weekly: z.array(periodSchema).max(28),
    exceptions: z.array(exceptionSchema).max(200),
  })
  .strict();
export const calendarGrantSchema = z
  .object({
    provider: z.enum(["google_calendar", "outlook"]).nullable(),
    conferenceProvider: z.enum(["auto", "zoom"]).optional(),
  })
  .strict();
export const agendaGrantSchema = z.object({ enabled: z.boolean() }).strict();
export function defaultSettings(title: string): BookingSettings {
  return {
    version: 0,
    enabled: false,
    published: false,
    title,
    description: "",
    conferenceProvider: "automatic",
    timeZone: "America/Bogota",
    leadMinutes: 60,
    horizonDays: 60,
    cancellationMinutes: 120,
    reminderMinutes: 1440,
    services: [],
    professionals: [],
  };
}

export const bookingLinkScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("team") }).strict(),
  z.object({ kind: z.literal("professional"), professionalId: id }).strict(),
]);
export const bookingPublicLinkInputSchema = z
  .object({
    scope: bookingLinkScopeSchema,
    serviceId: id.nullable().default(null),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
    dailyLimit: z.number().int().min(1).max(1000).default(25),
  })
  .strict();
export type BookingLinkScope = z.infer<typeof bookingLinkScopeSchema>;
export type ResolvedBookingLink = {
  id: string;
  tenantId: number;
  publicToken: string;
  scope: BookingLinkScope;
  serviceId: string | null;
  dailyLimit: number;
  settings: BookingSettings;
  legacy: boolean;
};
export const publicSlotQuerySchema = slotQuerySchema.extend({
  professionalId: id.optional(),
});
export const availabilityRangeQuerySchema = z
  .object({
    serviceId: id,
    professionalId: id.optional(),
    from: date,
    to: date,
    displayTimeZone: zone.optional(),
  })
  .refine(
    (v) =>
      v.to >= v.from && (Date.parse(v.to) - Date.parse(v.from)) / 86400000 < 31,
    "Choose a range of at most 31 dates.",
  );
export type AvailabilityRangeQuery = z.infer<
  typeof availabilityRangeQuerySchema
>;
export const availabilityRangeSchema = z.object({
  displayTimeZone: zone,
  businessTimeZone: zone,
  days: z.array(
    z.object({
      date,
      slots: z.array(z.object({ startsAt: z.string(), endsAt: z.string() })),
    }),
  ),
});
export type AvailabilityRange = z.infer<typeof availabilityRangeSchema>;
