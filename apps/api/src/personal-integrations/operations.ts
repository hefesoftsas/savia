import {
  sendPersonalMailSchema,
  type PersonalMailPage,
  type SendPersonalMailInput,
} from "@savia/studio-shared/mail-contracts";
import {
  credibleGmailAccountAddress,
  gmailMessageLink,
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
import { createZoomMeetingService } from "./zoom";
import type { TicketSummaryConfig } from "@savia/studio-shared/ticket-summary";
import { fetchTicketSummary } from "./ticket-summary";

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
  connectionId?: string;
  title: string | null;
  startsAt: string | null;
  endsAt: string | null;
  webLink: string | null;
  allDay?: boolean;
  timeZone?: string | null;
  conference?: {
    provider: "google_meet" | "teams" | "jitsi" | "zoom" | null;
    joinUrl: string | null;
    status: "ready" | "pending" | "unsupported" | "failed";
  };
};

const calendarPageSize = 100;
const calendarPageLimit = 20;
const calendarEventLimit = 2000;
const calendarRangeMaxMilliseconds = 62 * 24 * 60 * 60 * 1000;
const googleVideoCallProperty = "saviaVideoCall";
const googleConferenceProviderProperty = "saviaConferenceProvider";
const googleConferenceUrlProperty = "saviaConferenceUrl";
const outlookVideoCallPropertyId =
  "String {6f8d1c44-1ab2-4e1e-9e8f-0123456789ac} Name SaviaVideoCall";
const outlookBookingPropertyId =
  "String {6f8d1c44-1ab2-4e1e-9e8f-0123456789ab} Name SaviaBookingId";
const outlookConferenceProviderPropertyId =
  "String {6f8d1c44-1ab2-4e1e-9e8f-0123456789ac} Name SaviaConferenceProvider";
const outlookConferenceUrlPropertyId =
  "String {6f8d1c44-1ab2-4e1e-9e8f-0123456789ac} Name SaviaConferenceUrl";
const outlookVideoCallExpand = `singleValueExtendedProperties($filter=id eq '${outlookVideoCallPropertyId}' or id eq '${outlookConferenceProviderPropertyId}' or id eq '${outlookConferenceUrlPropertyId}')`;

// Microsoft Graph returns Windows timezone IDs. Keep this small, explicit map
// for common mailbox zones; unknown IDs fail closed instead of shifting dates.
const outlookWindowsTimeZones: Record<string, string> = {
  UTC: "UTC",
  "Coordinated Universal Time": "UTC",
  "Pacific Standard Time": "America/Los_Angeles",
  "US Mountain Standard Time": "America/Phoenix",
  "Mountain Standard Time": "America/Denver",
  "Central Standard Time": "America/Chicago",
  "Eastern Standard Time": "America/New_York",
  "Alaskan Standard Time": "America/Anchorage",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Atlantic Standard Time": "America/Halifax",
  "Newfoundland Standard Time": "America/St_Johns",
  "SA Pacific Standard Time": "America/Bogota",
  "Venezuela Standard Time": "America/Caracas",
  "Argentina Standard Time": "America/Argentina/Buenos_Aires",
  "E. South America Standard Time": "America/Sao_Paulo",
  "GMT Standard Time": "Europe/London",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "Central Europe Standard Time": "Europe/Budapest",
  "E. Europe Standard Time": "Europe/Chisinau",
  "FLE Standard Time": "Europe/Kyiv",
  "Turkey Standard Time": "Europe/Istanbul",
  "Israel Standard Time": "Asia/Jerusalem",
  "Jordan Standard Time": "Asia/Amman",
  "Arabian Standard Time": "Asia/Dubai",
  "Arab Standard Time": "Asia/Riyadh",
  "India Standard Time": "Asia/Kolkata",
  "Nepal Standard Time": "Asia/Kathmandu",
  "Bangladesh Standard Time": "Asia/Dhaka",
  "SE Asia Standard Time": "Asia/Bangkok",
  "Singapore Standard Time": "Asia/Singapore",
  "China Standard Time": "Asia/Shanghai",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Korea Standard Time": "Asia/Seoul",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "E. Australia Standard Time": "Australia/Brisbane",
  "Cen. Australia Standard Time": "Australia/Adelaide",
  "Tasmania Standard Time": "Australia/Hobart",
  "New Zealand Standard Time": "Pacific/Auckland",
  "South Africa Standard Time": "Africa/Johannesburg",
  "Egypt Standard Time": "Africa/Cairo",
};

export type PersonalIssuePreview = {
  provider: "jira" | "linear" | "github";
  url: string;
  identifier: string;
  title: string;
  status: string | null;
  assignee: string | null;
  repository?: string;
  kind?: "issue" | "pull_request";
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

function calendarOutlookContinuation(
  value: unknown,
  path: string,
  parameters: URLSearchParams,
): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "graph.microsoft.com" ||
      url.port !== "" ||
      url.username ||
      url.password ||
      url.pathname !== path ||
      url.hash
    )
      return null;
    const fixedKeys = new Set(parameters.keys());
    for (const key of fixedKeys) {
      if (
        url.searchParams.getAll(key).length !== 1 ||
        url.searchParams.get(key) !== parameters.get(key)
      )
        return null;
    }
    for (const key of url.searchParams.keys()) {
      if (!fixedKeys.has(key) && key !== "$skip" && key !== "$skiptoken")
        return null;
    }
    const skipToken = url.searchParams.getAll("$skiptoken");
    const skip = url.searchParams.getAll("$skip");
    if (skipToken.length === 1 && skip.length === 0 && skipToken[0]) {
      if (skipToken[0].length > 1024) return null;
    } else if (
      skip.length === 1 &&
      skipToken.length === 0 &&
      /^(?:0|[1-9][0-9]{0,6})$/.test(skip[0] ?? "")
    ) {
      // Graph can use an integer offset in place of an opaque skip token.
    } else {
      return null;
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
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

type PersonalConference = NonNullable<PersonalEvent["conference"]>;
type VideoCallMarker = "requested" | "unsupported";

function safeConferenceUrl(
  value: unknown,
  provider: "google_meet" | "teams",
): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const allowedHost =
      provider === "google_meet"
        ? url.hostname === "meet.google.com"
        : [
            "teams.microsoft.com",
            "teams.live.com",
            "teams.cloud.microsoft",
            "gov.teams.microsoft.us",
            "dod.teams.microsoft.us",
            "teams.microsoftonline.cn",
          ].includes(url.hostname);
    return url.protocol === "https:" &&
      allowedHost &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function safeJitsiUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "meet.jit.si" &&
      url.port === "" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/savia-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        url.pathname,
      )
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function conferenceMetadata(
  event: Record<string, unknown>,
  provider: "google_calendar" | "outlook",
): PersonalConference | null {
  let conferenceProvider: unknown;
  let rawUrl: unknown;
  if (provider === "google_calendar") {
    const extendedProperties = event.extendedProperties;
    const privateProperties =
      extendedProperties &&
      typeof extendedProperties === "object" &&
      !Array.isArray(extendedProperties)
        ? (extendedProperties as Record<string, unknown>).private
        : undefined;
    if (
      !privateProperties ||
      typeof privateProperties !== "object" ||
      Array.isArray(privateProperties)
    )
      return null;
    conferenceProvider = (privateProperties as Record<string, unknown>)[
      googleConferenceProviderProperty
    ];
    rawUrl = (privateProperties as Record<string, unknown>)[
      googleConferenceUrlProperty
    ];
  } else {
    const properties = event.singleValueExtendedProperties;
    if (!Array.isArray(properties)) return null;
    for (const property of properties) {
      if (!property || typeof property !== "object" || Array.isArray(property))
        continue;
      const item = property as Record<string, unknown>;
      if (item.id === outlookConferenceProviderPropertyId)
        conferenceProvider = item.value;
      if (item.id === outlookConferenceUrlPropertyId) rawUrl = item.value;
    }
  }
  if (conferenceProvider !== "jitsi") return null;
  const joinUrl = safeJitsiUrl(rawUrl);
  return { provider: "jitsi", joinUrl, status: joinUrl ? "ready" : "failed" };
}

