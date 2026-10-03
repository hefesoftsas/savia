import type {
  BookingSettings,
  BookingProfessional,
  BookingService,
  BusyInterval,
} from "./contracts";
const parts = (instant: number, zone: string) => {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (key: string) => p.find((v) => v.type === key)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
};
/** Reject both missing and repeated wall times rather than choosing a DST side. */
export function localInstant(
  date: string,
  time: string,
  zone: string,
): number | null {
  const wall = Date.parse(`${date}T${time}:00Z`),
    offsets = new Set<number>();
  for (let h = -36; h <= 36; h += 6) {
    const sample = wall + h * 3600000;
    offsets.add(Date.parse(`${parts(sample, zone)}Z`) - sample);
  }
  const matches = [...offsets]
    .map((o) => wall - o)
    .filter((v) => parts(v, zone) === `${date}T${time}:00`);
  return matches.length === 1 ? matches[0] : null;
}
const minute = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
const clock = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export function slotsForDate(
  settings: BookingSettings,
  professional: BookingProfessional,
  service: BookingService,
  date: string,
  busy: BusyInterval[],
  now = Date.now(),
) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const exception = professional.exceptions.find((e) => e.date === date);
  const periods = exception
    ? exception.periods
    : professional.weekly.filter((p) => p.day === day);
  const slots: Array<{ startsAt: string; endsAt: string }> = [];
  for (const period of periods) {
    const last = localInstant(date, period.end, settings.timeZone);
    if (last === null) continue;
    for (
      let m = Math.ceil(minute(period.start) / 15) * 15;
      m + service.durationMinutes + service.bufferMinutes <= minute(period.end);
      m += 15
    ) {
      const start = localInstant(date, clock(m), settings.timeZone);
      if (start === null) continue;
      const end = start + service.durationMinutes * 60000,
        occupiedEnd = end + service.bufferMinutes * 60000;
      if (
        start < now + settings.leadMinutes * 60000 ||
        start > now + settings.horizonDays * 86400000 ||
        occupiedEnd > last
      )
        continue;
      if (
        busy.some(
          (b) => Date.parse(b.start) < occupiedEnd && Date.parse(b.end) > start,
        )
      )
        continue;
      slots.push({
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(end).toISOString(),
      });
    }
  }
  return slots;
}
export function dateInZone(instant: string, zone: string) {
  return parts(Date.parse(instant), zone).slice(0, 10);
}
export function occupancyMinutes(
  startsAt: string,
  endsAt: string,
  buffer: number,
) {
  const first = Date.parse(startsAt) / 60000,
    last = Date.parse(endsAt) / 60000 + buffer;
  if (
    !Number.isInteger(first) ||
    first % 5 !== 0 ||
    !Number.isInteger(last) ||
    last % 5 !== 0
  )
    throw Error("Invalid occupancy interval");
  return Array.from({ length: (last - first) / 5 }, (_, i) => first + i * 5);
}
export async function digest(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
