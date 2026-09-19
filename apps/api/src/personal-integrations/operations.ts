import type {
  ActivePersonalIntegrationConnection,
  PersonalIntegrationNangoClient,
  PersonalIntegrationProviderId,
  PersonalIntegrationRepository,
} from "./contracts";
import {
  PersonalIntegrationInputError,
  PersonalIntegrationUnavailableError,
  PersonalIntegrationUpstreamError,
} from "./contracts";

export type PersonalFile = {
  id: string;
  name: string;
  mimeType: string | null;
  modifiedAt: string | null;
};

export type PersonalMessage = {
  id: string;
  subject: string | null;
  sender: string | null;
  receivedAt: string | null;
};

export type PersonalEvent = {
  id: string;
  title: string | null;
  startsAt: string | null;
  endsAt: string | null;
  webLink: string | null;
};

export type PersonalIntegrationActionResult = {
  provider:
    | "google_drive"
    | "gmail"
    | "outlook"
    | "google_calendar"
    | "onedrive_personal"
    | "onedrive_business";
  action: "send-email" | "create-event" | "upload-file";
};

function fileProvider(provider: PersonalIntegrationProviderId): boolean {
  return (
    provider === "google_drive" ||
    provider === "onedrive_personal" ||
    provider === "onedrive_business"
  );
}

function safeSearchTerm(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 100 || /['"\\]/.test(normalized))
    throw new PersonalIntegrationUnavailableError("The file search is invalid");
  return normalized;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function secureWebLink(value: unknown): string | null {
  const link = stringValue(value);
  if (!link) return null;
  try {
    return new URL(link).protocol === "https:" ? link : null;
  } catch {
    return null;
  }
}

function invalidAction(message: string): never {
  throw new PersonalIntegrationInputError(message);
}

function actionObject(value: Record<string, unknown>): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : invalidAction("The personal integration action is invalid");
}

function requiredActionText(
  input: Record<string, unknown>,
  field: string,
  maximum: number,
): string {
  const value = input[field];
  if (typeof value !== "string")
    return invalidAction(`The ${field} field is required`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum)
    return invalidAction(`The ${field} field is invalid`);
  return normalized;
}

function emailRecipients(
  input: Record<string, unknown>,
  field: "to" | "attendees",
  required: boolean,
): string[] {
  const value = input[field];
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || value.length === 0 || value.length > 20)
    return invalidAction(`The ${field} field is invalid`);
  return value.map((entry) => {
    if (typeof entry !== "string")
      return invalidAction(`The ${field} field is invalid`);
    const email = entry.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return invalidAction(`The ${field} field is invalid`);
    return email;
  });
}

function emailProvider(value: unknown): "gmail" | "outlook" {
  if (value === "gmail" || value === "outlook") return value;
  return invalidAction("The email provider is invalid");
}

function calendarProvider(value: unknown): "google_calendar" | "outlook" {
  if (value === "google_calendar" || value === "outlook") return value;
  return invalidAction("The calendar provider is invalid");
}

function uploadProvider(
  value: unknown,
): "google_drive" | "onedrive_personal" | "onedrive_business" {
  if (
    value === "google_drive" ||
    value === "onedrive_personal" ||
    value === "onedrive_business"
  )
    return value;
  return invalidAction("The file provider is invalid");
}

function uploadName(input: Record<string, unknown>): string {
  const name = requiredActionText(input, "name", 200);
  if (
    name === "." ||
    name === ".." ||
    /[\\/\u0000]/.test(name)
  )
    return invalidAction("The file name is invalid");
  return name;
}

function uploadContent(input: Record<string, unknown>): string {
  const content = input.content;
  if (typeof content !== "string" || !content || content.length > 1_000_000)
    return invalidAction("The file content is invalid");
  return content;
}

function uploadMimeType(input: Record<string, unknown>): string {
  const mimeType = input.mimeType ?? "text/plain";
  if (
    mimeType !== "text/plain" &&
    mimeType !== "text/markdown" &&
    mimeType !== "text/csv" &&
    mimeType !== "application/json"
  )
    return invalidAction("The file type is invalid");
  return mimeType;
}

