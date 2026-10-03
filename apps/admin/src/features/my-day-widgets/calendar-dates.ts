import type { CalendarOccurrence } from "@savia/studio-shared/calendar-contracts";

export type CalendarViewMode = "day" | "week" | "month";
export function localDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function addDays(date: Date, count: number): Date {
  const next = localDay(date);
  next.setDate(next.getDate() + count);
  return next;
}
function monday(date: Date): Date {
  return addDays(date, -((date.getDay() + 6) % 7));
}
export function calendarRange(date: Date, view: CalendarViewMode) {
  let start = localDay(date),
    end = addDays(start, 1);
  if (view === "week") {
    start = monday(start);
    end = addDays(start, 7);
  }
  if (view === "month") {
    start = monday(new Date(date.getFullYear(), date.getMonth(), 1));
    const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    end = nextMonth.getDay() === 1 ? nextMonth : addDays(monday(nextMonth), 7);
  }
  return { start, end, from: start.toISOString(), to: end.toISOString() };
}
export function moveCalendarDate(
  date: Date,
  view: CalendarViewMode,
  direction: -1 | 1,
): Date {
  if (view !== "month")
    return addDays(date, direction * (view === "week" ? 7 : 1));
  const next = new Date(date.getFullYear(), date.getMonth() + direction, 1);
  next.setDate(
    Math.min(
      date.getDate(),
      new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate(),
    ),
  );
  return next;
}
export function calendarDays(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  for (let day = localDay(from); day < to; day = addDays(day, 1))
    days.push(day);
  return days;
}
export function eventsForDay(
  events: CalendarOccurrence[],
  day: Date,
): CalendarOccurrence[] {
  const start = localDay(day),
    end = addDays(day, 1),
    key = dateKey(start);
  return events
    .filter((event) =>
      event.allDay
        ? event.startsAt <= key && key < event.endsAt
        : Date.parse(event.startsAt) < end.getTime() &&
          (Date.parse(event.endsAt) > start.getTime() ||
            (event.startsAt === event.endsAt &&
              Date.parse(event.startsAt) >= start.getTime())),
    )
    .sort(
      (a, b) =>
        Number(b.allDay) - Number(a.allDay) ||
        a.startsAt.localeCompare(b.startsAt) ||
        a.id.localeCompare(b.id),
    );
}
