# SECOP automatic interest monitoring

> Historical design: the SECOP integration was retired. See [retirement notes](../../secop-tenders-plugin.md).

Extend the installed SECOP plugin with server-side hourly checks of saved interests and in-app notifications for changes to SECOP status and upcoming closing dates. The user selected reminders at 168, 72 and 24 hours. Recipient is the immutable record creator, whose own tenant-bound OAuth source is used. Local workflow status, assignee and notes remain independent of remote source facts.

## Architecture

Add a generic declarative `monitors` contract to tenant plugin packages. The SECOP package supplies the read action, process lookup field, identity matching, source status/deadline aliases, pause fields, localized notification templates and interval/threshold policy. Core scheduling contains no procurement-specific identifiers or executable plugin code. Existing saved records with a creator enroll automatically; missing creator/source never borrows another user's credentials.

A D1 monitor table stores owner, next due time, expiring claim, observed state, reminder milestones and error codes. The existing API scheduled handler runs bounded checks and existing notification delivery. Resolve current installed version and availability, active creator/tenant and current collection access before invoking the fixed read-only MCP action. Recheck authorization/availability and record version before committing. Atomically persist source-field updates, observations and notification events so retries and competing ticks cannot duplicate notices or overwrite user edits. Missing remote rows and revoked grants retain old source facts and expose a safe error; retries use an hourly backoff. A changed closing date resets reminder milestones. Emit only the most urgent currently applicable threshold on initial/late checks, never all crossed thresholds at once or alerts for expired deadlines. Offset-less SECOP timestamps are interpreted in America/Bogota; date-only deadlines mean end of day. Explicit offsets are respected. Invalid/missing dates never produce closing alerts.

The plugin defaults monitoring on, supports pause per interest and automatic pause for discarded/awarded local statuses, and shows last check and connection errors. Source status and deadline are refreshed; team workflow fields are preserved. Notices use existing record sources and explicit principal audiences.

## Acceptance

- Hourly operation works while the browser is closed and the preview has a configured cron.
- Status changes and 168/72/24-hour reminders reach the existing in-app inbox once per occurrence.
- Repeated/concurrent ticks, user edits, missing rows, removed credentials, disabled plugins, inactive/revoked users and unavailable dates fail safely.
- Current interest is checked live in preview without inventing an external state change; deterministic tests verify alert transitions and delivery.
- No credentials in ZIP, logs or browser storage; no email or third-party messages are sent.
