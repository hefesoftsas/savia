# Zoom video meetings

Zoom is a personal OAuth connection managed by Nango. It provides video meetings;
Google Calendar or Outlook provides the destination calendar. Each user connects
their own Zoom account. Bookings additionally require that professional to grant
Zoom access for the tenant in **Bookings → Availability**. This personal Zoom
default applies when the tenant uses automatic conferencing; an explicit tenant
Jitsi setting continues to use Jitsi for new reservations.

## Configure the provider

1. Create a user-managed General OAuth app in the Zoom App Marketplace. Use the
   app's environment and distribution settings appropriate to the accounts that
   will connect. Development access and public distribution are separate Zoom
   requirements; creating an app does not automatically authorize all users.
2. In the Nango environment used by Savia, add the **Zoom** OAuth 2 provider. Use
   its displayed callback URL as the app's OAuth Redirect URL and allow it in
   Zoom. Configure the matching Client ID and Client Secret in Nango only.
3. Enable these user-level granular scopes in both the Zoom app and Nango:
   `meeting:write:meeting`, `meeting:update:meeting`, and
   `meeting:delete:meeting`. They authorize creating, rescheduling and deleting
   the connected user's meetings. Savia does not request account administrator
   or recording permissions.
4. Set the API runtime's `NANGO_ZOOM_INTEGRATION_ID` to the Nango integration ID.
   Cloudflare deployments read this from the corresponding GitHub environment
   variable. Keep it unset until the OAuth application is configured. It is an
   integration identifier, not a credential. Credentials remain in Nango.
5. Apply database migrations before deploying the API. Users can then connect
   Zoom under **Connections**, choose Zoom in **My Day**, or authorize it for
   **Bookings**. Reconnect when OAuth scopes or the connected account change.

## Participant links and calendar state

Ready calls in Bookings and My Day provide **Copy meeting link** and **Share
meeting link** beside the join action. The share sheet is opened by a user action;
when the browser does not support it, Savia copies the participant URL instead.
Copy failures keep the URL available for manual selection. These actions do not
send invitations automatically or expose the host's start URL.

The calendar destination is separate from the call platform: a Zoom link can be
saved in Google Calendar or Outlook. Check the appointment's calendar status to
confirm synchronization; a confirmed Savia appointment or a ready Zoom link alone
does not prove that the external calendar event has been saved.

## Verification and recovery

Create a test meeting in an authorized account, confirm the attendee link appears
in the selected calendar, reschedule it, and cancel it. Use designated test data:
these actions affect the real Zoom account and connected calendar.

Savia persists meeting identities and connection snapshots on the backend. A
repeated request uses that meeting rather than creating another. An ambiguous
creation response is held for reconciliation; do not blindly repeat the create
request under a different identifier. Check the original Zoom account for the
meeting before resolving an uncertain record. Account reconnection never grants
access to another user's or another connection's meeting.

References: [Nango Zoom setup](https://nango.dev/docs/api-integrations/zoom),
[Zoom OAuth apps](https://developers.zoom.us/docs/integrations/), and
[Zoom Meeting API](https://developers.zoom.us/docs/api/rest/meeting/).
