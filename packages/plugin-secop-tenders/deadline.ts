/** Socrata's floating timestamps represent Colombia wall time, not browser time. */
export function deadlineInstant(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(
      raw,
    );
  if (!match) return null;
  const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
  const check = new Date(Date.UTC(+year, +month - 1, +day));
  if (
    check.getUTCFullYear() !== +year ||
    check.getUTCMonth() !== +month - 1 ||
    check.getUTCDate() !== +day ||
    +hour > 23 ||
    +minute > 59 ||
    +second > 59
  )
    return null;
  const timestamp = Date.parse(
    raw.length === 10
      ? `${raw}T00:00:00-05:00`
      : match[7]
        ? raw
        : `${raw}-05:00`,
  );
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function formatDeadline(
  value: unknown,
  locale: "es" | "en" | "pt",
  fallback: string,
): string {
  const timestamp = deadlineInstant(value);
  if (timestamp === null) return fallback;
  const dateOnly = typeof value === "string" && value.trim().length === 10;
  return new Intl.DateTimeFormat(
    locale === "es" ? "es-CO" : locale === "pt" ? "pt-BR" : "en-US",
    {
      day: "numeric",
      month: "short",
      year: "numeric",
      ...(!dateOnly
        ? { hour: "numeric" as const, minute: "2-digit" as const }
        : {}),
      timeZone: "America/Bogota",
    },
  ).format(timestamp);
}
