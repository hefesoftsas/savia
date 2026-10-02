import {
  sendPersonalMailSchema,
  type PersonalMailPage,
  type SendPersonalMailInput,
} from "@savia/studio-shared/mail-contracts";
import {
  normalizeGmailMessage,
  normalizeOutlookMessage,
} from "./mail-metadata";
import type {
  ActivePersonalIntegrationConnection,
  PersonalIntegrationNangoClient,
  PersonalIntegrationProviderId,
  PersonalIntegrationRepository,
} from "./contracts";
import {
  PersonalIntegrationAccessError,
  PersonalIntegrationInputError,
  PersonalIntegrationUnavailableError,
  PersonalIntegrationUpstreamError,
} from "./contracts";
import { parseIssueLink } from "@savia/studio-shared/issue-links";

export type PersonalFile = {
  id: string;
  name: string;
  mimeType: string | null;
  modifiedAt: string | null;
};

export type PersonalMessage = {
  webLink: string | null;
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

export type PersonalIssuePreview = {
  provider: "jira" | "linear";
  url: string;
  identifier: string;
  title: string;
  status: string | null;
  assignee: string | null;
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

type MailContinuation =
  | { provider: "gmail"; kind: "page-token"; token: string }
  | {
      provider: "outlook";
      kind: "skip" | "skip-token";
      value: string;
    };

type MailCursor = {
  version: 1;
  provider: "gmail" | "outlook";
  query: string | null;
  connectionId: string;
  continuation: MailContinuation;
};

function encodeMailCursor(cursor: MailCursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeMailCursor(
  value: string,
  expected: Omit<MailCursor, "continuation">,
): MailContinuation {
  if (!/^[A-Za-z0-9_-]{1,2048}$/.test(value))
    return invalidAction("The mail cursor is invalid");
  try {
    const standard = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(standard + "=".repeat((4 - (standard.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    const cursor = JSON.parse(new TextDecoder().decode(bytes)) as MailCursor;
    if (
      cursor.version !== 1 ||
      cursor.provider !== expected.provider ||
      cursor.query !== expected.query ||
      cursor.connectionId !== expected.connectionId ||
      !cursor.continuation ||
      cursor.continuation.provider !== expected.provider
    )
      return invalidAction("The mail cursor is invalid");
    if (
      cursor.provider === "gmail" &&
      cursor.continuation.kind === "page-token" &&
      typeof cursor.continuation.token === "string" &&
      cursor.continuation.token.length > 0 &&
      cursor.continuation.token.length <= 1024
    )
      return cursor.continuation;
    if (
      cursor.provider === "outlook" &&
      cursor.continuation.kind === "skip-token" &&
      typeof cursor.continuation.value === "string" &&
      cursor.continuation.value.length > 0 &&
      cursor.continuation.value.length <= 1024
    )
      return cursor.continuation;
    if (
      cursor.provider === "outlook" &&
      cursor.continuation.kind === "skip" &&
      typeof cursor.continuation.value === "string" &&
      /^(?:0|[1-9][0-9]{0,6})$/.test(cursor.continuation.value)
    )
      return cursor.continuation;
  } catch {
    // Invalid cursors are a client input error, with no upstream request made.
  }
  return invalidAction("The mail cursor is invalid");
}

function outlookContinuation(
  value: unknown,
  path: string,
  parameters: URLSearchParams,
): MailContinuation | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    // Graph canonicalizes the same Inbox with OData key syntax in nextLink.
    const matchesPath =
      url.pathname === path ||
      (path === "/v1.0/me/mailFolders/inbox/messages" &&
        url.pathname === "/v1.0/me/mailFolders('inbox')/messages");
    if (
      url.protocol !== "https:" ||
      url.hostname !== "graph.microsoft.com" ||
      url.port !== "" ||
      url.username ||
      url.password ||
      !matchesPath ||
      url.hash
    )
      return null;
    const fixedKeys = new Set(
      [...parameters.keys()].filter(
        (key) => key !== "$skip" && key !== "$skiptoken",
      ),
    );
    for (const key of url.searchParams.keys()) {
      if (fixedKeys.has(key)) {
        if (url.searchParams.getAll(key).length !== 1) return null;
        if (url.searchParams.get(key) !== parameters.get(key)) return null;
      } else if (key !== "$skip" && key !== "$skiptoken") {
        return null;
      }
    }
    const skipToken = url.searchParams.getAll("$skiptoken");
    const skip = url.searchParams.getAll("$skip");
    if (skipToken.length === 1 && skip.length === 0 && skipToken[0])
      return skipToken[0].length <= 1024
        ? { provider: "outlook", kind: "skip-token", value: skipToken[0] }
        : null;
    if (
      skip.length === 1 &&
      skipToken.length === 0 &&
      /^(?:0|[1-9][0-9]{0,6})$/.test(skip[0] ?? "")
    )
      return { provider: "outlook", kind: "skip", value: skip[0] ?? "" };
  } catch {
    return null;
  }
  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requiredIssueText(value: unknown, maximum: number): string {
  if (typeof value !== "string") throw new PersonalIntegrationUpstreamError();
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum)
    throw new PersonalIntegrationUpstreamError();
  return normalized;
}

function nestedIssueText(
  value: unknown,
  property: string,
  maximum: number,
): string | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PersonalIntegrationUpstreamError();
  const text = (value as Record<string, unknown>)[property];
  if (text === null || text === undefined) return null;
  return requiredIssueText(text, maximum);
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
  if (name === "." || name === ".." || /[\\/\u0000]/.test(name))
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

function microsoftDocumentProvider(
  value: unknown,
): "onedrive_personal" | "onedrive_business" {
  if (value === "onedrive_personal" || value === "onedrive_business")
    return value;
  return invalidAction("The document provider is invalid");
}

function documentName(value: unknown): string {
  if (typeof value !== "string")
    return invalidAction("The file name is required");
  const name = value.trim();
  if (
    !name ||
    name.length > 200 ||
    name === "." ||
    name === ".." ||
    /[\\/\u0000-\u001f\u007f]/.test(name)
  )
    return invalidAction("The file name is invalid");
  return name;
}

function documentMimeType(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 127 ||
    !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(value)
  )
    return invalidAction("The file type is invalid");
  return value;
}

function documentBytes(
  value: unknown,
  maximum: number,
): Uint8Array<ArrayBuffer> {
  if (!(value instanceof Uint8Array) || value.byteLength > maximum)
    return invalidAction("The file content is invalid or too large");
  return new Uint8Array(value);
}

function documentFolderId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 256 ||
    /[\\/\u0000-\u001f\u007f]/.test(value) ||
    value === "." ||
    value === ".."
  )
    return invalidAction("The folder ID is invalid");
  return value;
}

function assertExpectedConnectionKey(
  connection: ActivePersonalIntegrationConnection,
  expectedConnectionKey: string | undefined,
): void {
  if (
    expectedConnectionKey !== undefined &&
    expectedConnectionKey !== `${connection.id}:${connection.updatedAt}`
  )
    throw new PersonalIntegrationUnavailableError(
      "The reviewed personal integration connection has changed",
    );
}

function foldersFromOneDrive(
  payload: unknown,
): Array<{ id: string; name: string }> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new PersonalIntegrationUpstreamError();
  const items = (payload as { value?: unknown }).value;
  if (!Array.isArray(items)) throw new PersonalIntegrationUpstreamError();
  return items.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new PersonalIntegrationUpstreamError();
    const entry = item as Record<string, unknown>;
    const folder = entry.folder;
    if (!("folder" in entry)) return [];
    if (!folder || typeof folder !== "object" || Array.isArray(folder))
      throw new PersonalIntegrationUpstreamError();
    const id = stringValue(entry.id);
    const name = stringValue(entry.name);
    if (!id || !name) throw new PersonalIntegrationUpstreamError();
    return [{ id, name }];
  });
}

