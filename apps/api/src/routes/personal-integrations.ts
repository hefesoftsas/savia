import {
  ticketSummaryConfigSchema,
  ticketSummarySchema,
} from "@savia/studio-shared/ticket-summary";
import { sendPersonalMailSchema } from "@savia/studio-shared/mail-contracts";
import {
  collaborationProviderSchema,
  shareRecordInputSchema,
} from "@savia/studio-shared/collaboration-contracts";
import { validateMailContext } from "../personal-integrations/mail-context";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { actorFromContext } from "../auth/middleware";
import { canonicalHostForApi } from "../auth/tenant-host-guard";
import { isAllowedPublicOrigin } from "@savia/tenant-host/tenant-host";
import { PendingActionRepository } from "../assistant/pending-actions";
import {
  PersonalActionPayloadCipher,
  PersonalActionPayloadUnavailableError,
} from "../assistant/personal-action-payload";
import type {
  PersonalIntegrationConnection,
  PersonalIntegrationNangoClient,
  PersonalIntegrationProviderDefinition,
  PersonalIntegrationProviderId,
  PersonalIntegrationRepository,
} from "../personal-integrations/contracts";
import {
  isPersonalIntegrationProviderId,
  PersonalIntegrationAccessError,
  PersonalIntegrationInputError,
  PersonalIntegrationUnavailableError,
  PersonalIntegrationUpstreamError,
} from "../personal-integrations/contracts";
import { createPersonalIntegrationNangoClient } from "../personal-integrations/nango";
import { createPersonalIntegrationProviderRegistry } from "../personal-integrations/providers";
import { createPersonalIntegrationRepository } from "../personal-integrations/repository";
import { createJiraPrivacyRepository } from "../personal-integrations/jira-privacy-repository";
import {
  CollaborationConflictError,
  listCollaborationChannels,
  shareRecord,
} from "../personal-integrations/collaboration";
import { resolveJiraIdentity } from "../personal-integrations/jira-privacy";
import { cleanJiraPrivacySnapshots } from "../personal-integrations/jira-privacy-runtime";
import {
  PersonalIntegrationOperations,
  type PersonalIntegrationActionResult,
} from "../personal-integrations/operations";

export type PersonalIntegrationRouteDependencies = {
  providers: Record<
    PersonalIntegrationProviderId,
    PersonalIntegrationProviderDefinition
  >;
  nango?: PersonalIntegrationNangoClient;
  personalActionPayloadCipher?: PersonalActionPayloadCipher;
  calendarSecret?: string;
};

const providerDocumentSchema = z.object({
  id: z.enum([
    "google_drive",
    "gmail",
    "google_calendar",
    "outlook",
    "onedrive_personal",
    "onedrive_business",
    "jira",
    "linear",
    "github",
    "zoom",
    "slack",
    "microsoft_teams",
  ]),
  kind: z.literal("personal-integration-provider"),
  attributes: z.object({
    displayName: z.string(),
    availability: z.enum(["enabled", "unavailable"]),
    capabilities: z.array(z.string()),
  }),
});

const providerListRoute = createRoute({
  method: "get",
  path: "/v1/personal-integrations/providers",
  tags: ["Personal integrations"],
  summary: "List the available personal integrations",
  description:
    "Lists the personal provider registry without returning Nango credentials or integration identifiers.",
  security: [{ oauth2: ["savia.api.read"] }],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ data: z.array(providerDocumentSchema) }),
        },
      },
      description: "Personal provider availability",
    },
  },
});

const providerParamSchema = z.object({
  provider: z.string().trim().min(1).max(64),
});
const connectionAttributesSchema = z.object({
  provider: z.enum([
    "google_drive",
    "gmail",
    "google_calendar",
    "outlook",
    "onedrive_personal",
    "onedrive_business",
    "jira",
    "linear",
    "github",
    "zoom",
    "slack",
    "microsoft_teams",
  ]),
  status: z.enum([
    "pending",
    "connected",
    "reconnect_required",
    "disconnected",
    "failed",
  ]),
  externalAccountLabel: z.string().nullable(),
  scopes: z.array(z.string()),
  lastValidatedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const connectionDocumentSchema = z.object({
  id: z.string(),
  kind: z.literal("personal-integration-connection"),
  attributes: connectionAttributesSchema,
});
const sessionSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  connectUrl: z.string().url(),
  apiUrl: z.string().url(),
});

const connectionListRoute = createRoute({
  method: "get",
  path: "/v1/personal-integrations/connections",
  tags: ["Personal integrations"],
  summary: "List the caller's personal integrations",
  security: [{ oauth2: ["savia.api.read"] }],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ data: z.array(connectionDocumentSchema) }),
        },
      },
      description: "Safe personal integration connection state",
    },
  },
});

const connectSessionRoute = createRoute({
  method: "post",
  path: "/v1/personal-integrations/connections/{provider}/connect-session",
  tags: ["Personal integrations"],
  summary: "Create a personal Nango Connect session",
  security: [{ oauth2: ["savia.api.write"] }],
  request: { params: providerParamSchema },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ data: sessionSchema }) },
      },
      description: "Short-lived Nango Connect session",
    },
    404: { description: "Provider not found" },
    503: { description: "Provider unavailable" },
  },
});

