import { useAppLocale, useMessages, intlLocale } from "@/i18n/core";
import { publicBookingWizardMessages } from "./public-booking-wizard-messages";
import type { BookingSelection } from "./booking-types";

type Catalog = {
  timeZone: string;
  services: Array<{ id: string; name: string; durationMinutes: number }>;
  professionals: Array<{ id: string; name: string }>;
};

export function PublicBookingSummary({
  catalog,
  selection,
}: {
  catalog: Catalog;
  selection: BookingSelection | undefined;
}) {
  const t = useMessages(publicBookingWizardMessages);
  const locale = useAppLocale();
  const service = catalog.services.find(
    (item) => item.id === selection?.serviceId,
  );
  const professional = catalog.professionals.find(
    (item) => item.id === selection?.professionalId,
  );
  const date = selection
    ? new Intl.DateTimeFormat(intlLocale(locale), {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: selection.displayTimeZone,
      }).format(new Date(selection.slot.startsAt))
    : "";
  const time = selection
    ? new Intl.DateTimeFormat(intlLocale(locale), {
        hour: "numeric",
        minute: "2-digit",
        timeZone: selection.displayTimeZone,
        timeZoneName: "short",
      }).format(new Date(selection.slot.startsAt))
    : "";
  return (
    <dl className="grid gap-3 border-y py-4 text-sm sm:grid-cols-3">
      <div className="grid gap-1">
        <dt className="text-muted-foreground">{t("Selected service")}</dt>
        <dd className="font-medium">
          {service?.name}
          {service
            ? t(" · %{minutes} min", { minutes: service.durationMinutes })
            : ""}
        </dd>
      </div>
      <div className="grid gap-1">
        <dt className="text-muted-foreground">{t("Selected professional")}</dt>
        <dd className="font-medium">{professional?.name}</dd>
      </div>
      <div className="grid gap-1">
        <dt className="text-muted-foreground">{t("Selected date and time")}</dt>
        <dd className="font-medium">
          {date && (
            <>
              {date} · {time}
              <span className="block text-xs text-muted-foreground">
                {selection?.displayTimeZone}
              </span>
            </>
          )}
        </dd>
      </div>
    </dl>
  );
}
