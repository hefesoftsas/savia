import ICAL from "ical.js";
import {
  calendarLimits,
  type CalendarOccurrence,
} from "@savia/studio-shared/calendar-contracts";

export class CalendarIcalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarIcalError";
  }
}

export type ExpandCalendarInput = {
  sourceId: string;
  from: string;
  to: string;
  timeZone: string;
};

const encoder = new TextEncoder();

function isDateOnly(time: ICAL.Time): boolean {
  return time.isDate;
}

function wallTimeToInstant(time: ICAL.Time, timeZone: string): Date {
  // Convert a calendar wall time through Intl. Iteration is bounded and also
  // detects nonexistent local times at a daylight-saving transition.
  const target = [
    time.year,
    time.month,
    time.day,
    time.hour,
    time.minute,
    time.second,
  ];
  let guess = Date.UTC(
    time.year,
    time.month - 1,
    time.day,
    time.hour,
    time.minute,
    time.second,
  );
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(guess))
        .map(({ type, value }) => [type, Number(value)]),
    );
    const shown = [
      parts.year,
      parts.month,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ];
    const asUtc = ([year, month, day, hour, minute, second]: number[]) =>
      Date.UTC(year, month - 1, day, hour, minute, second);
    const difference = asUtc(shown) - asUtc(target);
    if (difference === 0) return new Date(guess);
    guess -= difference;
  }
  throw new CalendarIcalError(
    `An event uses a nonexistent or ambiguous local time in ${timeZone}.`,
  );
}

function toInstant(
  time: ICAL.Time,
  fallbackZone: string,
  embeddedTimeZones: Set<string>,
  explicitTimeZone?: string | null,
): string {
  const tzid =
    explicitTimeZone ||
    (time.zone?.tzid === "floating" ? undefined : time.zone?.tzid);
  if (time.isDate)
    throw new CalendarIcalError(
      "Date-only value used where a timed value was expected.",
    );
  let date: Date;
  if (tzid && (tzid === "UTC" || tzid === "Z" || tzid === "GMT")) {
    date = time.toJSDate();
  } else if (tzid && embeddedTimeZones.has(tzid)) {
    date = time.toJSDate();
  } else {
    const zone = tzid || fallbackZone;
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone });
    } catch {
      throw new CalendarIcalError(
        `The event timezone ${zone} cannot be resolved.`,
      );
    }
    date = wallTimeToInstant(time, zone);
  }
  if (!Number.isFinite(date.getTime()))
    throw new CalendarIcalError("An event date cannot be resolved.");
  return date.toISOString();
}

function overlapsRange(
  start: number,
  end: number,
  from: number,
  to: number,
): boolean {
  return start < to && (end > from || (start === end && start >= from));
}

function occurrenceId(
  sourceId: string,
  uid: string,
  original: ICAL.Time,
): string {
  return `${sourceId}:${uid}:${original.toString()}`;
}

function stamp(event: ICAL.Event): number {
  const sequence = Number(
    event.component.getFirstPropertyValue("sequence") ?? 0,
  );
  const dtstamp = event.component.getFirstPropertyValue(
    "dtstamp",
  ) as ICAL.Time | null;
  return sequence * 1e15 + (dtstamp?.toUnixTime() ?? 0);
}

function propertyText(event: ICAL.Event, property: string): string | null {
  const value = event.component.getFirstPropertyValue(property);
  return typeof value === "string" ? value : null;
}

export function validateCalendar(content: string): void {
  if (
    !content ||
    encoder.encode(content).byteLength > calendarLimits.maxBytes
  ) {
    throw new CalendarIcalError(
      "The calendar feed is empty or exceeds the 1 MiB limit.",
    );
  }
  ICAL.TimezoneService.reset();
  let parsed: unknown;
  try {
    parsed = ICAL.parse(content);
  } catch {
    throw new CalendarIcalError(
      "The calendar feed is not valid iCalendar content.",
    );
  }
  try {
    const root = new ICAL.Component(parsed as never);
    if (root.name !== "vcalendar") throw new Error("not calendar");
    const components = root.getAllSubcomponents("vevent");
    for (const component of components) {
      const event = new ICAL.Event(component);
      if (!event.uid || !event.startDate)
        throw new Error("missing required fields");
      if (
        component
          .getAllProperties("recurrence-id")
          .some(
            (property) => property.getParameter("range") === "THISANDFUTURE",
          )
      ) {
        throw new CalendarIcalError(
          "RANGE=THISANDFUTURE recurrence exceptions are not supported.",
        );
      }
    }
  } catch (error) {
    if (error instanceof CalendarIcalError) throw error;
    throw new CalendarIcalError(
      "The calendar contains a malformed event component.",
    );
  }
}

