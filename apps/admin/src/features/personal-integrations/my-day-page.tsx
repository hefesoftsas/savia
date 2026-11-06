import { intlLocale, useAppLocale, useMessages } from "@/i18n/core";
import { agendaMessages } from "@/features/my-day-widgets/agenda-messages";
import { useRealtimeRefresh } from "@/realtime/use-realtime-refresh";
import type { AppServices } from "@/app-services";
import { MyDayWidgetsSection } from "@/features/my-day-widgets/section";
import {
  calendarProviderLabel,
  formatDay,
  startOfLocalDay,
  useMyDayAgenda,
} from "@/features/my-day-widgets/agenda-widget";
import { Button } from "@/components/ui/button";
import { CalendarDays, RefreshCw, LoaderCircle } from "lucide-react";
import { useState } from "react";

export function MyDayPage({
  services,
}: {
  services: Pick<AppServices, "personalIntegrations"> &
    Partial<Pick<AppServices, "apiClient" | "userPreferences">>;
}) {
  const locale = useAppLocale();
  const t = useMessages(agendaMessages);
  const [day] = useState(() => startOfLocalDay(new Date()));
  const agenda = useMyDayAgenda(services.personalIntegrations);
  useRealtimeRefresh({
    topics: ["personal-integrations"],
    refresh: () => agenda.refresh(),
  });
  const providersLabel =
    agenda.calendarProviders.length > 0
      ? new Intl.ListFormat(intlLocale(locale)).format(
          agenda.calendarProviders.map(calendarProviderLabel),
        )
      : t("Calendarios personales");

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-10 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4 py-6">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <CalendarDays className="size-4" />
            {providersLabel}
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {t("Mi día")}
          </h1>
          <p className="mt-2 text-sm capitalize text-muted-foreground">
            {formatDay(day, locale)}
          </p>
        </div>
        <Button
          variant="outline"
          className="max-sm:size-11 max-sm:p-0 max-sm:has-[>svg]:px-0"
          title={t("Sincronizar")}
          disabled={agenda.loading}
          onClick={() => void agenda.refresh()}
        >
          {agenda.loading ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw aria-hidden="true" />
          )}
          <span className="sr-only sm:not-sr-only">{t("Sincronizar")}</span>
        </Button>
      </header>

      <MyDayWidgetsSection
        apiClient={services.apiClient}
        userPreferences={services.userPreferences}
        personalIntegrations={services.personalIntegrations}
        agenda={agenda}
      />
    </main>
  );
}
