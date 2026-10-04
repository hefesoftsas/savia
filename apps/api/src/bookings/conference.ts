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

function safeZoomConferenceUrl(value: unknown): string | null {
  const safe = safeConferenceUrl(value);
  if (!safe) return null;
  const host = new URL(safe).hostname;
  return host === "zoom.us" || host.endsWith(".zoom.us") ? safe : null;
}

export function bookingConference(
  row: BookingRow,
  calendarStatus: string,
): BookingConference | null {
  if (row.status === "cancelled" || !row.calendar_provider) return null;
  // Completed events created before conferencing was introduced have no pending work.
  if (
    !row.conference_status &&
    (calendarStatus === "completed" || calendarStatus === "not_requested")
  )
    return null;
  const provider = row.zoom_connection_id
    ? "zoom"
    : (row.conference_provider ??
      (row.calendar_provider === "google_calendar" ? "google_meet" : "teams"));
  const status =
    row.conference_status === "pending" && calendarStatus === "skipped"
      ? "failed"
      : (row.conference_status ??
        (calendarStatus === "skipped" || calendarStatus === "failed"
          ? "failed"
          : "pending"));
  const joinUrl =
    status === "ready"
      ? row.zoom_connection_id
        ? safeZoomConferenceUrl(row.conference_url)
        : safeConferenceUrl(row.conference_url)
      : null;
  return {
    provider: status === "unsupported" ? null : provider,
    joinUrl,
    status: status === "ready" && !joinUrl ? "failed" : status,
  };
}
