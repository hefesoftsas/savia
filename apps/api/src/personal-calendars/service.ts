import {
  calendarLimits,
  calendarPreferencesSchema,
  createCalendarSourceSchema,
  type CalendarOccurrence,
  type CalendarPreferences,
  type CalendarRange,
  type CalendarSource,
  type CalendarSourceEvents,
  type CreateCalendarSourceInput,
  type UpdateCalendarSourceInput,
} from "@savia/studio-shared/calendar-contracts";
import { CalendarCipher } from "./cipher";
import {
  CalendarSourceInputError,
  CalendarSourceNotFoundError,
  PersonalCalendarRepository,
  type StoredCalendarPayload,
  type StoredCalendarValidators,
} from "./repository";
import { expandCalendar, validateCalendar, CalendarIcalError } from "./ical";
import {
  fetchCalendar,
  normalizeCalendarUrl,
  CalendarTransportError,
} from "./transport";

export class PersonalCalendarServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersonalCalendarServiceError";
  }
}

export class PersonalCalendarService {
  private readonly repository: PersonalCalendarRepository;
  private readonly cipher: CalendarCipher;

  constructor(
    database: D1Database,
    private readonly options: { secret?: string; fetcher?: typeof fetch } = {},
  ) {
    this.cipher = new CalendarCipher(options.secret);
    this.repository = new PersonalCalendarRepository(database, this.cipher);
  }

  list(principalId: string): Promise<CalendarSource[]> {
    return this.repository.list(principalId);
  }

  async create(
    principalId: string,
    rawInput: CreateCalendarSourceInput,
  ): Promise<CalendarSource> {
    const input = createCalendarSourceSchema.parse(rawInput);
    this.cipher.ensureAvailable();
    let payload: StoredCalendarPayload;
    let validators: StoredCalendarValidators | undefined;
    let lastSyncedAt: string | null = null;
    if (input.kind === "import") {
      try {
        validateCalendar(input.content);
      } catch (error) {
        throw new CalendarIcalError(
          error instanceof Error
            ? error.message
            : "The calendar file is invalid.",
        );
      }
      payload = { content: input.content };
    } else {
      const url = normalizeCalendarUrl(input.url);
      const fetched = await fetchCalendar({
        url: url.href,
        fetcher: this.options.fetcher,
      });
      if (fetched.status !== 200 || !fetched.content)
        throw new CalendarTransportError(
          "The new calendar subscription did not return a valid calendar.",
        );
      validateCalendar(fetched.content);
      payload = { url: url.href, content: fetched.content };
      validators = fetched.validators;
      lastSyncedAt = new Date().toISOString();
    }
    const source = await this.repository.create(
      principalId,
      input,
      payload,
      validators ?? null,
      lastSyncedAt,
    );
    return (
      (await this.repository.list(principalId)).find(
        (item) => item.id === source.id,
      ) ?? source
    );
  }

  async update(
    principalId: string,
    sourceId: string,
    patch: UpdateCalendarSourceInput,
  ): Promise<CalendarSource> {
    return this.repository.update(principalId, sourceId, patch);
  }

  delete(principalId: string, sourceId: string): Promise<void> {
    return this.repository.delete(principalId, sourceId);
  }

  async events(
    principalId: string,
    sourceId: string,
    range: CalendarRange,
  ): Promise<CalendarSourceEvents> {
    if (
      Date.parse(range.to) - Date.parse(range.from) >
      calendarLimits.maxDays * 86_400_000
    ) {
      throw new PersonalCalendarServiceError(
        "Calendar event ranges must not exceed 62 days.",
      );
    }
    // This owner-scoped lookup deliberately precedes any decryption or fetch.
    const stored = await this.repository.readPrivate(principalId, sourceId);
    let payload = stored.payload;
    let validators = stored.validators;
    let lastSyncedAt = stored.row.last_synced_at;
    let sourceTimeZone = stored.row.time_zone;
    let stale = false;
    let error: string | null = null;
    const shouldRefresh =
      stored.row.kind === "subscription" &&
      (range.refresh === true ||
        !lastSyncedAt ||
        Date.now() - Date.parse(lastSyncedAt) >= calendarLimits.freshnessMs);
    if (shouldRefresh) {
      try {
        if (!payload.url)
          throw new CalendarTransportError(
            "The saved subscription address is missing.",
          );
        const fetched = await fetchCalendar({
          url: payload.url,
          validators,
          fetcher: this.options.fetcher,
        });
        const refreshed =
          fetched.status === 304
            ? payload
            : { url: payload.url, content: fetched.content! };
        if (fetched.status === 200) validateCalendar(refreshed.content);
        const syncedAt = new Date().toISOString();
        const saved =
          fetched.status === 304
            ? await this.repository.saveValidatorsAfterNotModified({
                principalId,
                sourceId,
                expectedRevision: stored.row.revision,
                validators: fetched.validators,
                syncedAt,
              })
            : await this.repository.replaceAfterRefresh({
                principalId,
                sourceId,
                expectedRevision: stored.row.revision,
                payload: refreshed,
                validators: fetched.validators,
                syncedAt,
              });
        if (saved) {
          payload = refreshed;
          validators = fetched.validators;
          lastSyncedAt = syncedAt;
        } else {
          const currentRow = await this.repository.get(principalId, sourceId);
          if (!currentRow) throw new CalendarSourceNotFoundError();
          const current = await this.repository.readPrivate(
            principalId,
            sourceId,
          );
          payload = current.payload;
          validators = current.validators;
          lastSyncedAt = current.row.last_synced_at;
          sourceTimeZone = current.row.time_zone;
          stale = true;
          error = "The calendar source changed during synchronization.";
        }
      } catch (cause) {
        if (cause instanceof CalendarSourceNotFoundError) throw cause;
        stale = true;
        error =
          cause instanceof CalendarIcalError ||
          cause instanceof CalendarTransportError
            ? cause.message
            : "The calendar feed could not be refreshed.";
      }
    }
    try {
      const data = expandCalendar(payload.content, {
        sourceId: sourceId,
        from: range.from,
        to: range.to,
        timeZone: sourceTimeZone,
      });
      return { data, stale, error, lastSyncedAt };
    } catch (cause) {
      if (cause instanceof CalendarIcalError)
        throw new PersonalCalendarServiceError(cause.message);
      throw cause;
    }
  }

  async refresh(
    principalId: string,
    sourceId: string,
  ): Promise<CalendarSource> {
    const before = await this.repository.get(principalId, sourceId);
    if (!before) throw new CalendarSourceNotFoundError();
    if (before.kind !== "subscription")
      throw new PersonalCalendarServiceError(
        "Imported calendar copies cannot be refreshed.",
      );
    const result = await this.events(principalId, sourceId, {
      from: new Date(Date.now() - 1).toISOString(),
      to: new Date(Date.now() + 1).toISOString(),
      timeZone: before.time_zone,
      refresh: true,
    });
    if (result.error) throw new PersonalCalendarServiceError(result.error);
    const after = await this.repository.get(principalId, sourceId);
    if (!after) throw new CalendarSourceNotFoundError();
    return (await this.repository.list(principalId)).find(
      ({ id }) => id === sourceId,
    )!;
  }

  async getPreferences(principalId: string): Promise<CalendarPreferences> {
    const value = await this.repository.getPreferences(principalId);
    return calendarPreferencesSchema.parse(value ?? {});
  }

  async savePreferences(
    principalId: string,
    input: unknown,
  ): Promise<CalendarPreferences> {
    const preferences = calendarPreferencesSchema.parse(input);
    await this.repository.savePreferences(principalId, preferences);
    return preferences;
  }
}