function driveMultipartUpload(input: {
  name: string;
  content: string;
  mimeType: string;
}): string {
  const boundary = "savia-upload";
  return [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify({ name: input.name, mimeType: input.mimeType }),
    `--${boundary}`,
    `Content-Type: ${input.mimeType}; charset=UTF-8`,
    "",
    input.content,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

function eventDate(input: Record<string, unknown>, field: string): Date {
  const value = requiredActionText(input, field, 64);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()))
    return invalidAction(`The ${field} field is invalid`);
  return parsed;
}

function graphDateTime(date: Date) {
  return {
    dateTime: date.toISOString().replace(".000Z", ""),
    timeZone: "UTC",
  };
}

const outlookUtcPreference = { prefer: 'outlook.timezone="UTC"' } as const;

function graphResponseDateTime(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const dateTime = stringValue((value as Record<string, unknown>).dateTime);
  if (!dateTime) return null;
  const timeZone = stringValue((value as Record<string, unknown>).timeZone);
  return timeZone === "UTC" && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(dateTime)
    ? `${dateTime}Z`
    : dateTime;
}

function gmailRawMessage(input: {
  to: string[];
  subject: string;
  body: string;
}): string {
  const bytes = new TextEncoder().encode(
    `To: ${input.to.join(", ")}\r\nSubject: ${input.subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${input.body}`,
  );
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function filesFromGoogle(payload: unknown): PersonalFile[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const files = (payload as { files?: unknown }).files;
  if (!Array.isArray(files)) return [];
  return files.flatMap((file) => {
    if (!file || typeof file !== "object" || Array.isArray(file)) return [];
    const item = file as Record<string, unknown>;
    const id = stringValue(item.id);
    const name = stringValue(item.name);
    if (!id || !name) return [];
    return [{
      id,
      name,
      mimeType: stringValue(item.mimeType),
      modifiedAt: stringValue(item.modifiedTime),
    }];
  });
}

function filesFromOneDrive(payload: unknown): PersonalFile[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const files = (payload as { value?: unknown }).value;
  if (!Array.isArray(files)) return [];
  return files.flatMap((file) => {
    if (!file || typeof file !== "object" || Array.isArray(file)) return [];
    const item = file as Record<string, unknown>;
    const id = stringValue(item.id);
    const name = stringValue(item.name);
    if (!id || !name) return [];
    const fileMetadata =
      item.file && typeof item.file === "object" && !Array.isArray(item.file)
        ? (item.file as Record<string, unknown>)
        : undefined;
    return [{
      id,
      name,
      mimeType: stringValue(fileMetadata?.mimeType),
      modifiedAt: stringValue(item.lastModifiedDateTime),
    }];
  });
}

function messagesFromGmail(payload: unknown): PersonalMessage[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const messages = (payload as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((message) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return [];
    const id = stringValue((message as Record<string, unknown>).id);
    return id ? [{ id, subject: null, sender: null, receivedAt: null }] : [];
  });
}

function messagesFromOutlook(payload: unknown): PersonalMessage[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const messages = (payload as { value?: unknown }).value;
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((message) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return [];
    const item = message as Record<string, unknown>;
    const id = stringValue(item.id);
    if (!id) return [];
    const from =
      item.from && typeof item.from === "object" && !Array.isArray(item.from)
        ? (item.from as { emailAddress?: { address?: unknown } }).emailAddress
        : undefined;
    return [{
      id,
      subject: stringValue(item.subject),
      sender: stringValue(from?.address),
      receivedAt: stringValue(item.receivedDateTime),
    }];
  });
}