function nextFolderPagePath(
  payload: unknown,
  collectionPath: string,
): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return null;
  const record = payload as Record<string, unknown>;
  if (!("@odata.nextLink" in record)) return null;
  const nextLink = record["@odata.nextLink"];
  if (typeof nextLink !== "string" || nextLink.length > 8192)
    throw new PersonalIntegrationUpstreamError();

  let url: URL;
  try {
    url = new URL(nextLink);
  } catch {
    throw new PersonalIntegrationUpstreamError();
  }
  const graphHosts = new Set([
    "graph.microsoft.com",
    "graph.microsoft.us",
    "dod-graph.microsoft.us",
    "microsoftgraph.chinacloudapi.cn",
  ]);
  if (
    url.protocol !== "https:" ||
    !graphHosts.has(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    url.pathname !== collectionPath
  )
    throw new PersonalIntegrationUpstreamError();

  const allowedParameters = new Set(["$top", "$select", "$skiptoken", "$skip"]);
  const parameterNames = [...url.searchParams.keys()];
  if (
    parameterNames.some((name) => !allowedParameters.has(name)) ||
    new Set(parameterNames).size !== parameterNames.length ||
    (url.searchParams.has("$top") && url.searchParams.get("$top") !== "100") ||
    (url.searchParams.has("$select") &&
      url.searchParams.get("$select") !== "id,name,folder") ||
    (!url.searchParams.has("$skiptoken") && !url.searchParams.has("$skip")) ||
    (url.searchParams.has("$skip") &&
      !/^\d+$/.test(url.searchParams.get("$skip") ?? ""))
  )
    throw new PersonalIntegrationUpstreamError();

  return `${url.pathname}${url.search}`;
}

function fileBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
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
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function filesFromGoogle(payload: unknown): PersonalFile[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return [];
  const files = (payload as { files?: unknown }).files;
  if (!Array.isArray(files)) return [];
  return files.flatMap((file) => {
    if (!file || typeof file !== "object" || Array.isArray(file)) return [];
    const item = file as Record<string, unknown>;
    const id = stringValue(item.id);
    const name = stringValue(item.name);
    if (!id || !name) return [];
    return [
      {
        id,
        name,
        mimeType: stringValue(item.mimeType),
        modifiedAt: stringValue(item.modifiedTime),
      },
    ];
  });
}

function filesFromOneDrive(payload: unknown): PersonalFile[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return [];
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
    return [
      {
        id,
        name,
        mimeType: stringValue(fileMetadata?.mimeType),
        modifiedAt: stringValue(item.lastModifiedDateTime),
      },
    ];
  });
}

function eventsFromGoogle(payload: unknown): PersonalEvent[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return [];
  const events = (payload as { items?: unknown }).items;
  if (!Array.isArray(events)) return [];
  return events.flatMap((event) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) return [];
    const item = event as Record<string, unknown>;
    const id = stringValue(item.id);
    if (!id) return [];
    const start = item.start as
      { dateTime?: unknown; date?: unknown } | undefined;
    const end = item.end as { dateTime?: unknown; date?: unknown } | undefined;
    return [
      {
        id,
        title: stringValue(item.summary),
        startsAt: stringValue(start?.dateTime) ?? stringValue(start?.date),
        endsAt: stringValue(end?.dateTime) ?? stringValue(end?.date),
        webLink: secureWebLink(item.htmlLink),
      },
    ];
  });
}

function eventsFromOutlook(payload: unknown): PersonalEvent[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return [];
  const events = (payload as { value?: unknown }).value;
  if (!Array.isArray(events)) return [];
  return events.flatMap((event) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) return [];
    const item = event as Record<string, unknown>;
    const id = stringValue(item.id);
    if (!id) return [];
    const start = item.start;
    const end = item.end;
    return [
      {
        id,
        title: stringValue(item.subject),
        startsAt: graphResponseDateTime(start),
        endsAt: graphResponseDateTime(end),
        webLink: secureWebLink(item.webLink),
      },
    ];
  });
}

export class PersonalIntegrationOperations {
  constructor(
    private readonly repository: PersonalIntegrationRepository,
    private readonly nango: PersonalIntegrationNangoClient,
  ) {}

