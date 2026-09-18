# Realtime cost controls

Owner: Savia platform team. Reviewed: 2026-09-18.

`RealtimeHub` uses one SQLite Durable Object per room (platform or tenant).
Sockets use the hibernation API; plain `ping`/`pong` is handled by the runtime
without invoking JavaScript. All other client messages close the socket with
1008 without JSON parsing. This is a push-only protocol.

The API authenticates realtime requests, then uses `REALTIME_RATE_LIMITER`
(namespace 879101) to allow 30 combined ticket/subscription attempts per principal
per 60 seconds per Cloudflare location. Both local Wrangler and the production
config generator declare the binding. Cloudflare's limiter is approximate and
location-local; it is not a global spending cap. Test app instances without
bindings skip this middleware limit. Subscription requests also check room
membership and ticket syntax before forwarding to a Durable Object.

Each room permits 8 simultaneous connections per principal and 1,000 total.
Ticket issuance and consumption both check connection capacity. Pending tickets
are capped at 8 per principal and 1,000 per room. Capacity limits return 429 with
Retry-After: 60. The limits intentionally allow multiple browser tabs, but tabs
beyond the cap wait until capacity becomes available.

Tickets expire after 15 seconds. New tickets use an indexed SQLite table and
atomic DELETE RETURNING consumption. Issuance removes at most 128 expired tickets
using the expiration index, plus at most 128 expired legacy KV tickets. Connects
never scan the ticket collection. Cleanup runs on issuance, with no recurring
alarm; abandoned expired tickets remain until later traffic, bounded by the new
pending-ticket cap. Legacy tickets retain their original TTL during rollout.
Existing sockets keep working; sockets predating principal tags count toward the
room cap but cannot be included in per-principal counts until they reconnect.

The browser retries with exponential backoff and jitter (1–2 seconds initially,
60–120 seconds at the cap). Opening a socket does not reset backoff; a connection
must last 60 seconds. HTTP 429 selects the maximum backoff. Permanent ticket
errors (400, 401, 403, 404, 422) and policy-close 1008 stop retries until the hook
is remounted or its dependencies change. Offline clients stop retrying.

Monitor Durable Object request count, duration, SQLite writes, 429 responses and
reconnect volume. These controls reduce accidental amplification and abuse but
do not guarantee a maximum invoice. Authentication, Workers, logging and data
refetches have their own costs. Limits become active in production only after
the corresponding Worker deployment; frontend retry changes require admin deploy.
