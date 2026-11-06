import { z } from "zod";
import { calendarTimeZoneSchema } from "./calendar-contracts";

export const bookingAgendaRangeSchema = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    timeZone: calendarTimeZoneSchema,
  })
  .strict()
  .refine(({ from, to }) => {
    const duration = Date.parse(to) - Date.parse(from);
    return duration > 0 && duration <= 62 * 86400000;
  }, "The booking agenda range must be positive and at most 62 days");

export const bookingAgendaEntrySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.number().int().positive(),
  tenantSlug: z.string(),
  tenantName: z.string(),
  serviceName: z.string(),
  professionalName: z.string(),
  customerName: z.string(),
  customerEmail: z.string().email(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  timeZone: calendarTimeZoneSchema,
  status: z.literal("confirmed"),
  version: z.number().int().positive(),
  externalEvent: z
    .object({
      provider: z.enum(["google_calendar", "outlook"]),
      id: z.string(),
    })
    .nullable(),
  conference: z
    .object({
      provider: z.enum(["google_meet", "teams", "jitsi", "zoom"]).nullable(),
      joinUrl: z.string().url().nullable(),
      status: z.enum(["ready", "pending", "unsupported", "failed"]),
    })
    .nullable()
    .optional(),
});
export type BookingAgendaEntry = z.infer<typeof bookingAgendaEntrySchema>;
