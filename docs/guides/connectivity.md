# Browser connectivity

The shared `useOnlineStatus` hook drives the offline banner, local sync controls
and realtime subscriptions. A browser's `navigator.onLine` signal is a hint:
embedded browsers and VPN configurations can report offline while Savia remains
reachable.

When that signal is offline, the app makes one shared, uncached `HEAD /api/health`
request against the configured Savia API origin. Any HTTP response, including
401, 403 or 5xx, confirms connectivity. API/authentication errors still belong to
the operation that failed; they are not represented as a network disconnection.
A network failure or an eight-second timeout retains the offline state.

While the browser continues reporting offline, visible tabs retry once per
minute to detect recovery without a browser event. Hidden tabs stop checks and
abort pending requests; becoming visible checks again. Ordinary online sessions
do not poll. All hook consumers share one in-memory request and timer, removed
when the last consumer unmounts. Cancelled or superseded results cannot overwrite
a newer online state. No credentials or external connectivity providers are used.

This indicator describes connectivity, not API health or persistence guarantees.
The unchanged offline banner refers to existing local collection behavior.
