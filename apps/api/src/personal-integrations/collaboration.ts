import type {
  CollaborationChannel,
  CollaborationProvider,
  ShareRecordInput,
  ShareRecordResult,
} from "@savia/studio-shared/collaboration-contracts";
import type {
  ActivePersonalIntegrationConnection,
  PersonalIntegrationNangoClient,
  PersonalIntegrationRepository,
} from "./contracts";
import {
  PersonalIntegrationInputError,
  PersonalIntegrationUpstreamError,
} from "./contracts";

export class CollaborationConflictError extends Error {
  readonly code:
    | "PERSONAL_COLLABORATION_DELIVERY_UNKNOWN"
    | "PERSONAL_COLLABORATION_REQUEST_ID_REUSED";
  constructor(
    code:
      | "PERSONAL_COLLABORATION_DELIVERY_UNKNOWN"
      | "PERSONAL_COLLABORATION_REQUEST_ID_REUSED",
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "CollaborationConflictError";
  }
}

type Team = { id: string; displayName: string };
type TeamsCursor = {
  teamsPagePath: string;
  teamIndex: number;
  currentTeam: Team | null;
  teamsNext: string | null;
  channelsNext: string | null;
};

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function responsePayload(
  response: Response,
  markReconnectRequired?: () => Promise<unknown>,
): Promise<unknown> {
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      await markReconnectRequired?.();
    throw new PersonalIntegrationUpstreamError();
  }
  return response.json().catch(() => {
    throw new PersonalIntegrationUpstreamError();
  });
}

function teamsContinuation(
  value: unknown,
  expected: "teams" | string,
): string | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value, "https://graph.microsoft.com");
  } catch {
    throw new PersonalIntegrationUpstreamError();
  }
  if (
    url.hostname !== "graph.microsoft.com" ||
    url.protocol !== "https:" ||
    (expected === "teams"
      ? url.pathname !== "/v1.0/me/joinedTeams"
      : url.pathname !== `/v1.0/teams/${encodeURIComponent(expected)}/channels`)
  )
    throw new PersonalIntegrationUpstreamError();
  return `${url.pathname}${url.search}`;
}

function parseTeamsCursor(cursor: string | undefined): TeamsCursor | undefined {
  if (!cursor) return undefined;
  try {
    const value = object(JSON.parse(decodeURIComponent(cursor)));
    if (
      !value ||
      typeof value.teamsPagePath !== "string" ||
      !Number.isSafeInteger(value.teamIndex) ||
      (value.teamIndex as number) < 0 ||
      (value.currentTeam !== null && !object(value.currentTeam)) ||
      (value.teamsNext !== null && typeof value.teamsNext !== "string") ||
      (value.channelsNext !== null && typeof value.channelsNext !== "string")
    )
      throw new Error("Invalid cursor");
    const teamIndex = value.teamIndex as number;
    const teamsPagePath = teamsContinuation(value.teamsPagePath, "teams");
    if (!teamsPagePath) throw new Error("Invalid cursor");
    if (typeof value.teamsNext === "string")
      teamsContinuation(value.teamsNext, "teams");
    let currentTeam: Team | null = null;
    if (value.currentTeam !== null) {
      const raw = object(value.currentTeam);
      if (typeof raw?.id !== "string" || typeof raw.displayName !== "string")
        throw new Error("Invalid cursor");
      currentTeam = { id: raw.id, displayName: raw.displayName };
    }
    if (typeof value.channelsNext === "string") {
      if (!currentTeam) throw new Error("Invalid cursor");
      teamsContinuation(value.channelsNext, currentTeam.id);
    }
    return {
      teamsPagePath,
      teamIndex,
      currentTeam,
      teamsNext: value.teamsNext,
      channelsNext: value.channelsNext,
    };
  } catch {
    throw new PersonalIntegrationInputError("Invalid collaboration cursor");
  }
}

function teamsPath(cursor: string): string {
  if (!cursor.startsWith("/v1.0/"))
    throw new PersonalIntegrationInputError("Invalid collaboration cursor");
  return cursor;
}

async function graph(
  nango: PersonalIntegrationNangoClient,
  connection: ActivePersonalIntegrationConnection,
  path: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
): Promise<Response> {
  try {
    // Nango Proxy POST requests default to zero retries; never change that for a share.
    return await nango.proxy({
      method,
      path,
      connection,
      body,
      ...(method === "POST" ? { redirect: "manual" as const } : {}),
    });
  } catch {
    throw new PersonalIntegrationUpstreamError();
  }
}

