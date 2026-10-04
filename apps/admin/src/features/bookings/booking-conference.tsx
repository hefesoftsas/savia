import { useMessages } from "@/i18n/core";
import { Button } from "@/components/ui/button";
import { bookingMessages } from "./booking-messages";

type ConferenceProvider = "google_meet" | "teams" | "jitsi" | null;
export type BookingConferenceState = {
  provider: ConferenceProvider;
  joinUrl: string | null;
  status: "ready" | "pending" | "unsupported" | "failed";
} | null;

function safeHttpsUrl(
  value: string | null,
  provider: ConferenceProvider,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return undefined;
    const host = url.hostname.toLowerCase();
    if (
      (provider === "jitsi" &&
        (host !== "meet.jit.si" ||
          url.port !== "" ||
          !/^\/[A-Za-z0-9_-]+$/.test(url.pathname))) ||
      (provider === "google_meet" && host !== "meet.google.com") ||
      (provider === "teams" &&
        ![
          "teams.microsoft.com",
          "teams.live.com",
          "teams.cloud.microsoft",
          "gov.teams.microsoft.us",
          "dod.teams.microsoft.us",
          "teams.microsoftonline.cn",
        ].includes(host))
    )
      return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function BookingConference({
  conference,
  status,
  pendingAction = "refresh",
}: {
  conference?: BookingConferenceState;
  status: "confirmed" | "cancelled";
  pendingAction?: "refresh" | "manage";
}) {
  const t = useMessages(bookingMessages);
  if (status !== "confirmed" || !conference) return null;

  if (conference.status === "pending")
    return (
      <p className="text-sm text-muted-foreground">
        {t(
          pendingAction === "manage"
            ? "Video meeting link is being prepared. Open appointment management to refresh the status."
            : "Video meeting link is being prepared. Refresh to check again.",
        )}
      </p>
    );
  if (conference.status === "unsupported")
    return (
      <p className="text-sm text-muted-foreground">
        {t("Video meetings are not available for this appointment.")}
      </p>
    );
  if (conference.status === "failed")
    return (
      <p className="text-sm text-muted-foreground">
        {t("The video meeting could not be created.")}
      </p>
    );

  const href = safeHttpsUrl(conference.joinUrl, conference.provider);
  if (!href)
    return (
      <p className="text-sm text-muted-foreground">
        {t("The video meeting link is unavailable.")}
      </p>
    );
  const label =
    conference.provider === "jitsi"
      ? "Join Jitsi"
      : conference.provider === "google_meet"
        ? "Join Google Meet"
        : conference.provider === "teams"
          ? "Join Teams"
          : "Join video meeting";

  return (
    <Button asChild variant="outline" className="w-fit">
      <a href={href} target="_blank" rel="noreferrer">
        {t(label)}
      </a>
    </Button>
  );
}
