# Jitsi meetings

Savia schedules the event and distributes a unique Jitsi room URL. Jitsi runs the
call when participants join; it does not store a second Savia appointment agenda.
This integration uses `https://meet.jit.si` and opens meetings in a new browser tab.

## Schedule from My Day

1. Connect Google Calendar or Outlook through personal integrations.
2. In the quick task form, enter a title, time and duration and enable **Create a video call**.
3. Choose the date, destination calendar and **Jitsi** as the video meeting provider.
4. Enter guest email addresses separated by commas (up to 50). An empty list creates an event only for the organizer.
5. Review the calendar, provider and recipients, then confirm creation.

Google Calendar sends event invitations using attendee updates; Outlook sends
meeting invitations to the event attendees. The event location and description
contain the same Jitsi URL saved by Savia. Calendar delivery depends on the
connected account; Savia does not confirm that the recipient's mailbox accepted
the message. No separate Savia mail configuration is needed for these calendar
invitations.

The saved room remains visible after calendar refresh and from day, week, month
and event details. Imported/subscribed calendars remain read-only. Creating a
personal event without Google or Outlook is outside this release.

## Schedule from Bookings

Set **Bookings → Settings → Details → Video meeting provider → Jitsi** and save.
New reservations save a random room independently of calendar synchronization.
Confirmation, rescheduling and reminder emails include the room when outbound
mail is configured. The customer can also access it from the confirmation and
private appointment management pages; staff can join from Bookings or My Day.
See [tenant booking](tenant-booking.md) for mail and calendar grant setup.

Reprogramming the appointment or retrying a delivery reuses the original URL.
Changing the default provider does not change existing meetings. Cancellation
removes the join action in Savia and follows the existing calendar cancellation
flow, but cannot disable a previously shared public room URL.

## Service and deployment

Rooms use random identifiers without customer names or email addresses. Every
participant receives the full server-and-room URL, so there is no room to search
for manually. This is a public Jitsi link integration: service availability and
host authentication follow meet.jit.si policies. Scheduled times do not enforce
room access windows. Custom domains, JaaS authentication and embedded calls are
not configured by this feature.

Apply `0033_booking_jitsi_conference.sql` (D1 or PostgreSQL) before deploying the
API and admin bundle. Tests use provider fixtures; they do not send real invitations or
establish a live audio/video call.