const unsupportedConference: PersonalConference = {
  provider: null,
  joinUrl: null,
  status: "unsupported",
};

function googleConference(
  value: unknown,
  marker: VideoCallMarker | null = null,
): PersonalConference | undefined {
  const requested = marker === "requested";
  if (!value || typeof value !== "object" || Array.isArray(value))
    return marker === "unsupported"
      ? { ...unsupportedConference }
      : requested
        ? { provider: "google_meet", joinUrl: null, status: "pending" }
        : undefined;
  const event = value as Record<string, unknown>;
  const conferenceData = event.conferenceData;
  if (
    !conferenceData ||
    typeof conferenceData !== "object" ||
    Array.isArray(conferenceData)
  ) {
    if (typeof event.hangoutLink === "string") {
      const joinUrl = safeConferenceUrl(event.hangoutLink, "google_meet");
      if (joinUrl) return { provider: "google_meet", joinUrl, status: "ready" };
      if (requested)
        return { provider: "google_meet", joinUrl: null, status: "pending" };
    }
    return marker === "unsupported"
      ? { ...unsupportedConference }
      : requested
        ? { provider: "google_meet", joinUrl: null, status: "pending" }
        : undefined;
  }
  const data = conferenceData as Record<string, unknown>;
  const createRequest = data.createRequest;
  const createStatus =
    createRequest &&
    typeof createRequest === "object" &&
    !Array.isArray(createRequest)
      ? (createRequest as Record<string, unknown>).status
      : undefined;
  const statusCode =
    createStatus &&
    typeof createStatus === "object" &&
    !Array.isArray(createStatus)
      ? (createStatus as Record<string, unknown>).statusCode
      : undefined;
  const solution = data.conferenceSolution;
  const key =
    solution && typeof solution === "object" && !Array.isArray(solution)
      ? (solution as Record<string, unknown>).key
      : undefined;
  const solutionType =
    key && typeof key === "object" && !Array.isArray(key)
      ? (key as Record<string, unknown>).type
      : undefined;
  const createKey =
    createRequest &&
    typeof createRequest === "object" &&
    !Array.isArray(createRequest)
      ? (createRequest as Record<string, unknown>).conferenceSolutionKey
      : undefined;
  const createType =
    createKey && typeof createKey === "object" && !Array.isArray(createKey)
      ? (createKey as Record<string, unknown>).type
      : undefined;
  const isMeet =
    solutionType === "hangoutsMeet" || createType === "hangoutsMeet";
  if (!isMeet) {
    const hasOtherSolution =
      (typeof solutionType === "string" && solutionType.length > 0) ||
      (typeof createType === "string" && createType.length > 0);
    if (
      requested &&
      !hasOtherSolution &&
      (statusCode === "failure" || statusCode === "FAILURE")
    )
      return { provider: "google_meet", joinUrl: null, status: "failed" };
    return marker === "unsupported"
      ? { ...unsupportedConference }
      : requested
        ? { provider: "google_meet", joinUrl: null, status: "pending" }
        : undefined;
  }
  if (statusCode === "failure" || statusCode === "FAILURE")
    return { provider: "google_meet", joinUrl: null, status: "failed" };
  const entries = Array.isArray(data.entryPoints) ? data.entryPoints : [];
  const video = entries.find(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      (entry as Record<string, unknown>).entryPointType === "video",
  );
  const url =
    video && typeof video === "object" && !Array.isArray(video)
      ? (video as Record<string, unknown>).uri
      : undefined;
  const joinUrl = safeConferenceUrl(url ?? event.hangoutLink, "google_meet");
  return joinUrl
    ? { provider: "google_meet", joinUrl, status: "ready" }
    : { provider: "google_meet", joinUrl: null, status: "pending" };
}

function outlookConference(
  value: unknown,
  marker: VideoCallMarker | null = null,
): PersonalConference | undefined {
  const requested = marker === "requested";
  if (!value || typeof value !== "object" || Array.isArray(value))
    return marker === "unsupported"
      ? { ...unsupportedConference }
      : requested
        ? { provider: "teams", joinUrl: null, status: "pending" }
        : undefined;
  const event = value as Record<string, unknown>;
  const provider = event.onlineMeetingProvider;
  if (provider !== "teamsForBusiness")
    return marker === "unsupported"
      ? { ...unsupportedConference }
      : requested
        ? event.isOnlineMeeting === false
          ? { provider: "teams", joinUrl: null, status: "failed" }
          : { provider: "teams", joinUrl: null, status: "pending" }
        : undefined;
  if (event.isOnlineMeeting === false)
    return { provider: "teams", joinUrl: null, status: "failed" };
  const meeting = event.onlineMeeting;
  const rawUrl =
    meeting && typeof meeting === "object" && !Array.isArray(meeting)
      ? (meeting as Record<string, unknown>).joinUrl
      : undefined;
  const joinUrl = safeConferenceUrl(rawUrl, "teams");
  return joinUrl
    ? { provider: "teams", joinUrl, status: "ready" }
    : { provider: "teams", joinUrl: null, status: "pending" };
}