const completeConnectionRoute = createRoute({
  method: "post",
  path: "/v1/personal-integrations/connections/{provider}/complete",
  tags: ["Personal integrations"],
  summary: "Validate and persist a caller-owned Nango connection",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    params: providerParamSchema,
    body: {
      content: {
        "application/json": {
          schema: z.object({ connectionId: z.string().trim().min(1).max(255) }),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ data: connectionDocumentSchema }),
        },
      },
      description: "Validated personal connection",
    },
    403: { description: "Connection belongs to a different user" },
    404: { description: "Provider not found" },
    503: { description: "Provider unavailable" },
  },
});

const reconnectSessionRoute = createRoute({
  method: "post",
  path: "/v1/personal-integrations/connections/{provider}/reconnect-session",
  tags: ["Personal integrations"],
  summary: "Create a reconnect session for the caller's personal connection",
  security: [{ oauth2: ["savia.api.write"] }],
  request: { params: providerParamSchema },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ data: sessionSchema }) },
      },
      description: "Short-lived Nango reconnect session",
    },
    404: { description: "Provider or connection not found" },
    503: { description: "Provider unavailable" },
  },
});

const disconnectConnectionRoute = createRoute({
  method: "delete",
  path: "/v1/personal-integrations/connections/{provider}",
  tags: ["Personal integrations"],
  summary: "Disconnect the caller's personal integration",
  security: [{ oauth2: ["savia.api.write"] }],
  request: { params: providerParamSchema },
  responses: {
    204: { description: "Connection disconnected" },
    404: { description: "Provider or connection not found" },
    503: { description: "Provider unavailable" },
  },
});

const fileSearchRoute = createRoute({
  method: "get",
  path: "/v1/personal-integrations/files",
  tags: ["Personal integrations"],
  summary: "Search files in a caller-owned personal drive",
  security: [{ oauth2: ["savia.api.read"] }],
  request: {
    query: z.object({
      provider: z.enum([
        "google_drive",
        "onedrive_personal",
        "onedrive_business",
      ]),
      query: z.string().trim().min(1).max(100),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            data: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                mimeType: z.string().nullable(),
                modifiedAt: z.string().nullable(),
              }),
            ),
          }),
        },
      },
      description: "On-demand file metadata",
    },
    403: { description: "Connection belongs to a different user" },
    502: { description: "Provider request failed" },
    503: { description: "Provider or connection unavailable" },
    409: { description: "Connection is not ready" },
  },
});

const issuePreviewSchema = z.object({
  provider: z.enum(["jira", "linear", "github"]),
  url: z.string().url().max(2048),
  identifier: z.string(),
  title: z.string(),
  status: z.string().nullable(),
  assignee: z.string().nullable(),
  repository: z.string().optional(),
  kind: z.enum(["issue", "pull_request"]).optional(),
});

const issuePreviewRoute = createRoute({
  method: "post",
  path: "/v1/personal-integrations/issue-preview",
  tags: ["Personal integrations"],
  summary: "Preview a linked issue from a caller-owned integration",
  description:
    "Parses supported Jira Cloud, Linear, and GitHub issue or pull request links, then reads safe summary metadata through the caller's active personal connection.",
  security: [{ oauth2: ["savia.api.read"] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ url: z.string().trim().min(1).max(2048) }),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ data: issuePreviewSchema }) },
      },
      description: "Transient issue preview for the current viewer",
    },
    400: { description: "Unsupported issue link" },
    403: { description: "The connected account cannot access this issue" },
    502: { description: "Issue provider request failed" },
    503: { description: "Issue provider connection is unavailable" },
  },
});

const ticketSummaryRoute = createRoute({
  method: "post",
  path: "/v1/personal-integrations/ticket-summary",
  tags: ["Personal integrations"],
  summary: "Summarize the caller's Jira tickets and GitHub reviews",
  description:
    "Reads assigned tickets through the current caller's personal connections. Results are transient and never stored in shared Pages.",
  security: [{ oauth2: ["savia.api.read"] }],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: ticketSummaryConfigSchema } },
    },
  },
  responses: {
    200: {
      description:
        "Personal ticket summary, with explicit partial-result indicators",
      content: {
        "application/json": { schema: z.object({ data: ticketSummarySchema }) },
      },
    },
    400: { description: "Invalid summary filters" },
    403: { description: "The connected account cannot access Jira" },
    502: { description: "Jira request failed" },
    503: { description: "Jira provider or personal connection is unavailable" },
  },
});

const messageListRoute = createRoute({
  method: "get",
  path: "/v1/personal-integrations/messages",
  tags: ["Personal integrations"],
  summary: "Search message metadata in a caller-owned mailbox",
  security: [{ oauth2: ["savia.api.read"] }],
  request: {
    query: z.object({
      provider: z.enum(["gmail", "outlook"]),
      query: z.string().trim().min(1).max(100).optional(),
      cursor: z.string().min(1).max(2048).optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            data: z.array(
              z.object({
                id: z.string(),
                subject: z.string().nullable(),
                sender: z.string().nullable(),
                receivedAt: z.string().nullable(),
                webLink: z.string().nullable(),
              }),
            ),
            pagination: z.object({ nextCursor: z.string().nullable() }),
          }),
        },
      },
      description: "On-demand message metadata",
    },
    400: { description: "Invalid message cursor" },
    403: { description: "Connection belongs to a different user" },
    502: { description: "Provider request failed" },
    503: { description: "Provider or connection unavailable" },
  },
});