  async previewIssue(input: {
    principalId: string;
    url: string;
  }): Promise<PersonalIssuePreview> {
    const issueLink = parseIssueLink(input.url);
    if (!issueLink)
      throw new PersonalIntegrationInputError("The issue link is invalid");
    const connection = await this.connectedConnection(
      input.principalId,
      issueLink.provider,
    );
    if (issueLink.provider === "jira")
      return this.previewJiraIssue(connection, issueLink);
    return this.previewLinearIssue(connection, issueLink);
  }

  private async previewJiraIssue(
    connection: ActivePersonalIntegrationConnection,
    issueLink: NonNullable<ReturnType<typeof parseIssueLink>> & {
      provider: "jira";
      site: string;
    },
  ): Promise<PersonalIssuePreview> {
    const resourcesResponse = await this.nango.proxy({
      method: "GET",
      path: "/oauth/token/accessible-resources",
      connection,
    });
    if (resourcesResponse.status === 401 || resourcesResponse.status === 403)
      throw new PersonalIntegrationAccessError();
    if (!resourcesResponse.ok) throw new PersonalIntegrationUpstreamError();
    const resources = await resourcesResponse.json().catch(() => undefined);
    if (!Array.isArray(resources)) throw new PersonalIntegrationUpstreamError();
    const resource = resources.find((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        return false;
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.url !== "string") return false;
      try {
        const url = new URL(candidate.url);
        return (
          url.protocol === "https:" &&
          url.hostname === issueLink.site &&
          !url.username &&
          !url.password
        );
      } catch {
        return false;
      }
    }) as Record<string, unknown> | undefined;
    const cloudId = stringValue(resource?.id);
    if (!cloudId) throw new PersonalIntegrationAccessError();
    const issueResponse = await this.nango.proxy({
      method: "GET",
      path: `/ex/jira/${encodeURIComponent(cloudId)}/rest/api/3/issue/${encodeURIComponent(issueLink.identifier)}?fields=summary%2Cstatus%2Cassignee%2Ckey`,
      connection,
    });
    if (issueResponse.status === 401 || issueResponse.status === 403)
      throw new PersonalIntegrationAccessError();
    if (!issueResponse.ok) throw new PersonalIntegrationUpstreamError();
    const payload = await issueResponse.json().catch(() => undefined);
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw new PersonalIntegrationUpstreamError();
    const issue = payload as Record<string, unknown>;
    const fields = issue.fields;
    if (
      typeof issue.key !== "string" ||
      issue.key.toUpperCase() !== issueLink.identifier ||
      !fields ||
      typeof fields !== "object" ||
      Array.isArray(fields)
    )
      throw new PersonalIntegrationUpstreamError();
    const values = fields as Record<string, unknown>;
    const status = values.status;
    const assignee = values.assignee;
    return {
      provider: "jira",
      url: issueLink.url,
      identifier: issueLink.identifier,
      title: requiredIssueText(values.summary, 2000),
      status: nestedIssueText(status, "name", 255),
      assignee: nestedIssueText(assignee, "displayName", 255),
    };
  }

  private async previewLinearIssue(
    connection: ActivePersonalIntegrationConnection,
    issueLink: NonNullable<ReturnType<typeof parseIssueLink>> & {
      provider: "linear";
    },
  ): Promise<PersonalIssuePreview> {
    const response = await this.nango.proxy({
      method: "POST",
      path: "/graphql",
      connection,
      body: {
        query:
          "query SaviaIssuePreview($id: String!) { issue(id: $id) { identifier url title state { name } assignee { name } } }",
        variables: { id: issueLink.identifier },
      },
    });
    if (response.status === 401 || response.status === 403)
      throw new PersonalIntegrationAccessError();
    if (!response.ok) throw new PersonalIntegrationUpstreamError();
    const payload = await response.json().catch(() => undefined);
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw new PersonalIntegrationUpstreamError();
    const root = payload as Record<string, unknown>;
    if (Array.isArray(root.errors) && root.errors.length > 0)
      throw new PersonalIntegrationUpstreamError();
    const data = root.data;
    const issue =
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>).issue
        : undefined;
    if (!issue || typeof issue !== "object" || Array.isArray(issue))
      throw new PersonalIntegrationUpstreamError();
    const values = issue as Record<string, unknown>;
    if (
      typeof values.identifier !== "string" ||
      values.identifier.toUpperCase() !== issueLink.identifier
    )
      throw new PersonalIntegrationUpstreamError();
    const resolvedLink =
      typeof values.url === "string" ? parseIssueLink(values.url) : null;
    if (
      resolvedLink?.provider !== "linear" ||
      resolvedLink.identifier !== issueLink.identifier ||
      resolvedLink.workspace !== issueLink.workspace
    )
      throw new PersonalIntegrationUpstreamError();
    return {
      provider: "linear",
      url: issueLink.url,
      identifier: issueLink.identifier,
      title: requiredIssueText(values.title, 2000),
      status: nestedIssueText(values.state, "name", 255),
      assignee: nestedIssueText(values.assignee, "name", 255),
    };
  }

  async listDocumentFolders(input: {
    principalId: string;
    provider: "onedrive_personal" | "onedrive_business";
    parentId?: string;
  }): Promise<Array<{ id: string; name: string }>> {
    const provider = microsoftDocumentProvider(input.provider);
    const parentId =
      input.parentId === undefined
        ? undefined
        : documentFolderId(input.parentId);
    const connection = await this.connectedConnection(
      input.principalId,
      provider,
    );
    const path = parentId
      ? `/v1.0/me/drive/items/${encodeURIComponent(parentId)}/children?$top=100&$select=id,name,folder`
      : "/v1.0/me/drive/root/children?$top=100&$select=id,name,folder";
    const collectionPath = path.split("?", 1)[0] ?? path;
    const folders: Array<{ id: string; name: string }> = [];
    let pagePath: string | null = path;
    for (let page = 0; page < 10 && pagePath; page += 1) {
      const response = await this.nango.proxy({
        method: "GET",
        path: pagePath,
        connection,
      });
      if (!response.ok) throw new PersonalIntegrationUpstreamError();
      const payload: unknown = await response.json().catch(() => undefined);
      folders.push(...foldersFromOneDrive(payload));
      pagePath = nextFolderPagePath(payload, collectionPath);
      if (page === 9 && pagePath) throw new PersonalIntegrationUpstreamError();
    }
    return folders;
  }

  async saveDocumentCopy(input: {
    principalId: string;
    provider: "onedrive_personal" | "onedrive_business";
    expectedConnectionKey?: string;
    folderId?: string;
    name: string;
    mimeType: string;
    content: Uint8Array;
  }): Promise<{ id: string; name: string; webUrl: string | null }> {
    const provider = microsoftDocumentProvider(input.provider);
    const folderId =
      input.folderId === undefined
        ? undefined
        : documentFolderId(input.folderId);
    const name = documentName(input.name);
    const mimeType = documentMimeType(input.mimeType);
    const content = documentBytes(input.content, 5 * 1024 * 1024);
    const connection = await this.connectedConnection(
      input.principalId,
      provider,
    );
    assertExpectedConnectionKey(connection, input.expectedConnectionKey);
    const basePath = folderId
      ? `/v1.0/me/drive/items/${encodeURIComponent(folderId)}`
      : "/v1.0/me/drive/root";
    const response = await this.write(connection, "upload-file", {
      method: "PUT",
      path: `${basePath}:/${encodeURIComponent(name)}:/content?%40microsoft.graph.conflictBehavior=fail`,
      rawBody: content,
      contentType: mimeType,
    });
    const payload: unknown = await response.json().catch(() => undefined);
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw new PersonalIntegrationUpstreamError();
    const item = payload as Record<string, unknown>;
    const id = stringValue(item.id);
    const createdName = stringValue(item.name);
    if (!id || !createdName) throw new PersonalIntegrationUpstreamError();
    return { id, name: createdName, webUrl: secureWebLink(item.webUrl) };
  }

  async sendDocumentEmail(input: {
    principalId: string;
    expectedConnectionKey?: string;
    to: string[];
    subject: string;
    body: string;
    file: { name: string; mimeType: string; content: Uint8Array };
  }): Promise<void> {
    const to = emailRecipients({ to: input.to }, "to", true);
    const subject = requiredActionText(input, "subject", 2000);
    const body = requiredActionText(input, "body", 10_000);
    const file = actionObject(input.file as unknown as Record<string, unknown>);
    const name = documentName(file.name);
    const mimeType = documentMimeType(file.mimeType);
    const content = documentBytes(file.content, 2 * 1024 * 1024);
    const connection = await this.connectedConnection(
      input.principalId,
      "outlook",
    );
    assertExpectedConnectionKey(connection, input.expectedConnectionKey);
    await this.write(connection, "send-email", {
      method: "POST",
      path: "/v1.0/me/sendMail",
      body: {
        message: {
          subject,
          body: { contentType: "Text", content: body },
          toRecipients: to.map((address) => ({ emailAddress: { address } })),
          attachments: [
            {
              "@odata.type": "#microsoft.graph.fileAttachment",
              name,
              contentType: mimeType,
              contentBytes: fileBase64(content),
            },
          ],
        },
        saveToSentItems: true,
      },
    });
  }

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
        : `/v1.0/me/drive/root/search(q='${encodeURIComponent(term)}')?${new URLSearchParams(
            {
              $top: "25",
              $select: "id,name,file,lastModifiedDateTime",
            },
          ).toString()}`;
    const response = await this.nango.proxy({
      method: "GET",
      path,
      connection,
    });
    if (!response.ok) throw new PersonalIntegrationUpstreamError();
    const payload = await response.json().catch(() => undefined);
    return input.provider === "google_drive"
      ? filesFromGoogle(payload)
      : filesFromOneDrive(payload);
  }

  async listMessages(input: {
    principalId: string;
    provider: "gmail" | "outlook";
    query?: string;
  }): Promise<PersonalMessage[]> {
    return (await this.listMessagePage(input)).messages;
  }

  async listMessagePage(input: {
    principalId: string;
    provider: "gmail" | "outlook";
    query?: string;
    cursor?: string;
  }): Promise<PersonalMailPage> {
    const connection = await this.connectedConnection(
      input.principalId,
      input.provider,
    );
    const term =
      input.query === undefined ? undefined : safeSearchTerm(input.query);
    const parameters =
      input.provider === "gmail"
        ? new URLSearchParams({
            maxResults: "25",
            ...(term === undefined ? { labelIds: "INBOX" } : { q: term }),
          })
        : new URLSearchParams({
            $top: "25",
            $select: "id,subject,from,receivedDateTime,webLink",
            ...(term === undefined
              ? { $orderby: "receivedDateTime desc" }
              : { $filter: `contains(subject,'${term}')` }),
          });
    const expectedCursor = {
      version: 1 as const,
      provider: input.provider,
      query: term ?? null,
      connectionId: connection.id,
    };
    const continuation = input.cursor
      ? decodeMailCursor(input.cursor, expectedCursor)
      : undefined;
    if (
      continuation?.provider !== undefined &&
      continuation.provider !== input.provider
    )
      return invalidAction("The mail cursor is invalid");
    if (input.provider === "gmail" && continuation?.kind === "page-token")
      parameters.set("pageToken", continuation.token);
    if (input.provider === "outlook" && continuation?.kind === "skip-token")
      parameters.set("$skiptoken", continuation.value);
    if (input.provider === "outlook" && continuation?.kind === "skip")
      parameters.set("$skip", continuation.value);
    const providerPath =
      input.provider === "gmail"
        ? "/gmail/v1/users/me/messages"
        : `${term === undefined ? "/v1.0/me/mailFolders/inbox/messages" : "/v1.0/me/messages"}`;
    const path = `${providerPath}?${parameters}`;
    const response = await this.nango.proxy({
      method: "GET",
      path,
      connection,
    });
    if (!response.ok) throw new PersonalIntegrationUpstreamError();
    const payload = (await response.json().catch(() => undefined)) as
      | {
          messages?: unknown[];
          value?: unknown[];
          nextPageToken?: unknown;
          "@odata.nextLink"?: unknown;
        }
      | undefined;
    let next: MailContinuation | null = null;
    if (input.provider === "outlook") {
      const nextLink = payload?.["@odata.nextLink"];
      next = outlookContinuation(nextLink, providerPath, parameters);
      if (nextLink !== undefined && nextLink !== null && !next)
        throw new PersonalIntegrationUpstreamError();
      const messages = (Array.isArray(payload?.value) ? payload.value : [])
        .slice(0, 25)
        .flatMap((item) => {
          const message = normalizeOutlookMessage(item);
          return message ? [message] : [];
        });
      return {
        messages,
        nextCursor: next
          ? encodeMailCursor({ ...expectedCursor, continuation: next })
          : null,
      };
    }
    const rows = (Array.isArray(payload?.messages) ? payload.messages : [])
      .slice(0, 25)
      .flatMap((item) => {
        const message = normalizeGmailMessage(item);
        return message ? [message] : [];
      });
    const messages: PersonalMessage[] = [];
    for (let offset = 0; offset < rows.length; offset += 4) {
      messages.push(
        ...(await Promise.all(
          rows.slice(offset, offset + 4).map(async (row) => {
            try {
              const query = new URLSearchParams({ format: "metadata" });
              query.append("metadataHeaders", "Subject");
              query.append("metadataHeaders", "From");
              const detail = await this.nango.proxy({
                method: "GET",
                path: `/gmail/v1/users/me/messages/${encodeURIComponent(row.id)}?${query}`,
                connection,
              });
              if (!detail.ok) return row;
              const message = normalizeGmailMessage(await detail.json());
              return message?.id === row.id ? message : row;
            } catch {
              return row;
            }
          }),
        )),
      );
    }
    const nextPageToken = payload?.nextPageToken;
    if (
      typeof nextPageToken === "string" &&
      nextPageToken.length > 0 &&
      nextPageToken.length <= 1024
    )
      next = { provider: "gmail", kind: "page-token", token: nextPageToken };
    return {
      messages,
      nextCursor: next
        ? encodeMailCursor({ ...expectedCursor, continuation: next })
        : null,
    };
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
              $top: "50",
              $orderby: "start/dateTime",
              $select: "id,subject,start,end,webLink",
            }).toString()}`
          : `/v1.0/me/events?${new URLSearchParams({
              $top: "25",
              $select: "id,subject,start,end,webLink",
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
    const connection = await this.connectedConnection(
      input.principalId,
      input.provider,
    );
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

  async sendMail(
    input: SendPersonalMailInput & { principalId: string },
  ): Promise<PersonalIntegrationActionResult> {
    const { principalId, ...mail } = input;
    const parsed = sendPersonalMailSchema.safeParse(mail);
    if (!parsed.success)
      throw new PersonalIntegrationInputError("The email details are invalid");
    const { provider, to, subject, body } = parsed.data;
    const connection = await this.connectedConnection(principalId, provider);
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

  async executeConfirmedAction(input: {
    principalId: string;
    command: string;
    input: Record<string, unknown>;
  }): Promise<PersonalIntegrationActionResult> {
    const action = actionObject(input.input);
    if (input.command === "send-email") {
      return this.sendMail({
        principalId: input.principalId,
        provider: emailProvider(action.provider),
        to: emailRecipients(action, "to", true),
        subject: requiredActionText(action, "subject", 2000),
        body: requiredActionText(action, "body", 10_000),
      });
    }
    if (input.command === "create-event") {
      const provider = calendarProvider(action.provider);
      const title = requiredActionText(action, "title", 2000);
      const startsAt = eventDate(action, "startsAt");
      const endsAt = eventDate(action, "endsAt");
      if (endsAt <= startsAt)
        return invalidAction("The event end must be after its start");
      const attendees = emailRecipients(action, "attendees", false);
      const connection = await this.connectedConnection(
        input.principalId,
        provider,
      );
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
      const connection = await this.connectedConnection(
        input.principalId,
        provider,
      );
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
      rawBody?: string | Uint8Array<ArrayBuffer>;
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