function googleVideoCallMarker(
  event: Record<string, unknown>,
): VideoCallMarker | null {
  const extendedProperties = event.extendedProperties;
  if (
    !extendedProperties ||
    typeof extendedProperties !== "object" ||
    Array.isArray(extendedProperties)
  )
    return null;
  const privateProperties = (extendedProperties as Record<string, unknown>)
    .private;
  if (
    !privateProperties ||
    typeof privateProperties !== "object" ||
    Array.isArray(privateProperties)
  )
    return null;
  const value = (privateProperties as Record<string, unknown>)[
    googleVideoCallProperty
  ];
  return value === "requested" || value === "unsupported" ? value : null;
}

function outlookVideoCallMarker(
  event: Record<string, unknown>,
): VideoCallMarker | null {
  if (!Array.isArray(event.singleValueExtendedProperties)) return null;
  const marker = event.singleValueExtendedProperties.find((property) => {
    if (!property || typeof property !== "object" || Array.isArray(property))
      return false;
    return (
      (property as Record<string, unknown>).id === outlookVideoCallPropertyId
    );
  });
  if (!marker || typeof marker !== "object" || Array.isArray(marker))
    return null;
  const value = (marker as Record<string, unknown>).value;
  return value === "requested" || value === "unsupported" ? value : null;
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

function calendarAttendees(input: Record<string, unknown>): string[] {
  const value = input.attendees;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50)
    return invalidAction("The attendees field is invalid");
  const attendees = value.map((entry) => {
    if (typeof entry !== "string")
      return invalidAction("The attendees field is invalid");
    const email = entry.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return invalidAction("The attendees field is invalid");
    return email;
  });
  return [...new Set(attendees)];
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

const recordingFileLimit = 50_000_000;
const recordingExtensions = new Set([
  ".aac",
  ".flac",
  ".m4a",
  ".mp3",
  ".oga",
  ".ogg",
  ".opus",
  ".wav",
  ".webm",
]);
const recordingMimeTypes = new Set([
  "audio/aac",
  "audio/flac",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/opus",
  "audio/wav",
  "audio/webm",
  "audio/x-flac",
  "audio/x-m4a",
  "audio/x-wav",
]);

function recordingFileId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 512 ||
    value === "." ||
    value === ".." ||
    /[\\/\\?#\u0000-\u001f\u007f]/.test(value)
  )
    return invalidAction("The recording file ID is invalid");
  return value;
}

function recordingMetadata(
  payload: unknown,
  expectedId: string,
  provider: "google_drive" | "onedrive_personal" | "onedrive_business",
): { name: string; mimeType: string; size?: number } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new PersonalIntegrationUpstreamError();
  const item = payload as Record<string, unknown>;
  if (item.id !== expectedId) throw new PersonalIntegrationUpstreamError();
  const name = documentName(item.name);
  let mimeType: unknown;
  if (provider === "google_drive") {
    if (item.mimeType === "application/vnd.google-apps.folder")
      return invalidAction("Folders cannot be imported as recordings");
    mimeType = item.mimeType;
  } else {
    if (item.folder && typeof item.folder === "object")
      return invalidAction("Folders cannot be imported as recordings");
    const file = item.file;
    if (!file || typeof file !== "object" || Array.isArray(file))
      return invalidAction("The selected file is not a supported recording");
    mimeType = (file as Record<string, unknown>).mimeType;
  }
  const normalizedMimeType =
    typeof mimeType === "string"
      ? mimeType.split(";", 1)[0]?.trim().toLowerCase()
      : "";
  const extension = name.includes(".")
    ? name.slice(name.lastIndexOf(".")).toLowerCase()
    : "";
  if (
    !recordingExtensions.has(extension) ||
    (normalizedMimeType !== "application/octet-stream" &&
      !recordingMimeTypes.has(normalizedMimeType))
  )
    return invalidAction("The selected file is not a supported recording");
  let size: number | undefined;
  if (item.size !== undefined && item.size !== null) {
    const rawSize = item.size;
    const parsedSize =
      typeof rawSize === "number"
        ? rawSize
        : typeof rawSize === "string" && /^\d{1,16}$/.test(rawSize)
          ? Number(rawSize)
          : Number.NaN;
    if (!Number.isSafeInteger(parsedSize) || parsedSize < 0)
      throw new PersonalIntegrationUpstreamError();
    if (parsedSize > recordingFileLimit)
      return invalidAction("The selected recording exceeds 50 MB");
    size = parsedSize;
  }
  return {
    name,
    mimeType:
      normalizedMimeType === "application/octet-stream"
        ? "application/octet-stream"
        : normalizedMimeType,
    ...(size === undefined ? {} : { size }),
  };
}

function microsoftDownloadUrl(value: string, baseUrl: string): string {
  if (value.length > 8192) throw new PersonalIntegrationUpstreamError();
  try {
    const url = new URL(value, baseUrl);
    const host = url.hostname.toLowerCase();
    const allowedHost =
      host === "sharepoint.com" ||
      host.endsWith(".sharepoint.com") ||
      host === "sharepoint-df.com" ||
      host.endsWith(".sharepoint-df.com") ||
      host === "1drv.com" ||
      host.endsWith(".1drv.com") ||
      host === "onedrive.live.com";
    if (
      url.protocol !== "https:" ||
      !allowedHost ||
      url.port ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error("Unsafe redirect");
    return url.toString();
  } catch {
    throw new PersonalIntegrationUpstreamError();
  }
}

async function boundedRecordingBytes(
  response: Response,
  advertisedSize?: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d{1,16}$/.test(contentLength))
      throw new PersonalIntegrationUpstreamError();
    const length = Number(contentLength);
    if (!Number.isSafeInteger(length))
      throw new PersonalIntegrationUpstreamError();
    if (length > recordingFileLimit)
      return invalidAction("The selected recording exceeds 50 MB");
  }
  const bodyMimeType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    bodyMimeType &&
    bodyMimeType !== "application/octet-stream" &&
    !recordingMimeTypes.has(bodyMimeType)
  )
    return invalidAction("The selected file is not a supported recording");
  if (!response.body) throw new PersonalIntegrationUpstreamError();
  const reader = response.body.getReader();
  let bytes = new Uint8Array(0);
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > recordingFileLimit) {
        await reader.cancel().catch(() => undefined);
        return invalidAction("The selected recording exceeds 50 MB");
      }
      if (total > bytes.byteLength) {
        const capacity = Math.min(
          recordingFileLimit,
          Math.max(
            total,
            bytes.byteLength === 0 ? 65_536 : bytes.byteLength * 2,
          ),
        );
        const expanded = new Uint8Array(capacity);
        expanded.set(bytes);
        bytes = expanded;
      }
      bytes.set(value, total - value.byteLength);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof PersonalIntegrationInputError) throw error;
    throw new PersonalIntegrationUpstreamError();
  } finally {
    reader.releaseLock();
  }
  if (total === 0) return invalidAction("The selected recording is empty");
  if (advertisedSize !== undefined && total !== advertisedSize)
    throw new PersonalIntegrationUpstreamError();
  return bytes.subarray(0, total);
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