function eventsFromGoogle(payload: unknown): PersonalEvent[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const events = (payload as { items?: unknown }).items;
  if (!Array.isArray(events)) return [];
  return events.flatMap((event) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) return [];
    const item = event as Record<string, unknown>;
    const id = stringValue(item.id);
    if (!id) return [];
    const start = item.start as { dateTime?: unknown; date?: unknown } | undefined;
    const end = item.end as { dateTime?: unknown; date?: unknown } | undefined;
    return [{
      id,
      title: stringValue(item.summary),
      startsAt: stringValue(start?.dateTime) ?? stringValue(start?.date),
      endsAt: stringValue(end?.dateTime) ?? stringValue(end?.date),
      webLink: secureWebLink(item.htmlLink),
    }];
  });
}

function eventsFromOutlook(payload: unknown): PersonalEvent[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const events = (payload as { value?: unknown }).value;
  if (!Array.isArray(events)) return [];
  return events.flatMap((event) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) return [];
    const item = event as Record<string, unknown>;
    const id = stringValue(item.id);
    if (!id) return [];
    const start = item.start;
    const end = item.end;
    return [{
      id,
      title: stringValue(item.subject),
      startsAt: graphResponseDateTime(start),
      endsAt: graphResponseDateTime(end),
      webLink: secureWebLink(item.webLink),
    }];
  });
}

export class PersonalIntegrationOperations {
  constructor(
    private readonly repository: PersonalIntegrationRepository,
    private readonly nango: PersonalIntegrationNangoClient,
  ) {}

  async searchFiles(input: {
    principalId: string;
    provider: PersonalIntegrationProviderId;
    query: string;
  }): Promise<PersonalFile[]> {
    if (!fileProvider(input.provider))
      throw new PersonalIntegrationUnavailableError(
        "The requested provider does not support file search",
      );
    const connection = await this.repository.findActiveConnection(
      input.principalId,
      input.provider,
    );
    if (!connection || connection.status !== "connected")
      throw new PersonalIntegrationUnavailableError(
        "The personal integration connection is not ready",
      );
    const term = safeSearchTerm(input.query);
    const path =
      input.provider === "google_drive"
        ? `/drive/v3/files?${new URLSearchParams({
            pageSize: "25",
            fields: "files(id,name,mimeType,modifiedTime)",
            q: `name contains '${term}' and trashed = false`,
          }).toString()}`
        : `/v1.0/me/drive/root/search(q='${encodeURIComponent(term)}')?${new URLSearchParams({
            "$top": "25",
            "$select": "id,name,file,lastModifiedDateTime",
          }).toString()}`;
    const response = await this.nango.proxy({ method: "GET", path, connection });
    if (!response.ok) throw new PersonalIntegrationUpstreamError();
    const payload = await response.json().catch(() => undefined);
    return input.provider === "google_drive"
      ? filesFromGoogle(payload)
      : filesFromOneDrive(payload);
  }

  async listMessages(input: {
    principalId: string;
    provider: "gmail" | "outlook";
    query: string;
  }): Promise<PersonalMessage[]> {
    const connection = await this.repository.findActiveConnection(
      input.principalId,
      input.provider,
    );
    if (!connection || connection.status !== "connected")
      throw new PersonalIntegrationUnavailableError(
        "The personal integration connection is not ready",
      );
    const term = safeSearchTerm(input.query);
    const path =
      input.provider === "gmail"
        ? `/gmail/v1/users/me/messages?${new URLSearchParams({
            maxResults: "25",
            q: term,
          }).toString()}`
        : `/v1.0/me/messages?${new URLSearchParams({
            "$top": "25",
            "$select": "id,subject,from,receivedDateTime",
            "$filter": `contains(subject,'${term}')`,
          }).toString()}`;
    const response = await this.nango.proxy({ method: "GET", path, connection });
    if (!response.ok) throw new PersonalIntegrationUpstreamError();
    const payload = await response.json().catch(() => undefined);
    return input.provider === "gmail"
      ? messagesFromGmail(payload)
      : messagesFromOutlook(payload);
  }