const sendMailRoute = createRoute({
  method: "post",
  path: "/v1/personal-integrations/messages",
  tags: ["Personal integrations"],
  summary: "Send caller-confirmed mail from a personal mailbox",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: sendPersonalMailSchema } },
    },
  },
  responses: {
    200: {
      description: "Mail submitted",
      content: {
        "application/json": {
          schema: z.object({
            data: z.object({
              provider: z.enum(["gmail", "outlook"]),
              action: z.literal("send-email"),
            }),
          }),
        },
      },
    },
    400: { description: "Invalid mail" },
    403: { description: "Context access denied" },
    404: { description: "Context record missing" },
    502: { description: "Provider request failed" },
    503: { description: "Connection unavailable" },
  },
});

const collaborationChannelsRoute = createRoute({
  method: "get",
  path: "/v1/personal-integrations/collaboration/channels",
  tags: ["Personal integrations"],
  summary: "List channels in a caller-owned Slack or Teams connection",
  security: [{ oauth2: ["savia.api.read"] }],
  request: {
    query: z.object({
      provider: collaborationProviderSchema,
      cursor: z.string().min(1).max(8192).optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            data: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                teamId: z.string().optional(),
                teamName: z.string().optional(),
              }),
            ),
            pagination: z.object({ nextCursor: z.string().nullable() }),
          }),
        },
      },
      description: "On-demand paginated channel metadata",
    },
    400: { description: "Invalid collaboration cursor" },
    404: { description: "Personal connection not found" },
    409: {
      description: "The personal connection requires reconnection",
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({
              code: z.literal("PERSONAL_INTEGRATION_RECONNECT_REQUIRED"),
              message: z.string(),
            }),
          }),
        },
      },
    },
    502: { description: "Provider request failed" },
    503: { description: "Provider or connection unavailable" },
  },
});

function collaborationConnectionError(
  connection: PersonalIntegrationConnection & {
    nangoIntegrationId?: string;
  },
  configuredIntegrationId: string,
) {
  if (connection.status !== "connected")
    return {
      status: 409 as const,
      body: errorBody(
        "PERSONAL_INTEGRATION_RECONNECT_REQUIRED",
        "Reconnect this collaboration account before continuing",
      ),
    };
  if (connection.nangoIntegrationId !== configuredIntegrationId)
    return {
      status: 409 as const,
      body: errorBody(
        "PERSONAL_INTEGRATION_RECONNECT_REQUIRED",
        "Reconnect this collaboration account to use the configured provider",
      ),
    };
  return undefined;
}

const shareCollaborationRecordRoute = createRoute({
  method: "post",
  path: "/v1/personal-integrations/collaboration/messages",
  tags: ["Personal integrations"],
  summary: "Share a Savia record to a caller-owned collaboration channel",
  description:
    "Revalidates the selected record and submits one message to the chosen Slack or Teams channel. Ambiguous sends are never retried automatically.",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: shareRecordInputSchema } },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            data: z.object({
              provider: collaborationProviderSchema,
              messageId: z.string(),
            }),
          }),
        },
      },
      description: "The record message was delivered or safely replayed",
    },
    400: { description: "Invalid record link, channel, or provider input" },
    403: { description: "The selected record is not accessible" },
    404: { description: "Personal connection or record not found" },
    409: { description: "The request may have been delivered already" },
    502: { description: "Provider request failed or delivery is unknown" },
    503: { description: "Provider or connection unavailable" },
  },
});

const eventListRoute = createRoute({
  method: "get",
  path: "/v1/personal-integrations/events",
  tags: ["Personal integrations"],
  summary: "List events in a caller-owned calendar",
  security: [{ oauth2: ["savia.api.read"] }],
  request: {
    query: z.object({
      provider: z.enum(["google_calendar", "outlook"]),
      from: z.string().trim().min(1).max(64).optional(),
      to: z.string().trim().min(1).max(64).optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            data: z.array(
              z.object({
                id: z.string(),
                title: z.string().nullable(),
                startsAt: z.string().nullable(),
                endsAt: z.string().nullable(),
                webLink: z.string().url().nullable(),
                allDay: z.boolean().optional(),
                timeZone: z.string().nullable().optional(),
                conference: z
                  .object({
                    provider: z
                      .enum(["google_meet", "teams", "jitsi", "zoom"])
                      .nullable(),
                    joinUrl: z.string().url().nullable(),
                    status: z.enum([
                      "ready",
                      "pending",
                      "unsupported",
                      "failed",
                    ]),
                  })
                  .optional(),
              }),
            ),
          }),
        },
      },
      description: "On-demand calendar events",
    },
    403: { description: "Connection belongs to a different user" },
    502: { description: "Provider request failed" },
    503: { description: "Provider or connection unavailable" },
  },
});