function outlookOriginalTimeZone(value: unknown): string {
  if (typeof value !== "string")
    throw new PersonalIntegrationUpstreamError(
      "The Outlook event timezone is missing",
    );
  const timeZone = Object.prototype.hasOwnProperty.call(
    outlookWindowsTimeZones,
    value,
  )
    ? outlookWindowsTimeZones[value]
    : undefined;
  if (timeZone) return timeZone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value;
  } catch {
    throw new PersonalIntegrationUpstreamError(
      "The Outlook event timezone is unsupported",
    );
  }
}

function outlookAllDayDate(value: unknown, timeZone: string): string {
  const instant = graphResponseDateTime(value);
  const timestamp = instant ? Date.parse(instant) : Number.NaN;
  if (!Number.isFinite(timestamp)) throw new PersonalIntegrationUpstreamError();
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(timestamp);
  const part = (type: "year" | "month" | "day") =>
    parts.find((entry) => entry.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) throw new PersonalIntegrationUpstreamError();
  return `${year.padStart(4, "0")}-${month}-${day}`;
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

function eventsFromGoogle(
  payload: unknown,
  includeCalendarMetadata = false,
  requestedMeet: VideoCallMarker | null = null,
): PersonalEvent[] {
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
      { dateTime?: unknown; date?: unknown; timeZone?: unknown } | undefined;
    const end = item.end as
      { dateTime?: unknown; date?: unknown; timeZone?: unknown } | undefined;
    if (item.status === "cancelled") return [];
    const conference =
      conferenceMetadata(item, "google_calendar") ??
      googleConference(item, googleVideoCallMarker(item) ?? requestedMeet);
    return [
      {
        id,
        title: stringValue(item.summary),
        startsAt: stringValue(start?.dateTime) ?? stringValue(start?.date),
        endsAt: stringValue(end?.dateTime) ?? stringValue(end?.date),
        webLink: secureWebLink(item.htmlLink),
        ...(includeCalendarMetadata
          ? {
              allDay: typeof start?.date === "string",
              timeZone:
                stringValue(start?.timeZone) ?? stringValue(end?.timeZone),
            }
          : {}),
        ...(conference ? { conference } : {}),
      },
    ];
  });
}

function eventsFromOutlook(
  payload: unknown,
  includeCalendarMetadata = false,
  requestedTeams: VideoCallMarker | null = null,
): PersonalEvent[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return [];
  const events = (payload as { value?: unknown }).value;
  if (!Array.isArray(events)) return [];
  return events.flatMap((event) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) return [];
    const item = event as Record<string, unknown>;
    const id = stringValue(item.id);
    if (!id || item.isCancelled === true || item.showAs === "cancelled")
      return [];
    const start = item.start;
    const end = item.end;
    const startTimeZone =
      start && typeof start === "object" && !Array.isArray(start)
        ? stringValue((start as Record<string, unknown>).timeZone)
        : null;
    const allDay = item.isAllDay === true;
    let startsAt = graphResponseDateTime(start);
    let endsAt = graphResponseDateTime(end);
    let timeZone = startTimeZone;
    if (includeCalendarMetadata && allDay) {
      const originalStartTimeZone = outlookOriginalTimeZone(
        item.originalStartTimeZone,
      );
      const originalEndTimeZone = outlookOriginalTimeZone(
        item.originalEndTimeZone,
      );
      startsAt = outlookAllDayDate(start, originalStartTimeZone);
      endsAt = outlookAllDayDate(end, originalEndTimeZone);
      timeZone = originalStartTimeZone;
    }
    const conference =
      conferenceMetadata(item, "outlook") ??
      outlookConference(item, outlookVideoCallMarker(item) ?? requestedTeams);
    return [
      {
        id,
        title: stringValue(item.subject),
        startsAt,
        endsAt,
        webLink: secureWebLink(item.webLink),
        ...(includeCalendarMetadata ? { allDay, timeZone } : {}),
        ...(conference ? { conference } : {}),
      },
    ];
  });
}

export class PersonalIntegrationOperations {
  private readonly zoomMeetings?: ReturnType<typeof createZoomMeetingService>;