  async listEvents(input: {
    principalId: string;
    provider: "google_calendar" | "outlook";
    from?: Date;
    to?: Date;
  }): Promise<PersonalEvent[]> {
    if (Boolean(input.from) !== Boolean(input.to))
      return invalidAction("The event time range is invalid");
    if (
      input.from &&
      input.to &&
      (Number.isNaN(input.from.getTime()) ||
        Number.isNaN(input.to.getTime()) ||
        input.to <= input.from)
    )
      return invalidAction("The event time range is invalid");
    const connection = await this.repository.findActiveConnection(
      input.principalId,
      input.provider,
    );
    if (!connection || connection.status !== "connected")
      throw new PersonalIntegrationUnavailableError(
        "The personal integration connection is not ready",
      );
    const path =
      input.provider === "google_calendar"
        ? `/calendar/v3/calendars/primary/events?${new URLSearchParams({
            maxResults: "25",
            singleEvents: "true",
            orderBy: "startTime",
            timeMin: (input.from ?? new Date()).toISOString(),
            ...(input.to ? { timeMax: input.to.toISOString() } : {}),
          }).toString()}`
        : input.from && input.to
          ? `/v1.0/me/calendarView?${new URLSearchParams({
              startDateTime: input.from.toISOString(),
              endDateTime: input.to.toISOString(),
              "$top": "50",
              "$orderby": "start/dateTime",
              "$select": "id,subject,start,end,webLink",
            }).toString()}`
          : `/v1.0/me/events?${new URLSearchParams({
              "$top": "25",
              "$select": "id,subject,start,end,webLink",
            }).toString()}`;
    const response = await this.nango.proxy({
      method: "GET",
      path,
      connection,
      ...(input.provider === "outlook"
        ? { upstreamHeaders: outlookUtcPreference }
        : {}),
    });
    if (!response.ok) throw new PersonalIntegrationUpstreamError();
    const payload = await response.json().catch(() => undefined);
    return input.provider === "google_calendar"
      ? eventsFromGoogle(payload)
      : eventsFromOutlook(payload);
  }

  async createCalendarEvent(input: {
    principalId: string;
    provider: "google_calendar" | "outlook";
    title: string;
    startsAt: string;
    endsAt: string;
  }): Promise<PersonalEvent> {
    const title = requiredActionText(input, "title", 2000);
    const startsAt = eventDate(input, "startsAt");
    const endsAt = eventDate(input, "endsAt");
    if (endsAt <= startsAt)
      return invalidAction("The event end must be after its start");
    const connection = await this.connectedConnection(input.principalId, input.provider);
    const response = await this.write(
      connection,
      "create-event",
      input.provider === "google_calendar"
        ? {
            method: "POST",
            path: "/calendar/v3/calendars/primary/events",
            body: {
              summary: title,
              start: { dateTime: startsAt.toISOString() },
              end: { dateTime: endsAt.toISOString() },
            },
          }
        : {
            method: "POST",
            path: "/v1.0/me/events",
            body: {
              subject: title,
              start: graphDateTime(startsAt),
              end: graphDateTime(endsAt),
            },
            upstreamHeaders: outlookUtcPreference,
          },
    );
    const payload = await response.json().catch(() => undefined);
    const event =
      input.provider === "google_calendar"
        ? eventsFromGoogle({ items: [payload] })[0]
        : eventsFromOutlook({ value: [payload] })[0];
    if (!event) throw new PersonalIntegrationUpstreamError();
    return event;
  }

