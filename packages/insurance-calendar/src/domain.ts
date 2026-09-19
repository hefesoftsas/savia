export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  description: string;
  timeZone: string;
};
export function validateEvent(event: CalendarEvent) {
  // Require explicit offsets: ambiguous/nonexistent local DST times cannot silently shift.
  const instant =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(Z|[+-]\d{2}:\d{2})$/;
  if (
    !event.title.trim() ||
    !instant.test(event.start) ||
    !instant.test(event.end) ||
    !validInstant(event.start) ||
    !validInstant(event.end) ||
    Date.parse(event.end) <= Date.parse(event.start)
  )
    throw Error(
      "Indica título e inicio y fin válidos con zona UTC u offset; el fin debe ser posterior.",
    );
  try {
    new Intl.DateTimeFormat("en", { timeZone: event.timeZone }).format();
  } catch {
    throw Error("Zona horaria no válida.");
  }
}
const escape = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
function fold(line: string) {
  let result = "",
    size = 0;
  for (const char of line) {
    const bytes = new TextEncoder().encode(char).length;
    if (size + bytes > 75) {
      result += "\r\n ";
      size = 1;
    }
    result += char;
    size += bytes;
  }
  return result;
}
export function toICS(event: CalendarEvent, now = new Date()) {
  validateEvent(event);
  const stamp = (date: string) =>
    new Date(date)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Savia//Insurance Calendar//ES",
    "BEGIN:VEVENT",
    `UID:${escape(event.id)}@savia`,
    `DTSTAMP:${stamp(now.toISOString())}`,
    `DTSTART:${stamp(event.start)}`,
    `DTEND:${stamp(event.end)}`,
    `SUMMARY:${escape(event.title)}`,
    `DESCRIPTION:${escape(event.description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ]
    .map(fold)
    .join("\r\n");
}

export function syncOperationKey(
  id: string,
  version: number | undefined,
): string {
  if (!Number.isInteger(version) || version! < 1)
    throw Error(
      "Guarda el evento con una versión válida antes de sincronizar.",
    );
  return `${id}-v${version}`;
}
function validInstant(value: string): boolean {
  if (!Number.isFinite(Date.parse(value))) return false;
  const time = value.slice(11).match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (
    !time ||
    Number(time[1]) > 23 ||
    Number(time[2]) > 59 ||
    Number(time[3] ?? 0) > 59
  )
    return false;
  const date = value.slice(0, 10);
  if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)
    return false;
  const match = value.match(/([+-])(\d{2}):(\d{2})$/);
  if (
    match &&
    (Number(match[2]) > 14 ||
      Number(match[3]) > 59 ||
      (Number(match[2]) === 14 && Number(match[3]) !== 0))
  )
    return false;
  return true;
}

function localParts(instant: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}
export function instantToLocal(instant: string, timeZone: string): string {
  if (!instant) return "";
  if (!validInstant(instant)) throw Error("La fecha guardada no es válida.");
  return localParts(Date.parse(instant), timeZone).slice(0, 16);
}
export function localToInstant(local: string, timeZone: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) ||
    !validInstant(`${local}:00Z`)
  )
    throw Error("Selecciona una fecha y hora válidas.");
  const wall = Date.parse(`${local}:00Z`),
    offsets = new Set<number>();
  // Sample both sides of nearby transitions. Offsets come from Intl rather than
  // assuming whole-hour DST shifts; this also handles quarter-hour zones.
  for (let hour = -36; hour <= 36; hour += 3) {
    const instant = wall + hour * 3600000;
    offsets.add(Date.parse(`${localParts(instant, timeZone)}Z`) - instant);
  }
  const matches = [...offsets]
    .map((offset) => wall - offset)
    .filter((instant) => localParts(instant, timeZone) === `${local}:00`);
  if (!matches.length)
    throw Error(
      "Esta hora no existe por el cambio de horario. Elige otra hora.",
    );
  if (matches.length > 1)
    throw Error(
      "Esta hora ocurre dos veces por el cambio de horario. Elige una hora fuera de ese intervalo.",
    );
  return new Date(matches[0]).toISOString();
}