export async function listCollaborationChannels(input: {
  provider: CollaborationProvider;
  connection: ActivePersonalIntegrationConnection;
  nango: PersonalIntegrationNangoClient;
  repository: PersonalIntegrationRepository;
  cursor?: string;
}): Promise<{ channels: CollaborationChannel[]; nextCursor: string | null }> {
  if (input.provider === "slack") {
    const path = new URLSearchParams({
      types: "public_channel,private_channel",
      exclude_archived: "true",
      limit: "200",
      ...(input.cursor ? { cursor: input.cursor } : {}),
    });
    const payload = object(
      await responsePayload(
        await graph(
          input.nango,
          input.connection,
          `/conversations.list?${path.toString()}`,
        ),
        () => input.repository.markReconnectRequired(input.connection.id),
      ),
    );
    if (!payload || payload.ok === false) {
      if (
        payload?.error === "invalid_auth" ||
        payload?.error === "token_revoked"
      )
        await input.repository.markReconnectRequired(input.connection.id);
      throw new PersonalIntegrationUpstreamError();
    }
    const channels = (
      Array.isArray(payload.channels) ? payload.channels : []
    ).flatMap((raw: unknown) => {
      const row = object(raw);
      return row?.is_member === true &&
        row.is_archived !== true &&
        typeof row.id === "string" &&
        typeof row.name === "string"
        ? [{ id: row.id, name: row.name }]
        : [];
    });
    const metadata = object(payload.response_metadata);
    const next =
      typeof metadata?.next_cursor === "string" ? metadata.next_cursor : "";
    return { channels, nextCursor: next || null };
  }

  let state = parseTeamsCursor(input.cursor) ?? {
    teamsPagePath: "/v1.0/me/joinedTeams",
    teamIndex: 0,
    currentTeam: null,
    teamsNext: null,
    channelsNext: null,
  };
  const channels: CollaborationChannel[] = [];
  let teams: Team[] = [];
  let loadedTeamsPath: string | null = null;
  for (let requestCount = 0; channels.length < 100 && requestCount < 10;) {
    if (loadedTeamsPath !== state.teamsPagePath) {
      const payload = object(
        await responsePayload(
          await graph(
            input.nango,
            input.connection,
            teamsPath(state.teamsPagePath),
          ),
          () => input.repository.markReconnectRequired(input.connection.id),
        ),
      );
      if (!payload) throw new PersonalIntegrationUpstreamError();
      teams = (Array.isArray(payload.value) ? payload.value : []).flatMap(
        (raw: unknown) => {
          const team = object(raw);
          return typeof team?.id === "string" &&
            typeof team.displayName === "string"
            ? [{ id: team.id, displayName: team.displayName }]
            : [];
        },
      );
      state.teamsNext = teamsContinuation(payload["@odata.nextLink"], "teams");
      loadedTeamsPath = state.teamsPagePath;
      if (state.currentTeam) {
        const authoritativeTeam = teams[state.teamIndex];
        if (!authoritativeTeam || authoritativeTeam.id !== state.currentTeam.id)
          throw new PersonalIntegrationInputError(
            "Invalid collaboration cursor",
          );
        state.currentTeam = authoritativeTeam;
      }
      requestCount++;
      continue;
    }

    if (!state.currentTeam && state.teamIndex >= teams.length) {
      if (state.teamsNext === null) break;
      state.teamsPagePath = state.teamsNext;
      state.teamIndex = 0;
      state.currentTeam = null;
      state.channelsNext = null;
      state.teamsNext = null;
      loadedTeamsPath = null;
      continue;
    }

    const team = state.currentTeam ?? teams[state.teamIndex]!;
    state.currentTeam = team;
    const path = state.channelsNext
      ? teamsPath(state.channelsNext)
      : `/v1.0/teams/${encodeURIComponent(team.id)}/channels?$top=100`;
    const payload = object(
      await responsePayload(
        await graph(input.nango, input.connection, path),
        () => input.repository.markReconnectRequired(input.connection.id),
      ),
    );
    if (!payload) throw new PersonalIntegrationUpstreamError();
    for (const raw of Array.isArray(payload.value) ? payload.value : []) {
      const row = object(raw);
      if (typeof row?.id === "string" && typeof row.displayName === "string")
        channels.push({
          id: row.id,
          name: row.displayName,
          teamId: team.id,
          teamName: team.displayName,
        });
    }
    state.channelsNext = teamsContinuation(payload["@odata.nextLink"], team.id);
    if (state.channelsNext === null) {
      state.teamIndex++;
      state.currentTeam = null;
    }
    requestCount++;
  }
  if (
    state.channelsNext === null &&
    state.teamIndex >= teams.length &&
    state.teamsNext !== null
  ) {
    state.teamsPagePath = state.teamsNext;
    state.teamIndex = 0;
    state.currentTeam = null;
    state.teamsNext = null;
  }
  const more =
    state.channelsNext !== null ||
    state.teamIndex < teams.length ||
    state.teamsNext !== null ||
    loadedTeamsPath !== state.teamsPagePath;
  return {
    channels,
    nextCursor: more ? encodeURIComponent(JSON.stringify(state)) : null,
  };
}

