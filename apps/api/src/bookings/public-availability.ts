import { HTTPException } from "hono/http-exception";
import {
  availabilityRangeQuerySchema,
  type AvailabilityRangeQuery,
  type AvailabilityRange,
  type ResolvedBookingLink,
  type BusyInterval,
} from "./contracts";
import { assertBookingLinkSelection } from "./public-links";
import { dateInZone, slotsForDate } from "./domain";
export type PublicAvailabilityDependencies = {
  now: () => number;
  loadBusy: (
    principalId: string,
    from: string,
    to: string,
  ) => Promise<BusyInterval[]>;
};
const day = 86400000;
/** Generate a range once, then regroup UTC identities into the declared display zone. */
export async function getPublicAvailability(
  link: ResolvedBookingLink,
  input: AvailabilityRangeQuery,
  deps: PublicAvailabilityDependencies,
): Promise<AvailabilityRange> {
  const parsed = availabilityRangeQuerySchema.safeParse(input);
  if (!parsed.success)
    throw new HTTPException(422, {
      message: "Choose a valid time zone and a range of at most 31 dates.",
    });
  const query = parsed.data,
    selection = assertBookingLinkSelection(
      link,
      query.serviceId,
      query.professionalId,
    );
  const displayTimeZone = query.displayTimeZone ?? link.settings.timeZone,
    now = deps.now();
  const first = Date.parse(query.from + "T00:00:00Z"),
    last = Date.parse(query.to + "T00:00:00Z");
  if (
    first < now - 35 * day ||
    first > now + (link.settings.horizonDays + 32) * day
  )
    throw new HTTPException(422, {
      message: "Choose a date in the booking horizon.",
    });
  const days: AvailabilityRange["days"] = Array.from(
    { length: Math.round((last - first) / day) + 1 },
    (_, i) => ({
      date: new Date(first + i * day).toISOString().slice(0, 10),
      slots: [],
    }),
  );
  const output = {
    displayTimeZone,
    businessTimeZone: link.settings.timeZone,
    days,
  };
  const professional = link.settings.professionals.find(
    (p) => p.id === selection.professionalId,
  )!;
  const service = link.settings.services.find(
    (s) => s.id === selection.serviceId,
  )!;
  // ±36h covers the full range of IANA offsets and adjacent business dates;
  // trailing duration/buffer is included when querying occupied intervals.
  const from = new Date(first - 36 * 3600000).toISOString();
  const to = new Date(
    last +
      36 * 3600000 +
      (service.durationMinutes + service.bufferMinutes) * 60000,
  ).toISOString();
  if (
    Date.parse(to) < now + link.settings.leadMinutes * 60000 ||
    Date.parse(from) > now + link.settings.horizonDays * day
  )
    return output;
  const busy = await deps.loadBusy(professional.principalId, from, to);
  const buckets = new Map(days.map((d) => [d.date, d.slots]));
  const businessStart = Date.parse(
    dateInZone(from, link.settings.timeZone) + "T00:00:00Z",
  );
  const businessEnd = Date.parse(
    dateInZone(to, link.settings.timeZone) + "T00:00:00Z",
  );
  for (let date = businessStart; date <= businessEnd; date += day) {
    for (const slot of slotsForDate(
      link.settings,
      professional,
      service,
      new Date(date).toISOString().slice(0, 10),
      busy,
      now,
    )) {
      buckets.get(dateInZone(slot.startsAt, displayTimeZone))?.push(slot);
    }
  }
  for (const bucket of days)
    bucket.slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return output;
}
