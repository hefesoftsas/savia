import type { PersonalIntegrationNangoClient } from "./contracts";
import {
  PersonalIntegrationUnavailableError,
  PersonalIntegrationUpstreamError,
} from "./contracts";
import { createPersonalIntegrationRepository } from "./repository";

type ZoomMeetingRow = {
  principal_id: string;
  resource_key: string;
  connection_id: string;
  nango_connection_id: string;
  nango_integration_id: string;
  immutable_request: string | null;
  meeting_id: string | null;
  join_url: string | null;
  calendar_nango_connection_id?: string | null;
  calendar_nango_integration_id?: string | null;
  state: "creating" | "active" | "uncertain" | "cancelled";
};

export type ZoomMeetingSyncInput = {
  principalId: string;
  /** Savia personal_integration_connections.id captured by the caller. */
  connectionId: string;
  resourceKey: string;
  title: string;
  startsAt: string;
  endsAt: string;
  cancelled: boolean;
  immutableRequest?: string;
};

export type ZoomMeetingSyncResult = { meetingId: string; joinUrl: string };

export type ZoomCalendarProvider = "google_calendar" | "outlook";

const safeZoomJoinUrl =
  /^https:\/\/(?:[a-z0-9-]+\.)?zoom\.us\/j\/[0-9]+(?:\?[^\s#]*)?$/i;

function durationMinutes(startsAt: Date, endsAt: Date): number {
  return Math.max(
    1,
    Math.ceil((endsAt.getTime() - startsAt.getTime()) / 60_000),
  );
}

function validDateRange(input: ZoomMeetingSyncInput): {
  startsAt: Date;
  endsAt: Date;
} {
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (
    Number.isNaN(startsAt.getTime()) ||
    Number.isNaN(endsAt.getTime()) ||
    endsAt <= startsAt ||
    endsAt.getTime() - startsAt.getTime() > 24 * 60 * 60 * 1000
  )
    throw new PersonalIntegrationUnavailableError(
      "The Zoom meeting time is invalid",
    );
  return { startsAt, endsAt };
}

function meetingResponse(payload: unknown): ZoomMeetingSyncResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new PersonalIntegrationUpstreamError();
  const value = payload as Record<string, unknown>;
  const meetingId =
    typeof value.id === "string" || typeof value.id === "number"
      ? String(value.id)
      : "";
  const joinUrl = typeof value.join_url === "string" ? value.join_url : "";
  if (
    !meetingId ||
    meetingId.length > 128 ||
    !safeZoomJoinUrl.test(joinUrl) ||
    (!new URL(joinUrl).hostname.toLowerCase().endsWith(".zoom.us") &&
      new URL(joinUrl).hostname.toLowerCase() !== "zoom.us")
  )
    throw new PersonalIntegrationUpstreamError();
  return { meetingId, joinUrl };
}

async function setState(
  database: D1Database,
  principalId: string,
  resourceKey: string,
  state: ZoomMeetingRow["state"],
  meeting?: ZoomMeetingSyncResult,
): Promise<void> {
  await database
    .prepare(
      `UPDATE zoom_personal_meetings SET state = ?, meeting_id = COALESCE(?, meeting_id),
       join_url = COALESCE(?, join_url), updated_at = ?
       WHERE principal_id = ? AND resource_key = ?`,
    )
    .bind(
      state,
      meeting?.meetingId ?? null,
      meeting?.joinUrl ?? null,
      new Date().toISOString(),
      principalId,
      resourceKey,
    )
    .run();
}

export function createZoomMeetingService(
  database: D1Database,
  nango: PersonalIntegrationNangoClient,
) {
  const repository = createPersonalIntegrationRepository(database);

  return {
    async sync(input: ZoomMeetingSyncInput): Promise<ZoomMeetingSyncResult> {
      if (
        !input.principalId ||
        !input.connectionId ||
        !input.resourceKey ||
        input.resourceKey.length > 200 ||
        input.resourceKey.trim() !== input.resourceKey ||
        /[\u0000-\u001f\u007f]/.test(input.resourceKey) ||
        !input.title.trim() ||
        input.title.length > 200
      )
        throw new PersonalIntegrationUnavailableError(
          "The Zoom meeting details are invalid",
        );

      const { startsAt, endsAt } = input.cancelled
        ? { startsAt: new Date(0), endsAt: new Date(60_000) }
        : validDateRange(input);
      const connection = await repository.findActiveConnection(
        input.principalId,
        "zoom",
      );
      if (
        !connection ||
        connection.status !== "connected" ||
        connection.id !== input.connectionId
      )
        throw new PersonalIntegrationUnavailableError(
          "The connected Zoom account changed; reconnect it and try again",
        );

      let row = await database
        .prepare(
          `SELECT * FROM zoom_personal_meetings
           WHERE principal_id = ? AND resource_key = ?`,
        )
        .bind(input.principalId, input.resourceKey)
        .first<ZoomMeetingRow>();

      if (row) {
        if (
          row.connection_id !== connection.id ||
          row.nango_connection_id !== connection.nangoConnectionId ||
          row.nango_integration_id !== connection.nangoIntegrationId
        )
          throw new PersonalIntegrationUnavailableError(
            "The Zoom account used for this meeting has changed",
          );
        if (
          input.immutableRequest !== undefined &&
          row.immutable_request !== input.immutableRequest
        )
          throw new PersonalIntegrationUnavailableError(
            "This request id was already used for a different calendar event",
          );
        if (row.state === "creating" || row.state === "uncertain")
          throw new PersonalIntegrationUnavailableError(
            "Zoom meeting creation is awaiting reconciliation; retrying could create a duplicate",
          );
        if (row.state === "cancelled") {
          if (input.cancelled)
            return {
              meetingId: row.meeting_id ?? "",
              joinUrl: row.join_url ?? "",
            };
          throw new PersonalIntegrationUnavailableError(
            "This Zoom meeting was cancelled and cannot be reopened",
          );
        }
      } else {
        const now = new Date().toISOString();
        const inserted = await database
          .prepare(
            `INSERT INTO zoom_personal_meetings (
              principal_id, resource_key, connection_id, nango_connection_id,
              nango_integration_id, immutable_request, state, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'creating', ?, ?)
            ON CONFLICT(principal_id, resource_key) DO NOTHING`,
          )
          .bind(
            input.principalId,
            input.resourceKey,
            connection.id,
            connection.nangoConnectionId,
            connection.nangoIntegrationId,
            input.immutableRequest ?? null,
            now,
            now,
          )
          .run();
        if (inserted.meta.changes !== 1)
          throw new PersonalIntegrationUnavailableError(
            "Zoom meeting creation is already in progress; retry shortly",
          );
        row = await database
          .prepare(
            `SELECT * FROM zoom_personal_meetings
             WHERE principal_id = ? AND resource_key = ?`,
          )
          .bind(input.principalId, input.resourceKey)
          .first<ZoomMeetingRow>();
        if (!row) throw new PersonalIntegrationUpstreamError();
      }

      const zoomConnection = {
        ...connection,
        provider: "zoom" as const,
      };
      if (input.cancelled) {
        if (!row.meeting_id || !row.join_url) {
          await setState(
            database,
            input.principalId,
            input.resourceKey,
            "cancelled",
          );
          return { meetingId: "", joinUrl: "" };
        }
        let response: Response;
        try {
          response = await nango.proxy({
            method: "DELETE",
            path: `/v2/meetings/${encodeURIComponent(row.meeting_id)}`,
            connection: zoomConnection,
          });
        } catch {
          throw new PersonalIntegrationUpstreamError();
        }
        if (!response.ok && response.status !== 404)
          throw new PersonalIntegrationUpstreamError();
        await setState(
          database,
          input.principalId,
          input.resourceKey,
          "cancelled",
        );
        return { meetingId: row.meeting_id, joinUrl: row.join_url };
      }

      const body = {
        topic: input.title.trim(),
        start_time: startsAt.toISOString(),
        duration: durationMinutes(startsAt, endsAt),
      };
      if (row.meeting_id && row.join_url) {
        let response: Response;
        try {
          response = await nango.proxy({
            method: "PATCH",
            path: `/v2/meetings/${encodeURIComponent(row.meeting_id)}`,
            connection: zoomConnection,
            body,
          });
        } catch {
          throw new PersonalIntegrationUpstreamError();
        }
        if (!response.ok) throw new PersonalIntegrationUpstreamError();
        return { meetingId: row.meeting_id, joinUrl: row.join_url };
      }

      let response: Response;
      try {
        response = await nango.proxy({
          method: "POST",
          path: "/v2/users/me/meetings",
          connection: zoomConnection,
          body: { ...body, type: 2 },
        });
      } catch {
        await setState(
          database,
          input.principalId,
          input.resourceKey,
          "uncertain",
        );
        throw new PersonalIntegrationUpstreamError();
      }
      if (!response.ok) {
        if (response.status >= 500)
          await setState(
            database,
            input.principalId,
            input.resourceKey,
            "uncertain",
          );
        else
          await database
            .prepare(
              `DELETE FROM zoom_personal_meetings
               WHERE principal_id = ? AND resource_key = ? AND state = 'creating'`,
            )
            .bind(input.principalId, input.resourceKey)
            .run();
        throw new PersonalIntegrationUpstreamError();
      }
      let meeting: ZoomMeetingSyncResult;
      try {
        meeting = meetingResponse(await response.json());
      } catch {
        await setState(
          database,
          input.principalId,
          input.resourceKey,
          "uncertain",
        );
        throw new PersonalIntegrationUpstreamError();
      }
      await setState(
        database,
        input.principalId,
        input.resourceKey,
        "active",
        meeting,
      );
      return meeting;
    },

    async associateCalendarEvent(input: {
      principalId: string;
      resourceKey: string;
      provider: ZoomCalendarProvider;
      calendarConnectionId: string;
      calendarNangoConnectionId: string;
      calendarNangoIntegrationId: string;
      eventId: string;
    }): Promise<void> {
      if (!input.eventId || input.eventId.length > 255)
        throw new PersonalIntegrationUpstreamError();
      const result = await database
        .prepare(
          `UPDATE zoom_personal_meetings SET calendar_connection_id = ?,
           calendar_nango_connection_id = ?, calendar_nango_integration_id = ?,
           calendar_provider = ?, calendar_event_id = ?, updated_at = ?
           WHERE principal_id = ? AND resource_key = ? AND state = 'active'`,
        )
        .bind(
          input.calendarConnectionId,
          input.calendarNangoConnectionId,
          input.calendarNangoIntegrationId,
          input.provider,
          input.eventId,
          new Date().toISOString(),
          input.principalId,
          input.resourceKey,
        )
        .run();
      if (result.meta.changes !== 1)
        throw new PersonalIntegrationUpstreamError();
    },

    async associatedCalendarEvent(input: {
      principalId: string;
      resourceKey: string;
      provider: ZoomCalendarProvider;
      calendarConnectionId: string;
      calendarNangoConnectionId: string;
      calendarNangoIntegrationId: string;
    }): Promise<string | undefined> {
      const row = await database
        .prepare(
          `SELECT calendar_event_id FROM zoom_personal_meetings
           WHERE principal_id = ? AND resource_key = ? AND calendar_provider = ?
             AND calendar_connection_id = ? AND calendar_nango_connection_id = ?
             AND calendar_nango_integration_id = ? AND state = 'active'`,
        )
        .bind(
          input.principalId,
          input.resourceKey,
          input.provider,
          input.calendarConnectionId,
          input.calendarNangoConnectionId,
          input.calendarNangoIntegrationId,
        )
        .first<{ calendar_event_id: string | null }>();
      return row?.calendar_event_id ?? undefined;
    },

    async calendarMeetings(input: {
      principalId: string;
      provider: ZoomCalendarProvider;
      calendarConnectionId: string;
      calendarNangoConnectionId: string;
      calendarNangoIntegrationId: string;
      eventIds: string[];
    }): Promise<Map<string, string>> {
      if (!input.eventIds.length) return new Map();
      const result = new Map<string, string>();
      for (let offset = 0; offset < input.eventIds.length; offset += 90) {
        const eventIds = input.eventIds.slice(offset, offset + 90);
        const placeholders = eventIds.map(() => "?").join(",");
        const rows = await database
          .prepare(
            `SELECT calendar_event_id, join_url FROM zoom_personal_meetings
             WHERE principal_id = ? AND calendar_provider = ?
               AND calendar_connection_id = ? AND state = 'active'
               AND calendar_nango_connection_id = ? AND calendar_nango_integration_id = ?
               AND calendar_event_id IN (${placeholders})`,
          )
          .bind(
            input.principalId,
            input.provider,
            input.calendarConnectionId,
            input.calendarNangoConnectionId,
            input.calendarNangoIntegrationId,
            ...eventIds,
          )
          .all<{ calendar_event_id: string; join_url: string | null }>();
        for (const row of rows.results) {
          if (row.join_url && safeZoomJoinUrl.test(row.join_url))
            result.set(row.calendar_event_id, row.join_url);
        }
      }
      return result;
    },

    async cancelCalendarEvent(input: {
      principalId: string;
      provider: ZoomCalendarProvider;
      calendarConnectionId: string;
      calendarNangoConnectionId: string;
      calendarNangoIntegrationId: string;
      eventId: string;
    }): Promise<boolean> {
      const row = await database
        .prepare(
          `SELECT * FROM zoom_personal_meetings
           WHERE principal_id = ? AND calendar_provider = ?
             AND calendar_connection_id = ? AND calendar_event_id = ?
             AND state = 'active' LIMIT 1`,
        )
        .bind(
          input.principalId,
          input.provider,
          input.calendarConnectionId,
          input.eventId,
        )
        .first<ZoomMeetingRow>();
      if (!row) return false;
      if (
        row.calendar_nango_connection_id !== input.calendarNangoConnectionId ||
        row.calendar_nango_integration_id !== input.calendarNangoIntegrationId
      )
        throw new PersonalIntegrationUnavailableError(
          "The calendar account used for this event has changed; refresh the calendar and try again",
        );
      const connection = await repository.findActiveConnection(
        input.principalId,
        "zoom",
      );
      if (
        !connection ||
        connection.id !== row.connection_id ||
        connection.nangoConnectionId !== row.nango_connection_id ||
        connection.nangoIntegrationId !== row.nango_integration_id
      )
        throw new PersonalIntegrationUnavailableError(
          "Reconnect the original Zoom account before deleting this calendar event",
        );
      await this.sync({
        principalId: input.principalId,
        connectionId: row.connection_id,
        resourceKey: row.resource_key,
        title: "Cancelled meeting",
        startsAt: "1970-01-01T00:00:00.000Z",
        endsAt: "1970-01-01T00:01:00.000Z",
        cancelled: true,
      });
      return true;
    },
  };
}