const createCalendarEventRoute = createRoute({
  method: "post",
  path: "/v1/personal-integrations/events",
  tags: ["Personal integrations"],
  summary: "Create a caller-confirmed calendar event",
  description:
    "Creates a Google Calendar or Outlook event only after the caller has explicitly confirmed the event details in Savia.",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              provider: z.enum(["google_calendar", "outlook"]),
              title: z.string().trim().min(1).max(2000),
              startsAt: z.string().trim().min(1).max(64),
              endsAt: z.string().trim().min(1).max(64),
              videoCall: z.boolean().optional(),
              conferenceProvider: z.enum(["jitsi", "zoom"]).optional(),
              requestId: z.uuid().optional(),
              attendees: z
                .array(z.string().trim().email().max(254))
                .max(50)
                .optional(),
            })
            .refine(
              (input) => !input.conferenceProvider || input.videoCall === true,
              { message: "A conference provider requires videoCall" },
            )
            .refine(
              (input) => input.conferenceProvider !== "zoom" || input.requestId,
              { message: "A requestId is required for Zoom video calls" },
            ),
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: z.object({
            data: z.object({
              id: z.string(),
              connectionId: z.string(),
              title: z.string().nullable(),
              startsAt: z.string().nullable(),
              endsAt: z.string().nullable(),
              webLink: z.string().url().nullable(),
              conference: z
                .object({
                  provider: z
                    .enum(["google_meet", "teams", "jitsi", "zoom"])
                    .nullable(),
                  joinUrl: z.string().url().nullable(),
                  status: z.enum(["ready", "pending", "unsupported", "failed"]),
                })
                .optional(),
            }),
          }),
        },
      },
      description: "Calendar event created for the caller",
    },
    400: { description: "Invalid event details" },
    502: { description: "Provider request failed" },
    503: { description: "Provider or connection unavailable" },
  },
});

const deleteCalendarEventRoute = createRoute({
  method: "delete",
  path: "/v1/personal-integrations/events/{provider}/{eventId}",
  tags: ["Personal integrations"],
  summary: "Delete a confirmed event from a caller-owned calendar",
  description:
    "Deletes one event from the caller's primary Google Calendar or Outlook calendar only after explicit confirmation. Savia booking events and recurring series are protected.",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    params: z.object({
      provider: z.enum(["google_calendar", "outlook"]),
      eventId: z.string().min(1).max(255),
    }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            confirmed: z.literal(true),
            connectionId: z.string().trim().min(1).max(255),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Calendar event deleted",
      content: {
        "application/json": {
          schema: z.object({ data: z.object({ deleted: z.literal(true) }) }),
        },
      },
    },
    400: { description: "Confirmation, event id, or event type is invalid" },
    403: { description: "Connection belongs to a different user" },
    502: { description: "Provider request failed" },
    503: { description: "Connection unavailable" },
  },
});

const actionResultSchema = z.object({
  provider: z.enum([
    "google_drive",
    "gmail",
    "outlook",
    "google_calendar",
    "onedrive_personal",
    "onedrive_business",
    "zoom",
    "slack",
    "microsoft_teams",
  ]),
  action: z.enum(["send-email", "create-event", "upload-file"]),
});

const executePersonalActionRoute = createRoute({
  method: "post",
  path: "/v1/personal-integrations/actions/{actionId}/execute",
  tags: ["Personal integrations"],
  summary: "Execute an already-confirmed personal integration action",
  description:
    "Loads the pending action server-side. It accepts no email or event payload and only runs once the owner has explicitly confirmed it through Savia Assistant.",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    params: z.object({ actionId: z.string().trim().min(1).max(255) }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ data: actionResultSchema }),
        },
      },
      description: "Confirmed action submitted to the connected provider",
    },
    400: { description: "Invalid stored action" },
    409: { description: "Action is not awaiting one permitted execution" },
    502: { description: "Provider request failed" },
    503: { description: "Provider or connection unavailable" },
  },
});

function providerDocument(provider: PersonalIntegrationProviderDefinition) {
  return {
    id: provider.id,
    kind: "personal-integration-provider" as const,
    attributes: {
      displayName: provider.displayName,
      availability: provider.availability,
      capabilities: [...provider.capabilities],
    },
  };
}

function connectionDocument(connection: PersonalIntegrationConnection) {
  return {
    id: connection.id,
    kind: "personal-integration-connection" as const,
    attributes: {
      provider: connection.provider,
      status: connection.status,
      externalAccountLabel: connection.externalAccountLabel,
      scopes: connection.scopes,
      lastValidatedAt: connection.lastValidatedAt,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    },
  };
}

function providerResolution(
  providers: PersonalIntegrationRouteDependencies["providers"],
  requestedProvider: string,
):
  | { provider: PersonalIntegrationProviderDefinition }
  | { status: 404 | 503; code: string; message: string } {
  if (!isPersonalIntegrationProviderId(requestedProvider))
    return {
      status: 404,
      code: "PERSONAL_INTEGRATION_PROVIDER_NOT_FOUND",
      message: "Personal integration provider not found",
    };
  const provider = providers[requestedProvider];
  if (provider.availability === "unavailable")
    return {
      status: 503,
      code: "PERSONAL_INTEGRATION_UNAVAILABLE",
      message: "The requested personal integration is unavailable",
    };
  return { provider };
}

