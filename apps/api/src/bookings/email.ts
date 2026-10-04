import { safeBookingConferenceUrl } from "./conference";
import type { BookingRow } from "./repository";

type BookingEmailKind = "confirmation" | "change" | "cancellation" | "reminder";
type EmailBooking = Pick<
  BookingRow,
  | "customer_name"
  | "service_name"
  | "professional_name"
  | "starts_at"
  | "ends_at"
> & {
  customer_locale?: string | null;
  conference_status?: string | null;
  conference_provider?: "google_meet" | "teams" | "jitsi" | null;
  conference_url?: string | null;
};

const copy = {
  en: {
    subject: {
      confirmation: "Appointment confirmed",
      change: "Appointment changed",
      cancellation: "Appointment cancelled",
      reminder: "Appointment reminder",
    },
    greeting: "Hello",
    opening: {
      confirmation: "Your appointment is confirmed.",
      change: "Your appointment has changed.",
      cancellation: "Your appointment has been cancelled.",
      reminder: "This is a reminder about your appointment.",
    },
    customer: "Customer",
    service: "Service",
    professional: "Professional",
    starts: "Starts",
    ends: "Ends",
    duration: "Duration",
    minutes: "minutes",
    timeZone: "Time zone",
    manage: "Manage your appointment",
    join: "Join video call",
  },
  es: {
    subject: {
      confirmation: "Cita confirmada",
      change: "Cita modificada",
      cancellation: "Cita cancelada",
      reminder: "Recordatorio de cita",
    },
    greeting: "Hola",
    opening: {
      confirmation: "Tu cita está confirmada.",
      change: "Tu cita ha cambiado.",
      cancellation: "Tu cita ha sido cancelada.",
      reminder: "Te recordamos tu próxima cita.",
    },
    customer: "Cliente",
    service: "Servicio",
    professional: "Profesional",
    starts: "Inicio",
    ends: "Fin",
    duration: "Duración",
    minutes: "minutos",
    timeZone: "Zona horaria",
    manage: "Gestiona tu cita",
    join: "Unirse a la videollamada",
  },
  pt: {
    subject: {
      confirmation: "Agendamento confirmado",
      change: "Agendamento alterado",
      cancellation: "Agendamento cancelado",
      reminder: "Lembrete de agendamento",
    },
    greeting: "Olá",
    opening: {
      confirmation: "Seu agendamento está confirmado.",
      change: "Seu agendamento foi alterado.",
      cancellation: "Seu agendamento foi cancelado.",
      reminder: "Este é um lembrete do seu agendamento.",
    },
    customer: "Cliente",
    service: "Serviço",
    professional: "Profissional",
    starts: "Início",
    ends: "Fim",
    duration: "Duração",
    minutes: "minutos",
    timeZone: "Fuso horário",
    manage: "Gerencie seu agendamento",
    join: "Entrar na videochamada",
  },
} as const;

function supportedLocale(
  locale: string | null | undefined,
): "en" | "es" | "pt" {
  return locale === "es" || locale === "pt" ? locale : "en";
}

export function formatBookingEmail(input: {
  booking: EmailBooking;
  kind: BookingEmailKind;
  timeZone: string;
  managementUrl: string;
}): { subject: string; text: string } {
  const locale = supportedLocale(input.booking.customer_locale);
  const messages = copy[locale];
  const dateTime = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: input.timeZone,
      dateStyle: "full",
      timeStyle: "short",
    }).format(new Date(value));
  const zoneName = new Intl.DateTimeFormat(locale, {
    timeZone: input.timeZone,
    timeZoneName: "long",
  })
    .formatToParts(new Date(input.booking.starts_at))
    .find((part) => part.type === "timeZoneName")?.value;
  const duration = Math.round(
    (Date.parse(input.booking.ends_at) - Date.parse(input.booking.starts_at)) /
      60000,
  );
  const joinUrl =
    input.kind !== "cancellation" && input.booking.conference_status === "ready"
      ? safeBookingConferenceUrl(
          input.booking.conference_provider,
          input.booking.conference_url,
        )
      : null;
  const durationText = `${duration} ${messages.minutes}`;
  return {
    subject: `${messages.subject[input.kind]}: ${input.booking.service_name}`
      .replace(/[\r\n]+/g, " ")
      .slice(0, 200),
    text: [
      `${messages.greeting} ${input.booking.customer_name},`,
      "",
      messages.opening[input.kind],
      "",
      `${messages.customer}: ${input.booking.customer_name}`,
      `${messages.service}: ${input.booking.service_name}`,
      `${messages.professional}: ${input.booking.professional_name}`,
      `${messages.starts}: ${dateTime(input.booking.starts_at)}`,
      `${messages.ends}: ${dateTime(input.booking.ends_at)}`,
      `${messages.duration}: ${durationText}`,
      `${messages.timeZone}: ${zoneName ? `${zoneName} (${input.timeZone})` : input.timeZone}`,
      "",
      ...(joinUrl ? [`${messages.join}: ${joinUrl}`, ""] : []),
      `${messages.manage}: ${input.managementUrl}`,
    ].join("\n"),
  };
}