function validRecordUrl(
  raw: string,
  context: ShareRecordInput["context"],
  isAllowedOrigin: (origin: string) => boolean,
): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PersonalIntegrationInputError("Invalid Savia record link");
  }
  const localHttp =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname);
  const hashRoute = url.hash.startsWith("#/studio?");
  const recordQuery = hashRoute
    ? new URLSearchParams(url.hash.slice(url.hash.indexOf("?") + 1))
    : url.searchParams;
  const workspaceId = context.apiBasePath.split("/").at(-1);
  if (
    (url.protocol !== "https:" && !localHttp) ||
    !isAllowedOrigin(url.origin) ||
    url.username ||
    url.password ||
    (!hashRoute && url.pathname !== "/studio") ||
    recordQuery.get("record") !== context.recordId ||
    recordQuery.get("object") !== context.collection ||
    recordQuery.get("tenantId") !== workspaceId
  )
    throw new PersonalIntegrationInputError("Invalid Savia record link");
  return url.toString();
}

function escapeSlack(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function neutralizeBroadcastMentions(value: string): string {
  return value.replace(/@(everyone|here|channel|team)\b/gi, "@\u200b$1");
}

async function requestHash(input: ShareRecordInput): Promise<string> {
  const canonical = JSON.stringify({
    provider: input.provider,
    channelId: input.channelId,
    teamId: input.teamId ?? null,
    title: input.title,
    summary: input.summary,
    url: input.url,
    context: input.context,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function claim(
  database: D1Database,
  principalId: string,
  input: ShareRecordInput,
  hash: string,
): Promise<{ id: string; messageId: string | null } | "claimed"> {
  const now = new Date().toISOString();
  try {
    await database
      .prepare(
        `INSERT INTO personal_collaboration_messages
          (id, principal_id, request_id, request_hash, provider, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'sending', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        principalId,
        input.requestId,
        hash,
        input.provider,
        now,
        now,
      )
      .run();
    return "claimed";
  } catch {
    const existing = await database
      .prepare(
        `SELECT id, request_hash, state, message_id FROM personal_collaboration_messages
         WHERE principal_id = ? AND request_id = ?`,
      )
      .bind(principalId, input.requestId)
      .first<{
        id: string;
        request_hash: string;
        state: string;
        message_id: string | null;
      }>();
    if (!existing) throw new PersonalIntegrationUpstreamError();
    if (existing.request_hash !== hash)
      throw new CollaborationConflictError(
        "PERSONAL_COLLABORATION_REQUEST_ID_REUSED",
        "This request ID was used for different content",
      );
    if (existing.state === "sent" && existing.message_id)
      return { id: existing.id, messageId: existing.message_id };
    throw new CollaborationConflictError(
      "PERSONAL_COLLABORATION_DELIVERY_UNKNOWN",
      "This request may already have been delivered and cannot be sent again safely",
    );
  }
}

async function finish(
  database: D1Database,
  principalId: string,
  requestId: string,
  state: "sent" | "ambiguous",
  messageId?: string,
): Promise<void> {
  await database
    .prepare(
      `UPDATE personal_collaboration_messages
       SET state = ?, message_id = ?, updated_at = ?
       WHERE principal_id = ? AND request_id = ? AND state = 'sending'`,
    )
    .bind(
      state,
      messageId ?? null,
      new Date().toISOString(),
      principalId,
      requestId,
    )
    .run();
}

async function preflight(
  input: ShareRecordInput,
  connection: ActivePersonalIntegrationConnection,
  repository: PersonalIntegrationRepository,
  nango: PersonalIntegrationNangoClient,
): Promise<void> {
  if (input.provider === "slack") {
    const params = new URLSearchParams({ channel: input.channelId });
    const payload = object(
      await responsePayload(
        await graph(nango, connection, `/conversations.info?${params}`),
        () => repository.markReconnectRequired(connection.id),
      ),
    );
    const channel = object(payload?.channel);
    if (!payload || payload.ok === false)
      if (
        payload?.error === "invalid_auth" ||
        payload?.error === "token_revoked"
      )
        await repository.markReconnectRequired(connection.id);
    if (!payload || payload.ok === false)
      throw new PersonalIntegrationUpstreamError();
    if (channel?.is_member !== true)
      throw new PersonalIntegrationInputError(
        "The bot is not a member of this channel",
      );
    return;
  }
  if (!input.teamId)
    throw new PersonalIntegrationInputError("A Teams team is required");
  const path = `/v1.0/teams/${encodeURIComponent(input.teamId)}/channels/${encodeURIComponent(input.channelId)}`;
  const response = await graph(nango, connection, path);
  if (response.status === 404)
    throw new PersonalIntegrationInputError(
      "The selected Teams channel is unavailable",
    );
  await responsePayload(response, () =>
    repository.markReconnectRequired(connection.id),
  );
}

export async function shareRecord(input: {
  database: D1Database;
  principalId: string;
  payload: ShareRecordInput;
  connection: ActivePersonalIntegrationConnection;
  repository: PersonalIntegrationRepository;
  nango: PersonalIntegrationNangoClient;
  validateContext: () => Promise<void>;
  isAllowedOrigin: (origin: string) => boolean;
}): Promise<ShareRecordResult> {
  const payload = input.payload;
  if (payload.provider !== input.connection.provider)
    throw new PersonalIntegrationInputError("Provider connection mismatch");
  const url = validRecordUrl(
    payload.url,
    payload.context,
    input.isAllowedOrigin,
  );
  await input.validateContext();
  await preflight(payload, input.connection, input.repository, input.nango);
  const hash = await requestHash(payload);
  const operation = await claim(
    input.database,
    input.principalId,
    payload,
    hash,
  );
  if (operation !== "claimed")
    return {
      provider: payload.provider,
      messageId: operation.messageId!,
    };

  try {
    let response: Response;
    if (payload.provider === "slack") {
      const title = neutralizeBroadcastMentions(payload.title);
      const summary = neutralizeBroadcastMentions(payload.summary);
      response = await graph(
        input.nango,
        input.connection,
        "/chat.postMessage",
        "POST",
        {
          channel: payload.channelId,
          text: `${title}\n${summary}\n${url}`,
          blocks: [
            { type: "section", text: { type: "plain_text", text: title } },
            ...(() => {
              const chars = Array.from(summary);
              const chunks: string[] = [];
              for (let index = 0; index < chars.length; index += 2900)
                chunks.push(chars.slice(index, index + 2900).join(""));
              return chunks.map((text) => ({
                type: "section",
                text: { type: "plain_text", text },
              }));
            })(),
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  text: { type: "plain_text", text: "Open record in Savia" },
                  url,
                },
              ],
            },
          ],
          mrkdwn: false,
          parse: "none",
          link_names: false,
          unfurl_links: false,
          unfurl_media: false,
        },
      );
    } else {
      const title = neutralizeBroadcastMentions(payload.title);
      const summary = neutralizeBroadcastMentions(payload.summary);
      const content = `<strong>${escapeHtml(title)}</strong><br>${escapeHtml(summary).replaceAll("\n", "<br>")}<br><a href="${escapeHtml(url)}">Open record in Savia</a>`;
      response = await graph(
        input.nango,
        input.connection,
        `/v1.0/teams/${encodeURIComponent(payload.teamId!)}/channels/${encodeURIComponent(payload.channelId)}/messages`,
        "POST",
        { body: { contentType: "html", content } },
      );
    }
    if (!response.ok) {
      await finish(
        input.database,
        input.principalId,
        payload.requestId,
        "ambiguous",
      );
      if (response.status === 401 || response.status === 403)
        await input.repository.markReconnectRequired(input.connection.id);
      throw new PersonalIntegrationUpstreamError();
    }
    const sent = object(await response.json().catch(() => undefined));
    if (payload.provider === "slack" && sent?.ok === false) {
      await finish(
        input.database,
        input.principalId,
        payload.requestId,
        "ambiguous",
      );
      if (sent.error === "invalid_auth" || sent.error === "token_revoked")
        await input.repository.markReconnectRequired(input.connection.id);
      throw new PersonalIntegrationUpstreamError();
    }
    const messageId =
      payload.provider === "slack"
        ? typeof sent?.ts === "string"
          ? sent.ts
          : undefined
        : typeof sent?.id === "string"
          ? sent.id
          : undefined;
    if (!messageId) {
      await finish(
        input.database,
        input.principalId,
        payload.requestId,
        "ambiguous",
      );
      throw new PersonalIntegrationUpstreamError();
    }
    await finish(
      input.database,
      input.principalId,
      payload.requestId,
      "sent",
      messageId,
    );
    await input.repository.appendAuditEvent({
      connection: input.connection,
      eventType: "share-record",
      outcome: "succeeded",
    });
    return { provider: payload.provider, messageId };
  } catch (exception) {
    await finish(
      input.database,
      input.principalId,
      payload.requestId,
      "ambiguous",
    );
    throw exception;
  }
}
