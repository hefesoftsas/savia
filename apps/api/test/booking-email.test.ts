import { expect, it } from "vitest";
import { formatBookingEmail } from "../src/bookings/email";

const booking = {
  customer_name: "Casey Customer",
  service_name: "Extended consultation",
  professional_name: "Jordan Professional",
  starts_at: "2026-10-06T15:00:00.000Z",
  ends_at: "2026-10-06T16:15:00.000Z",
  customer_locale: "en" as const,
};

it("formats a complete appointment message in the saved locale", () => {
  const email = formatBookingEmail({
    booking,
    kind: "confirmation",
    timeZone: "America/Los_Angeles",
    managementUrl: "https://preview.example.test/manage/private-token",
  });
  expect(email.subject).toContain("confirmed");
  expect(email.text).toContain("Casey Customer");
  expect(email.text).toContain("Extended consultation");
  expect(email.text).toContain("Jordan Professional");
  expect(email.text).toContain("October 6, 2026");
  expect(email.text).toContain("8:00 AM");
  expect(email.text).toContain("9:15 AM");
  expect(email.text).toContain("75 minutes");
  expect(email.text).toContain("America/Los_Angeles");
  expect(email.text).toContain("Pacific Daylight Time");
  expect(email.text).toContain(
    "https://preview.example.test/manage/private-token",
  );
});

it.each([
  ["es", "Tu cita está confirmada"],
  ["pt", "Seu agendamento está confirmado"],
  ["unsupported", "Your appointment is confirmed"],
] as const)("uses supported customer locale %s", (locale, phrase) => {
  const email = formatBookingEmail({
    booking: { ...booking, customer_locale: locale },
    kind: "confirmation",
    timeZone: "UTC",
    managementUrl: "https://example.test/manage/token",
  });
  expect(email.text).toContain(phrase);
});

it.each([
  ["confirmation", "Appointment confirmed"],
  ["change", "Appointment changed"],
  ["cancellation", "Appointment cancelled"],
  ["reminder", "Appointment reminder"],
] as const)("formats %s appointment notices", (kind, subject) => {
  const email = formatBookingEmail({
    booking,
    kind,
    timeZone: "UTC",
    managementUrl: "https://example.test/manage/token",
  });
  expect(email.subject).toContain(subject);
});

it("includes a ready video link in appointment notices but never cancellation emails", () => {
  const withMeeting = {
    ...booking,
    conference_status: "ready" as const,
    conference_url: "https://meet.google.com/abc-defg-hij",
  };
  const input = {
    booking: withMeeting,
    timeZone: "UTC",
    managementUrl: "https://example.test/manage/token",
  };
  expect(formatBookingEmail({ ...input, kind: "reminder" }).text).toContain(
    "https://meet.google.com/abc-defg-hij",
  );
  expect(
    formatBookingEmail({ ...input, kind: "cancellation" }).text,
  ).not.toContain("https://meet.google.com/abc-defg-hij");
  expect(
    formatBookingEmail({
      ...input,
      kind: "confirmation",
      booking: { ...withMeeting, conference_url: "javascript:alert(1)" },
    }).text,
  ).not.toContain("javascript:");
});
