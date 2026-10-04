import type { BookingConference } from "./contracts";
import type { BookingRow } from "./repository";

export function safeConferenceUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function safeBookingConferenceUrl(
  provider: BookingConference["provider"] | undefined,
  value: unknown,
): string | null {
  const safe = safeConferenceUrl(value);
  if (!safe || provider !== "jitsi") return safe;
  const url = new URL(safe);
  return value === url.href &&
    url.hostname === "meet.jit.si" &&
    !url.port &&
    !url.search &&
    !url.hash &&
    /^\/savia-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      url.pathname,
    )
    ? safe
    : null;
}

export function bookingConference(
  row: Pick<
    BookingRow,
    | "status"
    | "calendar_provider"
    | "conference_provider"
    | "conference_url"
    | "conference_status"
  >,
  calendarStatus: string,
): BookingConference | null {
  if (
    row.status === "cancelled" ||
    (!row.calendar_provider && row.conference_provider !== "jitsi")
  )
    return null;
  // Completed events created before conferencing was introduced have no pending work.
  if (
    !row.conference_status &&
    (calendarStatus === "completed" || calendarStatus === "not_requested")
  )
    return null;
  const provider =
    row.conference_provider ??
    (row.calendar_provider === "google_calendar"
      ? "google_meet"
      : row.calendar_provider === "outlook"
        ? "teams"
        : null);
  const status =
    row.conference_status === "pending" && calendarStatus === "skipped"
      ? "failed"
      : (row.conference_status ??
        (calendarStatus === "skipped" || calendarStatus === "failed"
          ? "failed"
          : "pending"));
  const joinUrl =
    status === "ready"
      ? safeBookingConferenceUrl(provider, row.conference_url)
      : null;
  return {
    provider: status === "unsupported" ? null : provider,
    joinUrl,
    status: status === "ready" && !joinUrl ? "failed" : status,
  };
}