function isProviderError(
  value: ReturnType<typeof providerResolution>,
): value is Extract<ReturnType<typeof providerResolution>, { status: number }> {
  return "status" in value;
}

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

function scopesFromMetadata(
  metadata: Record<string, string | string[]>,
): string[] {
  const scopes = metadata.scopes;
  return Array.isArray(scopes)
    ? scopes
    : typeof scopes === "string"
      ? scopes.split(/[\s,]+/).filter(Boolean)
      : [];
}

function personalErrorResponse(exception: unknown) {
  if (exception instanceof PersonalActionPayloadUnavailableError)
    return {
      status: 409,
      body: errorBody(
        "PERSONAL_INTEGRATION_ACTION_NOT_APPROVED",
        "This personal integration action is not approved for execution",
      ),
    } as const;
  if (exception instanceof PersonalIntegrationAccessError)
    return {
      status: 403,
      body: errorBody(exception.code, exception.message),
    } as const;
  if (exception instanceof PersonalIntegrationUnavailableError)
    return {
      status: 503,
      body: errorBody(exception.code, exception.message),
    } as const;
  if (exception instanceof PersonalIntegrationUpstreamError)
    return {
      status: 502,
      body: errorBody(exception.code, exception.message),
    } as const;
  if (exception instanceof PersonalIntegrationInputError)
    return {
      status: 400,
      body: errorBody(exception.code, exception.message),
    } as const;
  return undefined;
}

async function activeConnectionFor(
  repository: PersonalIntegrationRepository,
  principalId: string,
  provider: PersonalIntegrationProviderId,
) {
  return repository.findActiveConnection(principalId, provider);
}

