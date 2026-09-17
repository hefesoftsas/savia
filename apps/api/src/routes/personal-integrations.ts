import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { actorFromContext } from "../auth/middleware";
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
};

const providerDocumentSchema = z.object({
  id: z.enum([
    "google_drive",
    "gmail",
    "google_calendar",
    "outlook",
    "onedrive_personal",
    "onedrive_business",
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
  summary: "List personal Google and Microsoft integrations",
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
      provider: z.enum(["google_drive", "onedrive_personal", "onedrive_business"]),
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

const messageListRoute = createRoute({
  method: "get",
  path: "/v1/personal-integrations/messages",
  tags: ["Personal integrations"],
  summary: "Search message metadata in a caller-owned mailbox",
  security: [{ oauth2: ["savia.api.read"] }],
  request: {
    query: z.object({
      provider: z.enum(["gmail", "outlook"]),
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
                subject: z.string().nullable(),
                sender: z.string().nullable(),
                receivedAt: z.string().nullable(),
              }),
            ),
          }),
        },
      },
      description: "On-demand message metadata",
    },
    403: { description: "Connection belongs to a different user" },
    502: { description: "Provider request failed" },
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
          schema: z.object({
            provider: z.enum(["google_calendar", "outlook"]),
            title: z.string().trim().min(1).max(2000),
            startsAt: z.string().trim().min(1).max(64),
            endsAt: z.string().trim().min(1).max(64),
          }),
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
              title: z.string().nullable(),
              startsAt: z.string().nullable(),
              endsAt: z.string().nullable(),
              webLink: z.string().url().nullable(),
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

const actionResultSchema = z.object({
  provider: z.enum([
    "google_drive",
    "gmail",
    "outlook",
    "google_calendar",
    "onedrive_personal",
    "onedrive_business",
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

function scopesFromMetadata(metadata: Record<string, string | string[]>): string[] {
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
    return { status: 403, body: errorBody(exception.code, exception.message) } as const;
  if (exception instanceof PersonalIntegrationUnavailableError)
    return { status: 503, body: errorBody(exception.code, exception.message) } as const;
  if (exception instanceof PersonalIntegrationUpstreamError)
    return { status: 502, body: errorBody(exception.code, exception.message) } as const;
  if (exception instanceof PersonalIntegrationInputError)
    return { status: 400, body: errorBody(exception.code, exception.message) } as const;
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
  const actions = new PendingActionRepository(database);
  const nango = dependencies?.nango;
  const personalActionPayloadCipher = dependencies?.personalActionPayloadCipher;
  const operations = nango
    ? new PersonalIntegrationOperations(repository, nango)
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
      return context.json(errorBody(resolved.code, resolved.message), resolved.status);
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
      return context.json(errorBody(resolved.code, resolved.message), resolved.status);
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
      const stored = await repository.saveConnection({
        principalId: actor.principal.id,
        provider: resolved.provider.id,
        nangoConnectionId: summary.connectionId,
        nangoIntegrationId: resolved.provider.integrationId,
        status: "connected",
        externalAccountLabel:
          (typeof metadata.account_name === "string" && metadata.account_name) ||
          (typeof metadata.email === "string" && metadata.email) ||
          actor.principal.email,
        externalAccountId:
          typeof metadata.account_id === "string" ? metadata.account_id : null,
        scopes: scopesFromMetadata(metadata),
        lastValidatedAt: new Date().toISOString(),
      });
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
      return context.json(errorBody(resolved.code, resolved.message), resolved.status);
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
      const session = await nango.createReconnectSession({
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
      return context.json(errorBody(resolved.code, resolved.message), resolved.status);
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
      await nango.deleteConnection(
        connection.nangoConnectionId,
        connection.nangoIntegrationId,
      );
      await repository.markDisconnected(actor.principal.id, resolved.provider.id);
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
      return context.json(
        {
          data: await operations.listMessages({
            principalId: actor.principal.id,
            provider: query.provider,
            query: query.query,
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
