import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([left], [right]) => left.localeCompare(right));

async function executeMigration(sql: string) {
  for (const statement of sql
    .split("--> statement-breakpoint")
    .map((value) =>
      value
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)) {
    await env.DB.exec(statement);
  }
}

beforeAll(async () => {
  for (const [filename, sql] of migrations) {
    if (filename.endsWith("0035_zoom_personal_meetings.sql")) break;
    await executeMigration(sql);
  }
  await env.DB.prepare(
    `INSERT INTO identity_principal (
      id, issuer, subject, email, display_name, is_active, created_at, updated_at
    ) VALUES ('zoom-migration-principal', 'savia:test', 'zoom-migration-principal',
      'zoom-migration@savia.test', 'Migration Test', 1, 'now', 'now')`,
  ).run();
  await env.DB.prepare(
    `INSERT INTO personal_integration_connections (
      id, principal_id, provider, nango_connection_id, nango_integration_id,
      status, scopes, created_at, updated_at
    ) VALUES ('zoom-migration-connection', 'zoom-migration-principal',
      'google_calendar', 'nango-calendar', 'google-calendar-app', 'connected', '[]', 'now', 'now')`,
  ).run();
  await env.DB.prepare(
    `INSERT INTO tenants (id, id_slug, name, is_active, created_at, updated_at)
     VALUES (987654321, 'zoom-migration-tenant', 'Migration Test', 1, 'now', 'now')`,
  ).run();
  await env.DB.prepare(
    `INSERT INTO tenant_booking_calendar_grants (
      tenant_id, principal_id, provider, connection_id
    ) VALUES (987654321, 'zoom-migration-principal', 'google_calendar', 'zoom-migration-connection')`,
  ).run();
  await env.DB.prepare(
    `INSERT INTO personal_integration_audit_events (
      id, connection_id, principal_id, provider, event_type, outcome, created_at
    ) VALUES ('zoom-migration-audit', 'zoom-migration-connection',
      'zoom-migration-principal', 'google_calendar', 'create-event', 'succeeded', 'now')`,
  ).run();
  const zoomMigration = migrations.find(([filename]) =>
    filename.endsWith("0035_zoom_personal_meetings.sql"),
  )?.[1];
  if (!zoomMigration) throw new Error("Zoom migration was not found");
  await executeMigration(zoomMigration);

  await env.DB.prepare(
    `INSERT INTO personal_integration_connections (
      id, principal_id, provider, nango_connection_id, nango_integration_id,
      status, scopes, created_at, updated_at
    ) VALUES ('zoom-meeting-connection', 'zoom-migration-principal',
      'zoom', 'nango-zoom', 'zoom-app', 'connected', '[]', 'now', 'now')`,
  ).run();
  await env.DB.prepare(
    `INSERT INTO zoom_personal_meetings (
      principal_id, resource_key, connection_id, nango_connection_id,
      nango_integration_id, immutable_request, meeting_id, join_url,
      calendar_connection_id, calendar_nango_connection_id,
      calendar_nango_integration_id, calendar_provider, calendar_event_id,
      state, created_at, updated_at
    ) VALUES ('zoom-migration-principal', 'contact:42', 'zoom-meeting-connection',
      'nango-zoom', 'zoom-app', '{"topic":"Review"}', 'meeting-42',
      'https://zoom.us/j/42', 'zoom-migration-connection', 'nango-zoom',
      'zoom-app', 'google_calendar', 'event-42', 'active', 'now', 'now')`,
  ).run();

  const collaborationMigration = migrations.find(([filename]) =>
    filename.endsWith("0037_personal_collaboration_messages.sql"),
  )?.[1];
  if (!collaborationMigration) {
    throw new Error("Collaboration migration was not found");
  }
  await executeMigration(collaborationMigration);
});

it("preserves connected accounts and audit foreign keys when adding Zoom", async () => {
  const connection = await env.DB.prepare(
    "SELECT provider, nango_connection_id FROM personal_integration_connections WHERE id = 'zoom-migration-connection'",
  ).first<{ provider: string; nango_connection_id: string }>();
  const audit = await env.DB.prepare(
    "SELECT connection_id FROM personal_integration_audit_events WHERE id = 'zoom-migration-audit'",
  ).first<{ connection_id: string }>();
  const violations = await env.DB.prepare("PRAGMA foreign_key_check").all();
  const grant = await env.DB.prepare(
    "SELECT connection_id FROM tenant_booking_calendar_grants WHERE tenant_id = 987654321",
  ).first<{ connection_id: string }>();

  expect(connection).toEqual({
    provider: "google_calendar",
    nango_connection_id: "nango-calendar",
  });
  expect(audit?.connection_id).toBe("zoom-migration-connection");
  expect(grant?.connection_id).toBe("zoom-migration-connection");
  expect(violations.results).toEqual([]);
});

it("preserves Zoom meeting rows and foreign keys when rebuilding connections", async () => {
  const meeting = await env.DB.prepare(
    `SELECT connection_id, meeting_id, join_url, calendar_connection_id,
            calendar_provider, calendar_event_id, state
     FROM zoom_personal_meetings
     WHERE principal_id = 'zoom-migration-principal' AND resource_key = 'contact:42'`,
  ).first<Record<string, string>>();
  const violations = await env.DB.prepare("PRAGMA foreign_key_check").all();

  expect(meeting).toEqual({
    connection_id: "zoom-meeting-connection",
    meeting_id: "meeting-42",
    join_url: "https://zoom.us/j/42",
    calendar_connection_id: "zoom-migration-connection",
    calendar_provider: "google_calendar",
    calendar_event_id: "event-42",
    state: "active",
  });
  expect(violations.results).toEqual([]);
});
