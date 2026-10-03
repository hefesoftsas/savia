import {
  calendarSourceSchema,
  type CalendarSource,
  type CreateCalendarSourceInput,
  type UpdateCalendarSourceInput,
} from "@savia/studio-shared/calendar-contracts";
import { CalendarCipher } from "./cipher";

export type StoredCalendarPayload = { url?: string; content: string };
export type StoredCalendarValidators = { etag?: string; lastModified?: string };

type CalendarRow = {
  id: string;
  principal_id: string;
  kind: "subscription" | "import";
  name: string;
  color: string;
  visible: number;
  time_zone: string;
  hostname: string | null;
  encrypted_payload: string;
  encrypted_validators: string | null;
  last_synced_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};

export class CalendarSourceNotFoundError extends Error {
  constructor() {
    super("Calendar source not found");
    this.name = "CalendarSourceNotFoundError";
  }
}
export class CalendarSourceLimitError extends Error {
  constructor() {
    super("The account may contain at most 20 calendar sources");
    this.name = "CalendarSourceLimitError";
  }
}
export class CalendarSourceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarSourceInputError";
  }
}

function toMetadata(row: CalendarRow): CalendarSource {
  return calendarSourceSchema.parse({
    id: row.id,
    kind: row.kind,
    name: row.name,
    color: row.color,
    visible: row.visible === 1,
    timeZone: row.time_zone,
    hostname: row.hostname,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class PersonalCalendarRepository {
  constructor(
    private readonly database: D1Database,
    private readonly cipher: CalendarCipher,
  ) {}

  async list(principalId: string): Promise<CalendarSource[]> {
    const result = await this.database
      .prepare(
        "SELECT * FROM personal_calendar_sources WHERE principal_id=? ORDER BY created_at,id",
      )
      .bind(principalId)
      .all<CalendarRow>();
    return (result.results ?? []).map(toMetadata);
  }

  async get(
    principalId: string,
    sourceId: string,
  ): Promise<CalendarRow | null> {
    return this.database
      .prepare(
        "SELECT * FROM personal_calendar_sources WHERE principal_id=? AND id=?",
      )
      .bind(principalId, sourceId)
      .first<CalendarRow>();
  }

  async readPrivate(
    principalId: string,
    sourceId: string,
  ): Promise<{
    row: CalendarRow;
    payload: StoredCalendarPayload;
    validators: StoredCalendarValidators | null;
  }> {
    const row = await this.get(principalId, sourceId);
    if (!row) throw new CalendarSourceNotFoundError();
    const payloadText = await this.cipher.open(
      principalId,
      sourceId,
      row.encrypted_payload,
    );
    let payload: StoredCalendarPayload;
    try {
      payload = JSON.parse(payloadText) as StoredCalendarPayload;
      if (!payload || typeof payload.content !== "string") throw new Error();
    } catch {
      throw new CalendarSourceInputError(
        "Stored calendar source content is invalid",
      );
    }
    let validators: StoredCalendarValidators | null = null;
    if (row.encrypted_validators) {
      try {
        validators = JSON.parse(
          await this.cipher.open(
            principalId,
            sourceId,
            row.encrypted_validators,
          ),
        ) as StoredCalendarValidators;
      } catch {
        throw new CalendarSourceInputError(
          "Stored calendar validators are invalid",
        );
      }
    }
    return { row, payload, validators };
  }

  async create(
    principalId: string,
    input: CreateCalendarSourceInput,
    payload: StoredCalendarPayload,
    validators: StoredCalendarValidators | null,
    lastSyncedAt: string | null,
  ): Promise<CalendarSource> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const encryptedPayload = await this.cipher.seal(
      principalId,
      id,
      JSON.stringify(payload),
    );
    const encryptedValidators = validators
      ? await this.cipher.seal(principalId, id, JSON.stringify(validators))
      : null;
    const hostname =
      input.kind === "subscription"
        ? new URL(input.url.replace(/^webcal:/i, "https:")).hostname
        : null;
    const inserted = await this.database
      .prepare(
        `
      INSERT INTO personal_calendar_sources (
        id,principal_id,kind,name,color,visible,time_zone,hostname,encrypted_payload,
        encrypted_validators,last_synced_at,revision,created_at,updated_at
      ) SELECT ?,?,?,?,?,1,?,?,?,?,?,1,?,? WHERE
        (SELECT COUNT(*) FROM personal_calendar_sources WHERE principal_id=?) < 20
    `,
      )
      .bind(
        id,
        principalId,
        input.kind,
        input.name,
        input.color ?? "blue",
        input.timeZone ?? "UTC",
        hostname,
        encryptedPayload,
        encryptedValidators,
        lastSyncedAt,
        now,
        now,
        principalId,
      )
      .run();
    if (!inserted.meta.changes) throw new CalendarSourceLimitError();
    const row = await this.get(principalId, id);
    if (!row) throw new Error("Calendar source insert did not persist");
    return toMetadata(row);
  }

  async update(
    principalId: string,
    sourceId: string,
    patch: UpdateCalendarSourceInput,
  ): Promise<CalendarSource> {
    const current = await this.get(principalId, sourceId);
    if (!current) throw new CalendarSourceNotFoundError();
    const now = new Date().toISOString();
    const values = {
      name: patch.name ?? current.name,
      color: patch.color ?? current.color,
      visible:
        patch.visible === undefined ? current.visible : Number(patch.visible),
      timeZone: patch.timeZone ?? current.time_zone,
    };
    const result = await this.database
      .prepare(
        `
      UPDATE personal_calendar_sources SET name=?,color=?,visible=?,time_zone=?,revision=revision+1,updated_at=?
      WHERE principal_id=? AND id=? AND revision=?
    `,
      )
      .bind(
        values.name,
        values.color,
        values.visible,
        values.timeZone,
        now,
        principalId,
        sourceId,
        current.revision,
      )
      .run();
    if (!result.meta.changes) throw new CalendarSourceNotFoundError();
    const row = await this.get(principalId, sourceId);
    if (!row) throw new CalendarSourceNotFoundError();
    return toMetadata(row);
  }

  async delete(principalId: string, sourceId: string): Promise<void> {
    const result = await this.database
      .prepare(
        "DELETE FROM personal_calendar_sources WHERE principal_id=? AND id=?",
      )
      .bind(principalId, sourceId)
      .run();
    if (!result.meta.changes) throw new CalendarSourceNotFoundError();
  }

  async replaceAfterRefresh(input: {
    principalId: string;
    sourceId: string;
    expectedRevision: number;
    payload: StoredCalendarPayload;
    validators: StoredCalendarValidators;
    syncedAt: string;
  }): Promise<boolean> {
    const payload = await this.cipher.seal(
      input.principalId,
      input.sourceId,
      JSON.stringify(input.payload),
    );
    const validators = await this.cipher.seal(
      input.principalId,
      input.sourceId,
      JSON.stringify(input.validators),
    );
    const result = await this.database
      .prepare(
        `
      UPDATE personal_calendar_sources SET encrypted_payload=?,encrypted_validators=?,last_synced_at=?,revision=revision+1,updated_at=?
      WHERE principal_id=? AND id=? AND revision=? AND kind='subscription'
    `,
      )
      .bind(
        payload,
        validators,
        input.syncedAt,
        input.syncedAt,
        input.principalId,
        input.sourceId,
        input.expectedRevision,
      )
      .run();
    return result.meta.changes > 0;
  }

  async saveValidatorsAfterNotModified(input: {
    principalId: string;
    sourceId: string;
    expectedRevision: number;
    validators: StoredCalendarValidators;
    syncedAt: string;
  }): Promise<boolean> {
    const encrypted = await this.cipher.seal(
      input.principalId,
      input.sourceId,
      JSON.stringify(input.validators),
    );
    const result = await this.database
      .prepare(
        `
      UPDATE personal_calendar_sources SET encrypted_validators=?,last_synced_at=?,revision=revision+1,updated_at=?
      WHERE principal_id=? AND id=? AND revision=? AND kind='subscription'
    `,
      )
      .bind(
        encrypted,
        input.syncedAt,
        input.syncedAt,
        input.principalId,
        input.sourceId,
        input.expectedRevision,
      )
      .run();
    return result.meta.changes > 0;
  }

  async savePreferences(
    principalId: string,
    settings: { google_calendar: boolean; outlook: boolean },
  ): Promise<void> {
    await this.database
      .prepare(
        `
      INSERT INTO user_calendar_preferences (principal_id,settings,updated_at) VALUES (?,?,?)
      ON CONFLICT(principal_id) DO UPDATE SET settings=excluded.settings,updated_at=excluded.updated_at
    `,
      )
      .bind(principalId, JSON.stringify(settings), new Date().toISOString())
      .run();
  }

  async getPreferences(principalId: string): Promise<unknown | null> {
    const row = await this.database
      .prepare(
        "SELECT settings FROM user_calendar_preferences WHERE principal_id=?",
      )
      .bind(principalId)
      .first<{ settings: string }>();
    if (!row) return null;
    try {
      return JSON.parse(row.settings);
    } catch {
      return null;
    }
  }
}