export function expandCalendar(
  content: string,
  input: ExpandCalendarInput,
): CalendarOccurrence[] {
  const from = Date.parse(input.from);
  const to = Date.parse(input.to);
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    to <= from ||
    to - from > calendarLimits.maxDays * 86_400_000
  ) {
    throw new CalendarIcalError(
      `Calendar event ranges must be positive and no longer than ${calendarLimits.maxDays} days.`,
    );
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timeZone });
  } catch {
    throw new CalendarIcalError("The fallback timezone is invalid.");
  }
  validateCalendar(content);
  // ICAL.js keeps VTIMEZONE definitions in a module-level registry. Reset it
  // before each synchronous expansion so one caller cannot influence another.
  ICAL.TimezoneService.reset();
  const root = new ICAL.Component(ICAL.parse(content) as never);
  const embeddedTimeZones = new Set<string>();
  for (const component of root.getAllSubcomponents("vtimezone")) {
    const tzid = component.getFirstPropertyValue("tzid");
    if (typeof tzid === "string") embeddedTimeZones.add(tzid);
    ICAL.TimezoneService.register(component);
  }

  const events = root
    .getAllSubcomponents("vevent")
    .map((component) => new ICAL.Event(component));
  const newest = new Map<string, ICAL.Event>();
  for (const event of events) {
    const recurrence = event.component.getFirstPropertyValue(
      "recurrence-id",
    ) as ICAL.Time | null;
    const key = `${event.uid}\u0000${recurrence?.toString() ?? ""}`;
    const current = newest.get(key);
    if (!current || stamp(event) >= stamp(current)) newest.set(key, event);
  }
  const masters = [...newest.values()].filter(
    (event) => !event.isRecurrenceException(),
  );
  const output = new Map<string, CalendarOccurrence>();
  let steps = 0;

  for (const master of masters) {
    if (propertyText(master, "status") === "CANCELLED") continue;
    let iterator = master.iterator();
    while (true) {
      const original = iterator.next();
      if (!original) break;
      if (++steps > calendarLimits.maxRecurrenceSteps)
        throw new CalendarIcalError(
          "Calendar recurrence exceeds the 100,000 step limit.",
        );
      if (original.toUnixTime() >= to + 2 * 86_400) break;
      const details = master.getOccurrenceDetails(original);
      const item = details.item as ICAL.Event;
      if (propertyText(item, "status") === "CANCELLED") continue;
      const start = details.startDate as ICAL.Time;
      const end = details.endDate as ICAL.Time;
      const allDay = isDateOnly(start);
      const eventZone = master.component
        .getFirstProperty("dtstart")
        ?.getParameter("tzid") as string | undefined;
      const startsAt = allDay
        ? start.toString()
        : toInstant(start, input.timeZone, embeddedTimeZones, eventZone);
      const endsAt = allDay
        ? end.toString()
        : toInstant(end, input.timeZone, embeddedTimeZones, eventZone);
      const startMs = allDay
        ? Date.parse(`${startsAt}T00:00:00.000Z`)
        : Date.parse(startsAt);
      const endMs = allDay
        ? Date.parse(`${endsAt}T00:00:00.000Z`)
        : Date.parse(endsAt);
      if (overlapsRange(startMs, endMs, from, to)) {
        const link = propertyText(item, "url");
        const safeLink = link && /^https:\/\//i.test(link) ? link : null;
        const value: CalendarOccurrence = {
          id: occurrenceId(input.sourceId, master.uid, original),
          sourceId: input.sourceId,
          title: propertyText(item, "summary"),
          startsAt,
          endsAt,
          allDay,
          webLink: safeLink,
          timeZone: allDay
            ? input.timeZone
            : eventZone ||
              (start.zone?.tzid === "floating"
                ? input.timeZone
                : start.zone?.tzid || input.timeZone),
        };
        output.set(value.id, value);
      }
    }
  }
  const exceptions = [...newest.values()].filter((event) =>
    event.isRecurrenceException(),
  );
  for (const event of exceptions) {
    if (propertyText(event, "status") === "CANCELLED") continue;
    const recurrence = event.recurrenceId;
    const start = event.startDate;
    const end = event.endDate;
    const allDay = isDateOnly(start);
    const eventZone = event.component
      .getFirstProperty("dtstart")
      ?.getParameter("tzid") as string | undefined;
    const startsAt = allDay
      ? start.toString()
      : toInstant(start, input.timeZone, embeddedTimeZones, eventZone);
    const endsAt = allDay
      ? end.toString()
      : toInstant(end, input.timeZone, embeddedTimeZones, eventZone);
    const startMs = allDay
      ? Date.parse(`${startsAt}T00:00:00.000Z`)
      : Date.parse(startsAt);
    const endMs = allDay
      ? Date.parse(`${endsAt}T00:00:00.000Z`)
      : Date.parse(endsAt);
    if (overlapsRange(startMs, endMs, from, to)) {
      const link = propertyText(event, "url");
      const value: CalendarOccurrence = {
        id: occurrenceId(input.sourceId, event.uid, recurrence),
        sourceId: input.sourceId,
        title: propertyText(event, "summary"),
        startsAt,
        endsAt,
        allDay,
        webLink: link && /^https:\/\//i.test(link) ? link : null,
        timeZone: allDay
          ? input.timeZone
          : eventZone ||
            (start.zone?.tzid === "floating"
              ? input.timeZone
              : start.zone?.tzid || input.timeZone),
      };
      output.set(value.id, value);
    }
  }
  if (output.size > calendarLimits.maxEvents)
    throw new CalendarIcalError(
      "The calendar has more than 2,000 events in the requested range.",
    );
  return [...output.values()].sort(
    (left, right) =>
      left.startsAt.localeCompare(right.startsAt) ||
      left.id.localeCompare(right.id),
  );
}
