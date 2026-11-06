import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { GripVertical } from "lucide-react";
import { StoreContextProvider, memoryStore } from "ra-core";
import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import { WidgetCard } from "../../widgets";
import {
  useMyDayAgenda,
  type PersonalIntegrationsLike,
} from "../../agenda-widget";
import "@/styles/globals.css";

// This fixture exercises the real widget using synthetic events and no provider writes.
const events = [
  {
    id: "synthetic-meet",
    title: "Planificación del equipo",
    startsAt: "2026-10-04T07:30:00Z",
    endsAt: "2026-10-04T08:00:00Z",
    webLink: null,
    conference: {
      provider: "google_meet",
      status: "ready",
      joinUrl: "https://meet.google.com/abc-defg-hij",
    },
  },
  {
    id: "synthetic-zoom",
    title: "Revisión de la propuesta con el equipo de producto",
    startsAt: "2026-10-04T18:00:00Z",
    endsAt: "2026-10-04T19:00:00Z",
    webLink: null,
    conference: {
      provider: "zoom",
      status: "ready",
      joinUrl: "https://zoom.us/j/123456789",
    },
  },
  {
    id: "synthetic-jitsi",
    title: "Seguimiento del proyecto",
    startsAt: "2026-10-04T19:00:00Z",
    endsAt: "2026-10-04T19:30:00Z",
    webLink: null,
    conference: {
      provider: "jitsi",
      status: "ready",
      joinUrl: "https://meet.jit.si/savia-preview",
    },
  },
  {
    id: "synthetic-teams",
    title: "Revisión semanal",
    startsAt: "2026-10-04T20:00:00Z",
    endsAt: "2026-10-04T20:30:00Z",
    webLink: null,
    conference: {
      provider: "teams",
      status: "ready",
      joinUrl: "https://teams.microsoft.com/l/meetup-join/abc",
    },
  },
];
const deleted = new Set<string>();
const client = {
  listConnections: async () => [
    {
      id: "synthetic-google",
      provider: "google_calendar",
      status: "connected",
    },
    { id: "synthetic-outlook", provider: "outlook", status: "connected" },
  ],
  listEvents: async ({ provider }: { provider: string }) =>
    events.filter(
      (event) =>
        !deleted.has(event.id) &&
        (provider === "outlook"
          ? ["synthetic-jitsi", "synthetic-teams"].includes(event.id)
          : !["synthetic-jitsi", "synthetic-teams"].includes(event.id)),
    ),
  listBookingAgenda: async () => [],
  createCalendarEvent: async () => {
    throw new Error("Synthetic preview only");
  },
  deleteCalendarEvent: async ({ eventId }: { eventId: string }) => {
    deleted.add(eventId);
  },
} as unknown as PersonalIntegrationsLike;
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle(
  "dark",
  params.get("theme") !== "light",
);
function Preview() {
  const agenda = useMyDayAgenda(client);
  useEffect(() => {
    agenda.setSelectedDay(new Date(2026, 9, 4));
  }, []);
  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <p className="text-xs text-muted-foreground">
          Vista local · datos de prueba
        </p>
        <WidgetCard
          apiClient={undefined}
          widget={{ id: "agenda", kind: "agenda", title: "Agenda" }}
          collectionLabel="Mi día"
          agenda={{ agenda }}
          onRemove={() => {}}
          onMove={() => {}}
          isFirst
          isLast
          disabled={false}
          dragHandle={
            <GripVertical className="mt-0.5 size-4 text-muted-foreground" />
          }
        />
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <StoreContextProvider value={memoryStore({ locale: "es" })}>
    <AppLocaleProvider>
      <Preview />
    </AppLocaleProvider>
  </StoreContextProvider>,
);