export function registerPersonalIntegrationRoutes(
  app: OpenAPIHono,
  database: D1Database,
  dependencies?: PersonalIntegrationRouteDependencies,
): void {
  const providers =
    dependencies?.providers ?? createPersonalIntegrationProviderRegistry({});
  const repository = createPersonalIntegrationRepository(database);
  const jiraPrivacy = createJiraPrivacyRepository(database);
  const actions = new PendingActionRepository(database);
  const nango = dependencies?.nango;
  const personalActionPayloadCipher = dependencies?.personalActionPayloadCipher;
  const operations = nango
    ? new PersonalIntegrationOperations(repository, nango, database)
    : undefined;

  app.openapi(providerListRoute, (context) => {
    actorFromContext(context);
    return context.json(
      { data: Object.values(providers).map(providerDocument) },
      200,
    );
  });

  app.openapi(connectionListRoute, async (context) => {
    const actor = actorFromContext(context);
    const connections = await repository.listConnections(actor.principal.id);
    return context.json({ data: connections.map(connectionDocument) }, 200);
  });

  app.openapi(connectSessionRoute, async (context) => {
    const actor = actorFromContext(context);
    const resolved = providerResolution(
      providers,
      context.req.valid("param").provider,
    );
    if (isProviderError(resolved))
      return context.json(
        errorBody(resolved.code, resolved.message),
        resolved.status,
      );
    if (!nango || !resolved.provider.integrationId)
      return context.json(
        errorBody(
          "PERSONAL_INTEGRATION_UNAVAILABLE",
          "The requested personal integration is unavailable",
        ),
        503,
      );
    try {
      const session = await nango.createConnectSession({
        actor,
        provider: resolved.provider.id,
        integrationId: resolved.provider.integrationId,
      });
      return context.json({ data: session }, 200);
    } catch (exception) {
      const response = personalErrorResponse(exception);
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(completeConnectionRoute, async (context) => {
    const actor = actorFromContext(context);
    const resolved = providerResolution(
      providers,
      context.req.valid("param").provider,
    );
    if (isProviderError(resolved))
      return context.json(
        errorBody(resolved.code, resolved.message),
        resolved.status,
      );
    if (!nango || !resolved.provider.integrationId)
      return context.json(
        errorBody(
          "PERSONAL_INTEGRATION_UNAVAILABLE",
          "The requested personal integration is unavailable",
        ),
        503,
      );
    try {
      const summary = await nango.getConnection(
        context.req.valid("json").connectionId,
        resolved.provider.integrationId,
      );
      if (
        summary.providerConfigKey !== resolved.provider.integrationId ||
        summary.tags.end_user_id !== actor.principal.id ||
        summary.tags.end_user_email !== actor.principal.email
      )
        throw new PersonalIntegrationAccessError();
      const metadata = summary.metadata;
      const completion = {
        principalId: actor.principal.id,
        provider: resolved.provider.id,
        nangoConnectionId: summary.connectionId,
        nangoIntegrationId: resolved.provider.integrationId,
        status: "connected" as const,
        externalAccountLabel:
          (typeof metadata.account_name === "string" &&
            metadata.account_name) ||
          (typeof metadata.email === "string" && metadata.email) ||
          actor.principal.email,
        externalAccountId:
          typeof metadata.account_id === "string" ? metadata.account_id : null,
        scopes: scopesFromMetadata(metadata),
        lastValidatedAt: new Date().toISOString(),
      };
      const stored =
        resolved.provider.id === "jira"
          ? await jiraPrivacy.saveVerifiedConnection(
              completion,
              await resolveJiraIdentity(
                nango,
                {
                  provider: "jira",
                  nangoConnectionId: summary.connectionId,
                  nangoIntegrationId: resolved.provider.integrationId,
                },
                completion.lastValidatedAt,
              ),
            )
          : await repository.saveConnection(completion);
      const {
        principalId: _principalId,
        nangoConnectionId: _nangoConnectionId,
        nangoIntegrationId: _nangoIntegrationId,
        externalAccountId: _externalAccountId,
        ...connection
      } = stored;
      return context.json({ data: connectionDocument(connection) }, 200);
    } catch (exception) {
      const response = personalErrorResponse(exception);
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(reconnectSessionRoute, async (context) => {
    const actor = actorFromContext(context);
    const resolved = providerResolution(
      providers,
      context.req.valid("param").provider,
    );
    if (isProviderError(resolved))
      return context.json(
        errorBody(resolved.code, resolved.message),
        resolved.status,
      );
    if (!nango || !resolved.provider.integrationId)
      return context.json(
        errorBody(
          "PERSONAL_INTEGRATION_UNAVAILABLE",
          "The requested personal integration is unavailable",
        ),
        503,
      );
    const connection = await activeConnectionFor(
      repository,
      actor.principal.id,
      resolved.provider.id,
    );
    if (!connection)
      return context.json(
        errorBody(
          "PERSONAL_INTEGRATION_CONNECTION_NOT_FOUND",
          "Personal integration connection not found",
        ),
        404,
      );
    try {
      const session =
        resolved.provider.id === "zoom"
          ? await nango.createConnectSession({
              actor,
              provider: resolved.provider.id,
              integrationId: resolved.provider.integrationId,
            })
          : await nango.createReconnectSession({
              connectionId: connection.nangoConnectionId,
              integrationId: connection.nangoIntegrationId,
            });
      return context.json({ data: session }, 200);
    } catch (exception) {
      const response = personalErrorResponse(exception);
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(disconnectConnectionRoute, async (context) => {
    const actor = actorFromContext(context);
    const resolved = providerResolution(
      providers,
      context.req.valid("param").provider,
    );
    if (isProviderError(resolved))
      return context.json(
        errorBody(resolved.code, resolved.message),
        resolved.status,
      );
    if (!nango || !resolved.provider.integrationId)
      return context.json(
        errorBody(
          "PERSONAL_INTEGRATION_UNAVAILABLE",
          "The requested personal integration is unavailable",
        ),
        503,
      );
    const connection = await activeConnectionFor(
      repository,
      actor.principal.id,
      resolved.provider.id,
    );
    if (!connection)
      return context.json(
        errorBody(
          "PERSONAL_INTEGRATION_CONNECTION_NOT_FOUND",
          "Personal integration connection not found",
        ),
        404,
      );
    try {
      if (connection.provider === "jira") {
        const now = new Date().toISOString();
        await jiraPrivacy.queueDisconnect(connection, "disconnect", now);
        const pending = (
          await jiraPrivacy.listCleanup(now, 90, connection.nangoIntegrationId)
        ).filter(
          (snapshot) =>
            snapshot.connectionId === connection.id &&
            snapshot.nangoConnectionId === connection.nangoConnectionId,
        );
        if (await cleanJiraPrivacySnapshots(jiraPrivacy, nango, pending, now))
          throw new PersonalIntegrationUpstreamError();
      } else {
        await nango.deleteConnection(
          connection.nangoConnectionId,
          connection.nangoIntegrationId,
        );
        await repository.markDisconnected(
          actor.principal.id,
          resolved.provider.id,
        );
      }
      return context.body(null, 204);
    } catch (exception) {
      const response = personalErrorResponse(exception);
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(fileSearchRoute, async (context) => {
    const actor = actorFromContext(context);
    if (!operations)
      return context.json(
        errorBody(
          "PERSONAL_INTEGRATION_UNAVAILABLE",
          "The requested personal integration is unavailable",
        ),
        503,
      );
    try {
      const query = context.req.valid("query");
      const files = await operations.searchFiles({
        principalId: actor.principal.id,
        provider: query.provider,
        query: query.query,
      });
      return context.json({ data: files }, 200);
    } catch (exception) {
      const response = personalErrorResponse(exception);
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(issuePreviewRoute, async (context) => {
    const actor = actorFromContext(context);
    context.header("Cache-Control", "no-store");
    if (!operations)
      return context.json(
        errorBody(
          "PERSONAL_INTEGRATION_UNAVAILABLE",
          "The requested personal integration is unavailable",
        ),
        503,
      );
    try {
      const { url } = context.req.valid("json");
      const preview = await operations.previewIssue({
        principalId: actor.principal.id,
        url,
      });
      return context.json({ data: preview }, 200);
    } catch (exception) {
      const response = personalErrorResponse(exception);
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(ticketSummaryRoute, async (context) => {
    const actor = actorFromContext(context);
    context.header("Cache-Control", "no-store");
    if (!operations || providers.jira.availability !== "enabled")
      return context.json(
        errorBody(
          "PERSONAL_INTEGRATION_UNAVAILABLE",
          "The requested personal integration is unavailable",
        ),
        503,
      );
    try {
      const summary = await operations.summarizeTickets({
        principalId: actor.principal.id,
        config: context.req.valid("json"),
        githubEnabled: providers.github.availability === "enabled",
      });
      return context.json({ data: summary }, 200);
    } catch (exception) {
      const response = personalErrorResponse(exception);
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(executePersonalActionRoute, async (context) => {
    const actor = actorFromContext(context);
    if (!operations || !personalActionPayloadCipher)
      return context.json(
        errorBody(
          "PERSONAL_INTEGRATION_UNAVAILABLE",
          "The requested personal integration is unavailable",
        ),
        503,
      );
    const action = await actions.claimPersonalExecution(
      context.req.valid("param").actionId,
      actor.principal.id,
    );
    if (!action)
      return context.json(
        errorBody(
          "PERSONAL_INTEGRATION_ACTION_NOT_APPROVED",
          "This personal integration action is not approved for execution",
        ),
        409,
      );
    try {
      const result: PersonalIntegrationActionResult =
        await operations.executeConfirmedAction({
          principalId: actor.principal.id,
          command: action.command,
          input: await personalActionPayloadCipher.unseal({
            actionId: action.id,
            principalId: actor.principal.id,
            storedInput: action.input,
          }),
        });
      return context.json({ data: result }, 200);
    } catch (exception) {
      const response = personalErrorResponse(exception);
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(messageListRoute, async (context) => {
    const actor = actorFromContext(context);
    if (!operations)
      return context.json(
        errorBody(
          "PERSONAL_INTEGRATION_UNAVAILABLE",
          "The requested personal integration is unavailable",
        ),
        503,
      );
    try {
      const query = context.req.valid("query");
      const page = await operations.listMessagePage({
        principalId: actor.principal.id,
        provider: query.provider,
        query: query.query,
        cursor: query.cursor,
      });
      return context.json(
        {
          data: page.messages,
          pagination: { nextCursor: page.nextCursor },
        },
        200,
      );
    } catch (exception) {
      const response = personalErrorResponse(exception);
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(sendMailRoute, async (context) => {
    const actor = actorFromContext(context);
    if (!operations)
      return context.json(
        errorBody(
          "PERSONAL_INTEGRATION_UNAVAILABLE",
          "The requested personal integration is unavailable",
        ),
        503,
      );
    try {
      const input = context.req.valid("json");
      await validateMailContext(input.context ?? [], (path) => {
        const url = new URL(context.req.url);
        url.pathname = path;
        url.search = "";
        return Promise.resolve(
          app.request(
            new Request(url, {
              method: "GET",
              headers: context.req.raw.headers,
            }),
            undefined,
            context.env,
          ),
        );
      });
      const result = await operations.sendMail({
        ...input,
        principalId: actor.principal.id,
      });
      return context.json(
        {
          data: {
            provider: input.provider,
            action: result.action as "send-email",
          },
        },
        200,
      );
    } catch (exception) {
      const response = personalErrorResponse(exception);
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(collaborationChannelsRoute, async (context) => {
    const actor = actorFromContext(context);
    const query = context.req.valid("query");
    const resolved = providerResolution(providers, query.provider);
    if (isProviderError(resolved))
      return context.json(
        errorBody(resolved.code, resolved.message),
        resolved.status,
      );
    if (!nango || !resolved.provider.integrationId)
      return context.json(
        errorBody(
          "PERSONAL_INTEGRATION_UNAVAILABLE",
          "The requested personal integration is unavailable",
        ),
        503,
      );
    const connection = await activeConnectionFor(
      repository,
      actor.principal.id,
      query.provider,
    );
    if (!connection)
      return context.json(
        errorBody(
          "PERSONAL_INTEGRATION_CONNECTION_NOT_FOUND",
          "Personal integration connection not found",
        ),
        404,
      );
    const connectionError = collaborationConnectionError(
      connection,
      resolved.provider.integrationId,
    );
    if (connectionError)
      return context.json(connectionError.body, connectionError.status);
    try {
      const page = await listCollaborationChannels({
        provider: query.provider,
        connection,
        nango,
        repository,
        cursor: query.cursor,
      });
      return context.json(
        { data: page.channels, pagination: { nextCursor: page.nextCursor } },
        200,
      );
    } catch (exception) {
      const response = personalErrorResponse(exception);
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(shareCollaborationRecordRoute, async (context) => {
    const actor = actorFromContext(context);
    const input = context.req.valid("json");
    const resolved = providerResolution(providers, input.provider);
    if (isProviderError(resolved))
      return context.json(
        errorBody(resolved.code, resolved.message),
        resolved.status,
      );
    if (!nango || !resolved.provider.integrationId)
      return context.json(
        errorBody(
          "PERSONAL_INTEGRATION_UNAVAILABLE",
          "The requested personal integration is unavailable",
        ),
        503,
      );
    const connection = await activeConnectionFor(
      repository,
      actor.principal.id,
      input.provider,
    );
    if (!connection)
      return context.json(
        errorBody(
          "PERSONAL_INTEGRATION_CONNECTION_NOT_FOUND",
          "Personal integration connection not found",
        ),
        404,
      );
    const connectionError = collaborationConnectionError(
      connection,
      resolved.provider.integrationId,
    );
    if (connectionError)
      return context.json(connectionError.body, connectionError.status);
    try {
      const result = await shareRecord({
        database,
        principalId: actor.principal.id,
        payload: input,
        connection,
        repository,
        nango,
        validateContext: () =>
          validateMailContext([input.context], (path) => {
            const url = new URL(context.req.url);
            url.pathname = path;
            url.search = "";
            return Promise.resolve(
              app.request(
                new Request(url, {
                  method: "GET",
                  headers: context.req.raw.headers,
                }),
                undefined,
                context.env,
              ),
            );
          }),
        isAllowedOrigin: (origin) => {
          const configuredOrigin = (
            context.env as { SAVIA_PUBLIC_ORIGIN?: string } | undefined
          )?.SAVIA_PUBLIC_ORIGIN;
          if (configuredOrigin) {
            try {
              if (new URL(configuredOrigin).origin === origin) return true;
            } catch {
              // Invalid configuration fails closed through the canonical-host check.
            }
          }
          return isAllowedPublicOrigin(
            origin,
            canonicalHostForApi(configuredOrigin),
          );
        },
      });
      return context.json({ data: result }, 200);
    } catch (exception) {
      if (exception instanceof CollaborationConflictError)
        return context.json(errorBody(exception.code, exception.message), 409);
      const response = personalErrorResponse(exception);
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(eventListRoute, async (context) => {
    const actor = actorFromContext(context);
    if (!operations)
      return context.json(
        errorBody(
          "PERSONAL_INTEGRATION_UNAVAILABLE",
          "The requested personal integration is unavailable",
        ),
        503,
      );
    try {
      const query = context.req.valid("query");
      return context.json(
        {
          data: await operations.listEvents({
            principalId: actor.principal.id,
            provider: query.provider,
            from: query.from ? new Date(query.from) : undefined,
            to: query.to ? new Date(query.to) : undefined,
          }),
        },
        200,
      );
    } catch (exception) {
      const response = personalErrorResponse(exception);
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(deleteCalendarEventRoute, async (context) => {
    const actor = actorFromContext(context);
    if (!operations)
      return context.json(
        errorBody(
          "PERSONAL_INTEGRATION_UNAVAILABLE",
          "The requested personal integration is unavailable",
        ),
        503,
      );
    try {
      const { provider, eventId } = context.req.valid("param");
      const { connectionId: expectedConnectionId } = context.req.valid("json");
      const connection = await activeConnectionFor(
        repository,
        actor.principal.id,
        provider,
      );
      if (
        !connection ||
        connection.status !== "connected" ||
        connection.id !== expectedConnectionId
      )
        throw new PersonalIntegrationUnavailableError(
          "The personal integration connection changed; refresh the calendar and try again",
        );
      if (connection?.status === "connected") {
        let bookings: { id: string; external_id: string | null }[];
        try {
          const result = await database
            .prepare(
              `SELECT id, external_id FROM tenant_bookings
               WHERE principal_id = ? AND calendar_provider = ?
                 AND (external_id = ? OR
                   (calendar_provider = 'google_calendar' AND external_id IS NULL))`,
            )
            .bind(actor.principal.id, provider, eventId)
            .all<{ id: string; external_id: string | null }>();
          bookings = result.results;
        } catch {
          throw new PersonalIntegrationUpstreamError();
        }
        let linkedBooking = bookings.some(
          (booking) => booking.external_id === eventId,
        );
        if (provider === "google_calendar" && !linkedBooking) {
          for (const booking of bookings) {
            if (booking.external_id) continue;
            const digest = await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(booking.id),
            );
            const marker = Array.from(new Uint8Array(digest), (byte) =>
              byte.toString(16).padStart(2, "0"),
            ).join("");
            if (marker === eventId) {
              linkedBooking = true;
              break;
            }
          }
        }
        if (linkedBooking)
          throw new PersonalIntegrationInputError(
            "Savia booking events must be cancelled from bookings",
          );
      }
      await operations.deleteCalendarEvent({
        principalId: actor.principal.id,
        provider,
        eventId,
        expectedConnectionId,
      });
      return context.json({ data: { deleted: true as const } }, 200);
    } catch (exception) {
      const response = personalErrorResponse(exception);
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(createCalendarEventRoute, async (context) => {
    const actor = actorFromContext(context);
    if (!operations)
      return context.json(
        errorBody(
          "PERSONAL_INTEGRATION_UNAVAILABLE",
          "The requested personal integration is unavailable",
        ),
        503,
      );
    try {
      const input = context.req.valid("json");
      return context.json(
        {
          data: await operations.createCalendarEvent({
            principalId: actor.principal.id,
            provider: input.provider,
            title: input.title,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            videoCall: input.videoCall,
            conferenceProvider: input.conferenceProvider,
            requestId: input.requestId,
            attendees: input.attendees,
          }),
        },
        201,
      );
    } catch (exception) {
      const response = personalErrorResponse(exception);
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });
}