  async executeConfirmedAction(input: {
    principalId: string;
    command: string;
    input: Record<string, unknown>;
  }): Promise<PersonalIntegrationActionResult> {
    const action = actionObject(input.input);
    if (input.command === "send-email") {
      const provider = emailProvider(action.provider);
      const to = emailRecipients(action, "to", true);
      const subject = requiredActionText(action, "subject", 2000);
      const body = requiredActionText(action, "body", 10_000);
      const connection = await this.connectedConnection(input.principalId, provider);
      const request =
        provider === "gmail"
          ? {
              method: "POST" as const,
              path: "/gmail/v1/users/me/messages/send",
              body: { raw: gmailRawMessage({ to, subject, body }) },
            }
          : {
              method: "POST" as const,
              path: "/v1.0/me/sendMail",
              body: {
                message: {
                  subject,
                  body: { contentType: "Text", content: body },
                  toRecipients: to.map((address) => ({
                    emailAddress: { address },
                  })),
                },
                saveToSentItems: true,
              },
            };
      await this.write(connection, "send-email", request);
      return { provider, action: "send-email" };
    }
    if (input.command === "create-event") {
      const provider = calendarProvider(action.provider);
      const title = requiredActionText(action, "title", 2000);
      const startsAt = eventDate(action, "startsAt");
      const endsAt = eventDate(action, "endsAt");
      if (endsAt <= startsAt)
        return invalidAction("The event end must be after its start");
      const attendees = emailRecipients(action, "attendees", false);
      const connection = await this.connectedConnection(input.principalId, provider);
      const request =
        provider === "google_calendar"
          ? {
              method: "POST" as const,
              path: "/calendar/v3/calendars/primary/events",
              body: {
                summary: title,
                start: { dateTime: startsAt.toISOString() },
                end: { dateTime: endsAt.toISOString() },
                attendees: attendees.map((email) => ({ email })),
              },
            }
          : {
              method: "POST" as const,
              path: "/v1.0/me/events",
              body: {
                subject: title,
                start: graphDateTime(startsAt),
                end: graphDateTime(endsAt),
                attendees: attendees.map((address) => ({
                  emailAddress: { address },
                  type: "required",
                })),
              },
              upstreamHeaders: outlookUtcPreference,
            };
      await this.write(connection, "create-event", request);
      return { provider, action: "create-event" };
    }
    if (input.command === "upload-file") {
      const provider = uploadProvider(action.provider);
      const name = uploadName(action);
      const content = uploadContent(action);
      const mimeType = uploadMimeType(action);
      const connection = await this.connectedConnection(input.principalId, provider);
      const request =
        provider === "google_drive"
          ? {
              method: "POST" as const,
              path: "/upload/drive/v3/files?uploadType=multipart",
              rawBody: driveMultipartUpload({ name, content, mimeType }),
              contentType: "multipart/related; boundary=savia-upload",
            }
          : {
              method: "PUT" as const,
              path: `/v1.0/me/drive/root:/${encodeURIComponent(name)}:/content?%40microsoft.graph.conflictBehavior=fail`,
              rawBody: content,
              contentType: `${mimeType}; charset=utf-8`,
              upstreamHeaders: { "if-match": "0" },
            };
      await this.write(connection, "upload-file", request);
      return { provider, action: "upload-file" };
    }
    return invalidAction("The personal integration action is not supported");
  }

  private async connectedConnection(
    principalId: string,
    provider: PersonalIntegrationProviderId,
  ) {
    const connection = await this.repository.findActiveConnection(
      principalId,
      provider,
    );
    if (!connection || connection.status !== "connected")
      throw new PersonalIntegrationUnavailableError(
        "The personal integration connection is not ready",
      );
    return connection;
  }

  private async write(
    connection: ActivePersonalIntegrationConnection,
    eventType: "send-email" | "create-event" | "upload-file",
    request: {
      method: "POST" | "PUT";
      path: string;
      body?: unknown;
      rawBody?: string;
      contentType?: string;
      upstreamHeaders?: Partial<Record<"if-match" | "prefer", string>>;
    },
  ): Promise<Response> {
    try {
      const response = await this.nango.proxy({ ...request, connection });
      if (!response.ok) {
        await this.repository.appendAuditEvent({
          connection,
          eventType,
          outcome: "failed",
          errorCode: "UPSTREAM_REJECTED",
        });
        throw new PersonalIntegrationUpstreamError();
      }
      await this.repository.appendAuditEvent({
        connection,
        eventType,
        outcome: "succeeded",
      });
      return response;
    } catch (error) {
      if (error instanceof PersonalIntegrationUpstreamError) throw error;
      await this.repository.appendAuditEvent({
        connection,
        eventType,
        outcome: "failed",
        errorCode: "UPSTREAM_UNAVAILABLE",
      });
      throw new PersonalIntegrationUpstreamError();
    }
  }
}
