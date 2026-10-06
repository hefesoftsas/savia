/**
 * Minimal UTC cron subset for scheduled workflows: five fields
 * (minute hour day-of-month month day-of-week) with values, lists, ranges
 * and steps, plus JAN..DEC / SUN..SAT names. No seconds, years, L, W or #.
 * Day-of-month and day-of-week follow the standard OR rule. All evaluation
 * is UTC and minute-aligned.
 */
type CronField = { values: Set<number>; restricted: boolean };
type CronSchedule = {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
};
const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function parseValue(
  raw: string,
  min: number,
  max: number,
  names?: readonly string[],
): number {
  const lowered = raw.trim().toLowerCase();
  if (names) {
    const named = names.indexOf(lowered);
    if (named >= 0) return (min === 1 ? named + 1 : named) % (max + 1);
  }
  if (!/^\d+$/.test(lowered)) throw new Error(`Invalid cron value: ${raw}`);
  const value = Number(lowered);
  if (value === 7 && min === 0 && max === 6) return 0;
  if (value < min || value > max) throw new Error(`Invalid cron value: ${raw}`);
  return value;
}

function parseField(
  raw: string,
  min: number,
  max: number,
  names?: readonly string[],
): CronField {
  const text = raw.trim();
  if (!text) throw new Error("Empty cron field");
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const [range, stepRaw] = part.split("/");
    if (stepRaw !== undefined && !/^\d+$/.test(stepRaw))
      throw new Error(`Invalid cron step: ${part}`);
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (step < 1) throw new Error(`Invalid cron step: ${part}`);
    let from: number, to: number;
    if (range === "*") {
      from = min;
      to = max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-");
      from = parseValue(a, min, max, names);
      to = parseValue(b, min, max, names);
      if (from > to) throw new Error(`Invalid cron range: ${part}`);
    } else {
      from = to = parseValue(range, min, max, names);
    }
    for (let value = from; value <= to; value += step) values.add(value);
  }
  if (!values.size) throw new Error(`Invalid cron field: ${raw}`);
  return { values, restricted: text !== "*" };
}

export function parseCronSchedule(expression: string): CronSchedule {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error("Cron expressions need five fields");
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  return {
    minute: parseField(minute, 0, 59),
    hour: parseField(hour, 0, 23),
    dayOfMonth: parseField(dayOfMonth, 1, 31),
    month: parseField(month, 1, 12, MONTHS),
    dayOfWeek: parseField(dayOfWeek, 0, 6, DAYS),
  };
}

const MINUTE_MS = 60000;
function matchesAt(schedule: CronSchedule, time: number): boolean {
  const date = new Date(time);
  if (
    !schedule.minute.values.has(date.getUTCMinutes()) ||
    !schedule.hour.values.has(date.getUTCHours()) ||
    !schedule.month.values.has(date.getUTCMonth() + 1)
  )
    return false;
  const dayMatch = schedule.dayOfMonth.values.has(date.getUTCDate());
  const weekMatch = schedule.dayOfWeek.values.has(date.getUTCDay());
  if (!schedule.dayOfMonth.restricted && !schedule.dayOfWeek.restricted)
    return true;
  if (!schedule.dayOfMonth.restricted) return weekMatch;
  if (!schedule.dayOfWeek.restricted) return dayMatch;
  return dayMatch || weekMatch;
}

/** Four years cover leap-day schedules; February 30th still never occurs. */
const SEARCH_MINUTES = 366 * 4 * 1440;
/**
 * Next occurrence strictly after `fromMs`, minute-aligned, or null when no
 * occurrence exists within the search window (for example February 30th).
 */
export function cronNextOccurrence(
  expression: string,
  fromMs: number,
): number | null {
  const schedule = parseCronSchedule(expression);
  let candidate = Math.floor(fromMs / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  for (let step = 0; step < SEARCH_MINUTES; step++, candidate += MINUTE_MS) {
    if (matchesAt(schedule, candidate)) return candidate;
  }
  return null;
}

/** True when the expression parses and occurs at least once a year. */
export function isRunnableCronSchedule(expression: string): boolean {
  try {
    return cronNextOccurrence(expression, Date.now()) !== null;
  } catch {
    return false;
  }
}
