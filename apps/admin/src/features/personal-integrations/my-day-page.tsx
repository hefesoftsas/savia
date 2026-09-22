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
  const [day] = useState(() => startOfLocalDay(new Date()));
  const agenda = useMyDayAgenda(services.personalIntegrations);
  const providersLabel =
    agenda.calendarProviders.length > 0
      ? agenda.calendarProviders.map(calendarProviderLabel).join(" y ")
      : "Calendarios personales";

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-10 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4 py-6">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <CalendarDays className="size-4" />
            {providersLabel}
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Mi día</h1>
          <p className="mt-2 text-sm capitalize text-muted-foreground">
            {formatDay(day)}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={agenda.loading}
          onClick={() => void agenda.refresh()}
        >
          {agenda.loading ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <RefreshCw />
          )}
          Sincronizar
        </Button>
      </header>

      <MyDayWidgetsSection
        apiClient={services.apiClient}
        userPreferences={services.userPreferences}
        personalIntegrations={services.personalIntegrations}
      />
    </main>
  );
}