  constructor(
    private readonly repository: PersonalIntegrationRepository,
    private readonly nango: PersonalIntegrationNangoClient,
    database?: D1Database,
  ) {
    if (database) this.zoomMeetings = createZoomMeetingService(database, nango);
  }

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
    if (issueLink.provider === "github")
      return this.previewGitHubIssue(connection, issueLink);
    return this.previewLinearIssue(connection, issueLink);
  }

  async summarizeTickets(input: {
    principalId: string;
    config: TicketSummaryConfig;
    githubEnabled?: boolean;
  }): Promise<import("@savia/studio-shared/ticket-summary").TicketSummary> {
    const jira = await this.connectedConnection(input.principalId, "jira");
    const github =
      input.githubEnabled === false
        ? null
        : await this.repository.findActiveConnection(
            input.principalId,
            "github",
          );
    const activeGithub =
      github?.principalId === input.principalId &&
      github.provider === "github" &&
      github.status === "connected"
        ? github
        : null;
    return fetchTicketSummary(this.nango, jira, activeGithub, input.config);
  }

  private async previewGitHubIssue(
    connection: ActivePersonalIntegrationConnection,
    issueLink: NonNullable<ReturnType<typeof parseIssueLink>> & {
      provider: "github";
    },
  ): Promise<PersonalIssuePreview> {
    const pathKind = issueLink.kind === "pull_request" ? "pulls" : "issues";
    const response = await this.nango.proxy({
      method: "GET",
      path: `/repos/${encodeURIComponent(issueLink.owner)}/${encodeURIComponent(issueLink.repository)}/${pathKind}/${encodeURIComponent(issueLink.number)}`,
      connection,
      upstreamHeaders: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    });
    if (response.status === 401 || response.status === 403)
      throw new PersonalIntegrationAccessError();
    if (!response.ok) throw new PersonalIntegrationUpstreamError();
    const payload = await response.json().catch(() => undefined);
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw new PersonalIntegrationUpstreamError();
    const values = payload as Record<string, unknown>;
    const resolvedLink =
      typeof values.html_url === "string"
        ? parseIssueLink(values.html_url)
        : null;
    if (
      typeof values.number !== "number" ||
      values.number !== Number(issueLink.number) ||
      resolvedLink?.provider !== "github" ||
      resolvedLink.kind !== issueLink.kind ||
      resolvedLink.number !== issueLink.number ||
      resolvedLink.owner.toLowerCase() !== issueLink.owner.toLowerCase() ||
      resolvedLink.repository.toLowerCase() !==
        issueLink.repository.toLowerCase()
    )
      throw new PersonalIntegrationUpstreamError();

    const state = stringValue(values.state)?.toLowerCase();
    if (state !== "open" && state !== "closed")
      throw new PersonalIntegrationUpstreamError();
    const status =
      issueLink.kind === "pull_request" &&
      typeof values.merged_at === "string" &&
      values.merged_at.length > 0
        ? "merged"
        : state;
    const assignee = values.assignee;
    const repositoryValue =
      issueLink.kind === "pull_request" ? values.base : values.repository;
    const repository = nestedIssueText(
      repositoryValue && typeof repositoryValue === "object"
        ? ((repositoryValue as Record<string, unknown>).repo ?? repositoryValue)
        : repositoryValue,
      "full_name",
      255,
    );
    if (
      repository &&
      repository.toLowerCase() !==
        `${issueLink.owner}/${issueLink.repository}`.toLowerCase()
    )
      throw new PersonalIntegrationUpstreamError();
    return {
      provider: "github",
      url: issueLink.url,
      identifier: issueLink.identifier,
      title: requiredIssueText(values.title, 2000),
      status,
      assignee: nestedIssueText(assignee, "login", 255),
      repository: `${issueLink.owner}/${issueLink.repository}`,
      kind: issueLink.kind,
    };
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

  async downloadRecordingFile(input: {
    principalId: string;
    provider: "google_drive" | "onedrive_personal" | "onedrive_business";
    fileId: string;
  }): Promise<{
    name: string;
    bytes: Uint8Array<ArrayBuffer>;
    mimeType: string;
  }> {
    const fileId = recordingFileId(input.fileId);
    const connection = await this.connectedConnection(
      input.principalId,
      input.provider,
    );
    const encodedId = encodeURIComponent(fileId);
    const metadataPath =
      input.provider === "google_drive"
        ? `/drive/v3/files/${encodedId}?${new URLSearchParams({
            fields: "id,name,mimeType,size",
          })}`
        : `/v1.0/me/drive/items/${encodedId}?${new URLSearchParams({
            $select: "id,name,size,file,folder",
          })}`;
    const metadataResponse = await this.nango.proxy({
      method: "GET",
      redirect: "manual",
      path: metadataPath,
      connection,
    });
    if (!metadataResponse.ok) throw new PersonalIntegrationUpstreamError();
    const payload = await metadataResponse.json().catch(() => undefined);
    const metadata = recordingMetadata(payload, fileId, input.provider);
    const contentPath =
      input.provider === "google_drive"
        ? `/drive/v3/files/${encodedId}?alt=media`
        : `/v1.0/me/drive/items/${encodedId}/content`;
    let response = await this.nango.proxy({
      method: "GET",
      redirect: "manual",
      path: contentPath,
      connection,
    });
    if (
      input.provider !== "google_drive" &&
      response.status >= 300 &&
      response.status < 400
    ) {
      const location = response.headers.get("location");
      if (!location) throw new PersonalIntegrationUpstreamError();
      const safeUrl = microsoftDownloadUrl(
        location,
        "https://graph.microsoft.com",
      );
      try {
        // Graph content redirects to a short-lived download URL. This request
        // carries no Nango or provider credentials and never follows a second redirect.
        response = await fetch(safeUrl, {
          method: "GET",
          redirect: "manual",
          credentials: "omit",
        });
      } catch {
        throw new PersonalIntegrationUpstreamError();
      }
    }
    if (!response.ok) throw new PersonalIntegrationUpstreamError();
    const bytes = await boundedRecordingBytes(response, metadata.size);
    const mimeType =
      metadata.mimeType === "application/octet-stream"
        ? ({
            ".aac": "audio/aac",
            ".flac": "audio/flac",
            ".m4a": "audio/mp4",
            ".mp3": "audio/mpeg",
            ".oga": "audio/ogg",
            ".ogg": "audio/ogg",
            ".opus": "audio/opus",
            ".wav": "audio/wav",
            ".webm": "audio/webm",
          }[
            metadata.name.slice(metadata.name.lastIndexOf(".")).toLowerCase()
          ] ?? metadata.mimeType)
        : metadata.mimeType;
    return { name: metadata.name, bytes, mimeType };
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
        return message ? [{ message, linkPayload: item }] : [];
      });
    const messages: Array<{
      message: PersonalMessage;
      linkPayload: unknown;
    }> = [];
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
                path: `/gmail/v1/users/me/messages/${encodeURIComponent(row.message.id)}?${query}`,
                connection,
              });
              if (!detail.ok) return row;
              const detailPayload = await detail.json();
              const message = normalizeGmailMessage(detailPayload);
              if (message?.id !== row.message.id) return row;
              const detailItem =
                detailPayload &&
                typeof detailPayload === "object" &&
                !Array.isArray(detailPayload)
                  ? (detailPayload as Record<string, unknown>)
                  : {};
              const detailHasThreadId =
                typeof detailItem.threadId === "string" &&
                /^[a-f0-9]+$/i.test(detailItem.threadId);
              return {
                message: {
                  ...row.message,
                  subject: message.subject ?? row.message.subject,
                  sender: message.sender ?? row.message.sender,
                  receivedAt: message.receivedAt ?? row.message.receivedAt,
                },
                linkPayload: detailHasThreadId
                  ? detailPayload
                  : row.linkPayload,
              };
            } catch {
              return row;
            }
          }),
        )),
      );
    }
    let profileAddress: string | null = null;
    try {
      const profile = await this.nango.proxy({
        method: "GET",
        path: "/gmail/v1/users/me/profile",
        connection,
      });
      if (profile.ok) {
        const profilePayload = await profile.json().catch(() => undefined);
        profileAddress = credibleGmailAccountAddress(
          profilePayload &&
            typeof profilePayload === "object" &&
            !Array.isArray(profilePayload)
            ? (profilePayload as Record<string, unknown>).emailAddress
            : undefined,
        );
      }
    } catch {
      // Profile metadata is only used to scope links; message rows remain useful without it.
    }
    const nextPageToken = payload?.nextPageToken;
    if (
      typeof nextPageToken === "string" &&
      nextPageToken.length > 0 &&
      nextPageToken.length <= 1024
    )
      next = { provider: "gmail", kind: "page-token", token: nextPageToken };
    return {
      messages: messages.map(({ message, linkPayload }) => ({
        ...message,
        webLink: gmailMessageLink(linkPayload, profileAddress),
      })),
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
    if (
      input.from &&
      input.to &&
      input.to.getTime() - input.from.getTime() > calendarRangeMaxMilliseconds
    )
      return invalidAction("The calendar range cannot exceed 62 days");
    const connection = await this.repository.findActiveConnection(
      input.principalId,
      input.provider,
    );
    if (!connection || connection.status !== "connected")
      throw new PersonalIntegrationUnavailableError(
        "The personal integration connection is not ready",
      );
    const googlePath = "/calendar/v3/calendars/primary/events";
    const outlookPath =
      input.from && input.to ? "/v1.0/me/calendarView" : "/v1.0/me/events";
    const googleParameters = new URLSearchParams({
      maxResults: String(calendarPageSize),
      singleEvents: "true",
      orderBy: "startTime",
      timeMin: (input.from ?? new Date()).toISOString(),
      conferenceDataVersion: "1",
      ...(input.to ? { timeMax: input.to.toISOString() } : {}),
    });
    const outlookParameters =
      input.from && input.to
        ? new URLSearchParams({
            startDateTime: input.from.toISOString(),
            endDateTime: input.to.toISOString(),
            $top: String(calendarPageSize),
            $orderby: "start/dateTime",
            $expand: outlookVideoCallExpand,
            $select:
              "id,subject,start,end,webLink,isAllDay,isCancelled,showAs,originalStartTimeZone,originalEndTimeZone,isOnlineMeeting,onlineMeetingProvider,onlineMeeting,singleValueExtendedProperties",
          })
        : new URLSearchParams({
            $top: String(calendarPageSize),
            $expand: outlookVideoCallExpand,
            $select:
              "id,subject,start,end,webLink,isAllDay,isCancelled,showAs,originalStartTimeZone,originalEndTimeZone,isOnlineMeeting,onlineMeeting,singleValueExtendedProperties",
          });
    const events: PersonalEvent[] = [];
    const seenGoogleTokens = new Set<string>();
    const seenOutlookContinuations = new Set<string>();
    let rowsRead = 0;
    let googleToken: string | null = null;
    let outlookNextPath: string | null = null;

    for (let page = 0; page < calendarPageLimit; page += 1) {
      let path: string;
      if (input.provider === "google_calendar") {
        const parameters = new URLSearchParams(googleParameters);
        if (googleToken) parameters.set("pageToken", googleToken);
        path = `${googlePath}?${parameters.toString()}`;
      } else {
        path =
          outlookNextPath ?? `${outlookPath}?${outlookParameters.toString()}`;
      }
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
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        throw new PersonalIntegrationUpstreamError();
      const record = payload as Record<string, unknown>;
      const rows =
        input.provider === "google_calendar" ? record.items : record.value;
      if (!Array.isArray(rows)) throw new PersonalIntegrationUpstreamError();
      rowsRead += rows.length;
      if (rowsRead > calendarEventLimit)
        throw new PersonalIntegrationUpstreamError(
          "The calendar contains more events than can be returned at once",
        );
      const pageEvents =
        input.provider === "google_calendar"
          ? eventsFromGoogle(payload, true)
          : eventsFromOutlook(payload, true);
      events.push(...pageEvents);
      if (events.length > calendarEventLimit)
        throw new PersonalIntegrationUpstreamError(
          "The calendar contains more events than can be returned at once",
        );

      if (input.provider === "google_calendar") {
        const nextToken = record.nextPageToken;
        if (nextToken === undefined || nextToken === null || nextToken === "")
          return this.attachZoomConferences(
            input.principalId,
            input.provider,
            connection,
            events,
          );
        if (
          typeof nextToken !== "string" ||
          nextToken.length > 1024 ||
          seenGoogleTokens.has(nextToken)
        )
          throw new PersonalIntegrationUpstreamError();
        seenGoogleTokens.add(nextToken);
        googleToken = nextToken;
      } else {
        const nextLink = record["@odata.nextLink"];
        if (nextLink === undefined || nextLink === null || nextLink === "")
          return this.attachZoomConferences(
            input.principalId,
            input.provider,
            connection,
            events,
          );
        const continuation = calendarOutlookContinuation(
          nextLink,
          outlookPath,
          outlookParameters,
        );
        if (!continuation || seenOutlookContinuations.has(continuation))
          throw new PersonalIntegrationUpstreamError();
        seenOutlookContinuations.add(continuation);
        outlookNextPath = continuation;
      }
    }

    throw new PersonalIntegrationUpstreamError(
      "The calendar contains more pages than can be read at once",
    );
  }

  private async attachZoomConferences(
    principalId: string,
    provider: "google_calendar" | "outlook",
    connection: ActivePersonalIntegrationConnection,
    events: PersonalEvent[],
  ): Promise<PersonalEvent[]> {
    if (!this.zoomMeetings) return events;
    const joinUrls = await this.zoomMeetings.calendarMeetings({
      principalId,
      provider,
      calendarConnectionId: connection.id,
      calendarNangoConnectionId: connection.nangoConnectionId,
      calendarNangoIntegrationId: connection.nangoIntegrationId,
      eventIds: events.map((event) => event.id),
    });
    return events.map((event) => {
      const joinUrl = joinUrls.get(event.id);
      return joinUrl
        ? {
            ...event,
            conference: { provider: "zoom", joinUrl, status: "ready" },
          }
        : event;
    });
  }

  async deleteCalendarEvent(input: {
    principalId: string;
    provider: "google_calendar" | "outlook";
    eventId: string;
    expectedConnectionId?: string;
  }): Promise<void> {
    if (
      !input.eventId ||
      input.eventId.length > 255 ||
      input.eventId.trim() !== input.eventId ||
      /[\u0000-\u001f\u007f]/.test(input.eventId)
    )
      return invalidAction("The calendar event id is invalid");
    const connection = await this.connectedConnection(
      input.principalId,
      input.provider,
    );
    if (
      input.expectedConnectionId &&
      connection.id !== input.expectedConnectionId
    )
      throw new PersonalIntegrationUnavailableError(
        "The personal integration connection changed; refresh the calendar and try again",
      );
    const outlookParameters = new URLSearchParams({
      $select: "id,type,singleValueExtendedProperties",
      $expand: `singleValueExtendedProperties($filter=id eq '${outlookBookingPropertyId}')`,
    });
    const deletePath =
      input.provider === "google_calendar"
        ? `/calendar/v3/calendars/primary/events/${encodeURIComponent(input.eventId)}`
        : `/v1.0/me/events/${encodeURIComponent(input.eventId)}`;
    const detailsPath =
      input.provider === "google_calendar"
        ? deletePath
        : `${deletePath}?${outlookParameters}`;
    let detailsResponse: Response;
    try {
      detailsResponse = await this.nango.proxy({
        method: "GET",
        path: detailsPath,
        connection,
        ...(input.provider === "outlook"
          ? { upstreamHeaders: outlookUtcPreference }
          : {}),
      });
    } catch {
      throw new PersonalIntegrationUpstreamError();
    }
    if (!detailsResponse.ok) throw new PersonalIntegrationUpstreamError();
    const details = await detailsResponse.json().catch(() => undefined);
    if (!details || typeof details !== "object" || Array.isArray(details))
      throw new PersonalIntegrationUpstreamError();
    const event = details as Record<string, unknown>;
    if (event.id !== input.eventId)
      throw new PersonalIntegrationUpstreamError();
    if (
      (input.provider === "google_calendar" &&
        Array.isArray(event.recurrence) &&
        event.recurrence.length > 0) ||
      (input.provider === "outlook" && event.type === "seriesMaster")
    )
      return invalidAction("Recurring calendar series cannot be deleted here");
    if (
      input.provider === "outlook" &&
      !["singleInstance", "occurrence", "exception"].includes(
        event.type as string,
      )
    )
      return invalidAction("This Outlook event type cannot be deleted here");
    if (
      input.provider === "outlook" &&
      Array.isArray(event.singleValueExtendedProperties) &&
      event.singleValueExtendedProperties.some((property) => {
        if (
          !property ||
          typeof property !== "object" ||
          Array.isArray(property)
        )
          return false;
        const item = property as Record<string, unknown>;
        return item.id === outlookBookingPropertyId;
      })
    )
      return invalidAction(
        "Savia booking events must be cancelled from bookings",
      );

    await this.zoomMeetings?.cancelCalendarEvent({
      principalId: input.principalId,
      provider: input.provider,
      calendarConnectionId: connection.id,
      calendarNangoConnectionId: connection.nangoConnectionId,
      calendarNangoIntegrationId: connection.nangoIntegrationId,
      eventId: input.eventId,
    });

    await this.write(connection, "delete-event", {
      method: "DELETE",
      path: deletePath,
      ...(input.provider === "outlook"
        ? { upstreamHeaders: outlookUtcPreference }
        : {}),
    });
  }

  async createCalendarEvent(input: {
    principalId: string;
    provider: "google_calendar" | "outlook";
    title: string;
    startsAt: string;
    endsAt: string;
    videoCall?: boolean;
    conferenceProvider?: "zoom" | "jitsi";
    requestId?: string;
    attendees?: string[];
  }): Promise<PersonalEvent> {
    const title = requiredActionText(input, "title", 2000);
    const startsAt = eventDate(input, "startsAt");
    const endsAt = eventDate(input, "endsAt");
    if (endsAt <= startsAt)
      return invalidAction("The event end must be after its start");
    if (input.videoCall && input.conferenceProvider === "zoom") {
      if (title.length > 200)
        return invalidAction(
          "Zoom meeting titles cannot exceed 200 characters",
        );
      if (endsAt.getTime() - startsAt.getTime() > 24 * 60 * 60 * 1000)
        return invalidAction("Zoom meetings cannot exceed 24 hours");
    }
    if (
      input.requestId !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        input.requestId,
      )
    )
      return invalidAction("The event request id is invalid");
    if (
      input.videoCall &&
      input.conferenceProvider === "zoom" &&
      input.requestId === undefined
    )
      return invalidAction("A requestId is required for Zoom video calls");
    if (input.conferenceProvider && !input.videoCall)
      return invalidAction("A conference provider requires videoCall");
    const attendees = calendarAttendees(input);
    const connection = await this.connectedConnection(
      input.principalId,
      input.provider,
    );
    const requestId = input.requestId ?? crypto.randomUUID();
    const jitsiUrl =
      input.conferenceProvider === "jitsi"
        ? `https://meet.jit.si/savia-${crypto.randomUUID()}`
        : null;
    const conferenceProvider =
      input.videoCall && input.conferenceProvider === "zoom"
        ? "zoom"
        : input.videoCall && input.conferenceProvider !== "jitsi"
          ? await this.conferenceCapability(connection, input.provider)
          : null;
    const zoomConnection =
      conferenceProvider === "zoom"
        ? await this.connectedConnection(input.principalId, "zoom")
        : undefined;
    if (conferenceProvider === "zoom" && !this.zoomMeetings)
      throw new PersonalIntegrationUnavailableError(
        "Zoom meeting creation is unavailable",
      );
    const zoomMeeting =
      conferenceProvider === "zoom"
        ? await this.zoomMeetings!.sync({
            principalId: input.principalId,
            connectionId: zoomConnection!.id,
            resourceKey: `my-day:${requestId}`,
            title,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            cancelled: false,
            immutableRequest: JSON.stringify({
              provider: input.provider,
              calendarConnectionId: connection.id,
              calendarNangoConnectionId: connection.nangoConnectionId,
              calendarNangoIntegrationId: connection.nangoIntegrationId,
              title,
              startsAt: startsAt.toISOString(),
              endsAt: endsAt.toISOString(),
              attendees: [...attendees].sort(),
            }),
          })
        : undefined;
    const requestConference =
      input.videoCall &&
      (conferenceProvider === "google_meet" || conferenceProvider === "teams");
    const videoCallMarker: VideoCallMarker | null = input.videoCall
      ? requestConference
        ? "requested"
        : conferenceProvider === "zoom" || jitsiUrl
          ? null
          : "unsupported"
      : null;
    const googleEventId =
      input.provider === "google_calendar" && input.requestId
        ? `savia${requestId.replaceAll("-", "").toLowerCase()}`
        : undefined;
    const eventRequest =
      input.provider === "google_calendar"
        ? {
            method: "POST" as const,
            path: `/calendar/v3/calendars/primary/events${
              requestConference || attendees.length
                ? `?${[
                    ...(requestConference ? ["conferenceDataVersion=1"] : []),
                    ...(attendees.length ? ["sendUpdates=all"] : []),
                  ].join("&")}`
                : ""
            }`,
            body: {
              ...(googleEventId ? { id: googleEventId } : {}),
              summary: title,
              start: { dateTime: startsAt.toISOString() },
              end: { dateTime: endsAt.toISOString() },
              ...(zoomMeeting
                ? {
                    location: zoomMeeting.joinUrl,
                    description: `Join Zoom meeting: ${zoomMeeting.joinUrl}`,
                  }
                : {}),
              ...(attendees.length
                ? { attendees: attendees.map((email) => ({ email })) }
                : {}),
              ...(jitsiUrl
                ? {
                    description: `Join the meeting: ${jitsiUrl}`,
                    location: jitsiUrl,
                  }
                : {}),
              ...(requestConference && conferenceProvider === "google_meet"
                ? {
                    conferenceData: {
                      createRequest: {
                        requestId,
                        conferenceSolutionKey: { type: "hangoutsMeet" },
                      },
                    },
                  }
                : {}),
              ...(jitsiUrl
                ? {
                    extendedProperties: {
                      private: {
                        [googleConferenceProviderProperty]: "jitsi",
                        [googleConferenceUrlProperty]: jitsiUrl,
                      },
                    },
                  }
                : videoCallMarker
                  ? {
                      extendedProperties: {
                        private: {
                          [googleVideoCallProperty]: videoCallMarker,
                        },
                      },
                    }
                  : {}),
            },
          }
        : {
            method: "POST" as const,
            path: "/v1.0/me/events",
            body: {
              ...(input.requestId ? { transactionId: input.requestId } : {}),
              subject: title,
              start: graphDateTime(startsAt),
              end: graphDateTime(endsAt),
              ...(zoomMeeting
                ? {
                    location: { displayName: zoomMeeting.joinUrl },
                    body: {
                      contentType: "text",
                      content: `Join Zoom meeting: ${zoomMeeting.joinUrl}`,
                    },
                  }
                : {}),
              ...(attendees.length
                ? {
                    attendees: attendees.map((address) => ({
                      emailAddress: { address },
                      type: "required",
                    })),
                  }
                : {}),
              ...(jitsiUrl
                ? {
                    body: {
                      contentType: "Text",
                      content: `Join the meeting: ${jitsiUrl}`,
                    },
                    location: { displayName: jitsiUrl },
                  }
                : {}),
              ...(requestConference && conferenceProvider === "teams"
                ? {
                    isOnlineMeeting: true,
                    onlineMeetingProvider: "teamsForBusiness",
                  }
                : {}),
              ...(jitsiUrl
                ? {
                    singleValueExtendedProperties: [
                      {
                        id: outlookConferenceProviderPropertyId,
                        value: "jitsi",
                      },
                      {
                        id: outlookConferenceUrlPropertyId,
                        value: jitsiUrl,
                      },
                    ],
                  }
                : videoCallMarker
                  ? {
                      singleValueExtendedProperties: [
                        {
                          id: outlookVideoCallPropertyId,
                          value: videoCallMarker,
                        },
                      ],
                    }
                  : {}),
            },
            upstreamHeaders: outlookUtcPreference,
          };
    let response: Response;
    const associatedOutlookEventId =
      zoomMeeting && input.provider === "outlook"
        ? await this.zoomMeetings!.associatedCalendarEvent({
            principalId: input.principalId,
            resourceKey: `my-day:${requestId}`,
            provider: input.provider,
            calendarConnectionId: connection.id,
            calendarNangoConnectionId: connection.nangoConnectionId,
            calendarNangoIntegrationId: connection.nangoIntegrationId,
          })
        : undefined;
    if (associatedOutlookEventId) {
      response = await this.nango.proxy({
        method: "GET",
        path: `/v1.0/me/events/${encodeURIComponent(associatedOutlookEventId)}`,
        connection,
        upstreamHeaders: outlookUtcPreference,
      });
      if (!response.ok) throw new PersonalIntegrationUpstreamError();
    } else {
      try {
        response = await this.write(connection, "create-event", eventRequest);
      } catch (error) {
        if (
          !googleEventId ||
          !(error instanceof PersonalIntegrationUpstreamError)
        )
          throw error;
        response = await this.nango.proxy({
          method: "GET",
          path: `/calendar/v3/calendars/primary/events/${encodeURIComponent(googleEventId)}`,
          connection,
        });
        if (!response.ok) throw error;
      }
    }
    const payload = await response.json().catch(() => undefined);
    const event =
      input.provider === "google_calendar"
        ? eventsFromGoogle({ items: [payload] }, false, videoCallMarker)[0]
        : eventsFromOutlook({ value: [payload] }, false, videoCallMarker)[0];
    if (!event) throw new PersonalIntegrationUpstreamError();
    if (
      (googleEventId && event.id !== googleEventId) ||
      (associatedOutlookEventId && event.id !== associatedOutlookEventId)
    )
      throw new PersonalIntegrationUpstreamError();
    if (zoomMeeting) {
      await this.zoomMeetings!.associateCalendarEvent({
        principalId: input.principalId,
        resourceKey: `my-day:${requestId}`,
        provider: input.provider,
        calendarConnectionId: connection.id,
        calendarNangoConnectionId: connection.nangoConnectionId,
        calendarNangoIntegrationId: connection.nangoIntegrationId,
        eventId: event.id,
      });
      event.conference = {
        provider: "zoom",
        joinUrl: zoomMeeting.joinUrl,
        status: "ready",
      };
    }
    if (jitsiUrl)
      event.conference = {
        provider: "jitsi",
        joinUrl: jitsiUrl,
        status: "ready",
      };
    return { ...event, connectionId: connection.id };
  }

  private async conferenceCapability(
    connection: ActivePersonalIntegrationConnection,
    provider: "google_calendar" | "outlook",
  ): Promise<"google_meet" | "teams" | null> {
    let response: Response;
    try {
      response = await this.nango.proxy({
        method: "GET",
        path:
          provider === "google_calendar"
            ? "/calendar/v3/calendars/primary"
            : "/v1.0/me/calendar?$select=allowedOnlineMeetingProviders",
        connection,
      });
    } catch {
      throw new PersonalIntegrationUpstreamError();
    }
    if (!response.ok) throw new PersonalIntegrationUpstreamError();
    const payload = await response.json().catch(() => undefined);
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw new PersonalIntegrationUpstreamError();
    const record = payload as Record<string, unknown>;
    if (provider === "google_calendar") {
      const properties = record.conferenceProperties;
      if (
        !properties ||
        typeof properties !== "object" ||
        Array.isArray(properties)
      )
        throw new PersonalIntegrationUpstreamError();
      const allowed = (properties as Record<string, unknown>)
        .allowedConferenceSolutionTypes;
      if (
        !Array.isArray(allowed) ||
        allowed.some((item) => typeof item !== "string")
      )
        throw new PersonalIntegrationUpstreamError();
      return allowed.includes("hangoutsMeet") ? "google_meet" : null;
    }
    const allowed = record.allowedOnlineMeetingProviders;
    if (
      !Array.isArray(allowed) ||
      allowed.some((item) => typeof item !== "string")
    )
      throw new PersonalIntegrationUpstreamError();
    return allowed.includes("teamsForBusiness") ? "teams" : null;
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
    eventType: "send-email" | "create-event" | "delete-event" | "upload-file",
    request: {
      method: "POST" | "PUT" | "DELETE";
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
