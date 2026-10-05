import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { authorizedAgencyIds } from "../auth/access-policy";
import { actorFromContext } from "../auth/middleware";
import type {
  ActiveWhatsappConnection,
  WhatsappConnection,
  WhatsappNangoClient,
  WhatsappProviderDefinition,
} from "../whatsapp/contracts";
import {
  WhatsappConnectionAccessError,
  WhatsappConnectionAlreadyAssignedError,
  WhatsappConnectionNotFoundError,
  WhatsappOrganizationConnectionExistsError,
  WhatsappUnavailableError,
  WhatsappUpstreamError,
} from "../whatsapp/contracts";
import { whatsappIntegrationIdFor } from "../whatsapp/nango";
import { whatsappNangoConfigurationFromEnvironment } from "../whatsapp/runtime";
import { createWhatsappProviderRegistry } from "../whatsapp/providers";
import { createWhatsappRepository } from "../whatsapp/repository";

export type WhatsappRouteDependencies = {
  nango: WhatsappNangoClient;
  provider: WhatsappProviderDefinition;
};

const agencyIdSchema = z.coerce.number().int().positive();
const optionalAgencyIdQuerySchema = z.object({
  agencyId: agencyIdSchema.optional(),
});
const optionalAgencyIdBodySchema = z.object({
  agencyId: agencyIdSchema.optional(),
});
const completeBodySchema = z.object({
  agencyId: agencyIdSchema.optional(),
  connectionId: z.string().trim().min(1).max(255),
  phoneNumberId: z.string().trim().min(5).max(32).regex(/^\d+$/).optional(),
  displayPhoneNumber: z.string().trim().min(1).max(32).optional(),
  wabaId: z.string().trim().min(5).max(32).regex(/^\d+$/).optional(),
});
const testSendBodySchema = z.object({
  agencyId: agencyIdSchema,
  to: z
    .string()
    .max(32)
    .transform((value) => value.replace(/\s/g, ""))
    .pipe(
      z
        .string()
        .min(7)
        .max(20)
        .regex(/^\+?\d+$/),
    ),
  text: z.string().trim().min(1).max(1000),
});
const numberBodySchema = z.object({
  agencyId: agencyIdSchema.optional(),
  phoneNumberId: z.string().trim().min(5).max(32).regex(/^\d+$/),
  displayPhoneNumber: z.string().trim().min(1).max(32).optional(),
  wabaId: z.string().trim().min(5).max(32).regex(/^\d+$/).optional(),
});
const connectionAttributesSchema = z.object({
  agencyId: z.number().int().positive(),
  provider: z.literal("whatsapp"),
  status: z.enum([
    "pending",
    "connected",
    "reconnect_required",
    "disconnected",
    "failed",
  ]),
  phoneNumberId: z.string().nullable(),
  displayPhoneNumber: z.string().nullable(),
  wabaId: z.string().nullable(),
  externalAccountLabel: z.string().nullable(),
  lastValidatedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const connectionDocumentSchema = z.object({
  id: z.string(),
  kind: z.literal("whatsapp-connection"),
  attributes: connectionAttributesSchema,
});
const providerDocumentSchema = z.object({
  id: z.literal("whatsapp"),
  kind: z.literal("whatsapp-provider"),
  attributes: z.object({
    displayName: z.string(),
    availability: z.enum(["enabled", "unavailable"]),
    capabilities: z.array(z.string()),
  }),
});
const connectSessionSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  connectUrl: z.string().url(),
  apiUrl: z.string().url(),
});

const providerRoute = createRoute({
  method: "get",
  path: "/v1/whatsapp/providers",
  tags: ["WhatsApp"],
  summary: "Describe the WhatsApp messaging provider",
  description:
    "Describes Savia's WhatsApp provider backed by Nango. Provider credentials and Nango integration configuration are never returned.",
  security: [{ oauth2: ["savia.api.read"] }],
  request: { query: optionalAgencyIdQuerySchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ data: z.array(providerDocumentSchema) }),
        },
      },
      description: "Provider availability",
    },
    400: { description: "Invalid agency identifier" },
    403: { description: "The actor cannot access messaging integrations" },
  },
});

const connectionListRoute = createRoute({
  method: "get",
  path: "/v1/whatsapp/connections",
  tags: ["WhatsApp"],
  summary: "List the current user's WhatsApp connection",
  security: [{ oauth2: ["savia.api.read"] }],
  request: { query: optionalAgencyIdQuerySchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ data: z.array(connectionDocumentSchema) }),
        },
      },
      description: "Active WhatsApp connection state without Nango credentials",
    },
    400: { description: "Invalid agency identifier" },
    403: { description: "The actor cannot access messaging integrations" },
  },
});

const connectSessionRoute = createRoute({
  method: "post",
  path: "/v1/whatsapp/connections/connect-session",
  tags: ["WhatsApp"],
  summary: "Create a short-lived Nango Connect session for WhatsApp",
  description:
    "Creates a session scoped to the authenticated user for the WhatsApp integration. The result is not a messaging credential.",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    body: {
      content: { "application/json": { schema: optionalAgencyIdBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ data: connectSessionSchema }),
        },
      },
      description: "Short-lived Connect session",
    },
    403: { description: "An active tenant membership is required" },
    503: { description: "WhatsApp messaging is not configured" },
  },
});

const reconnectSessionRoute = createRoute({
  method: "post",
  path: "/v1/whatsapp/connections/reconnect-session",
  tags: ["WhatsApp"],
  summary: "Create a reconnect session for the WhatsApp connection",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    body: {
      content: { "application/json": { schema: optionalAgencyIdBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ data: connectSessionSchema }),
        },
      },
      description: "Short-lived reconnect session",
    },
    403: { description: "An active tenant membership is required" },
    404: { description: "WhatsApp connection not found" },
    503: { description: "WhatsApp messaging is not configured" },
  },
});

const completeConnectionRoute = createRoute({
  method: "post",
  path: "/v1/whatsapp/connections/complete",
  tags: ["WhatsApp"],
  summary: "Verify and persist a completed WhatsApp connection",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    body: {
      content: { "application/json": { schema: completeBodySchema } },
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
      description: "Validated user-owned WhatsApp connection",
    },
    400: {
      description: "Nango connection does not match the WhatsApp integration",
    },
    403: { description: "An active tenant membership is required" },
    404: { description: "WhatsApp connection not found" },
    409: { description: "The organization already has a WhatsApp connection" },
    503: { description: "WhatsApp messaging is not configured" },
  },
});

const disconnectConnectionRoute = createRoute({
  method: "delete",
  path: "/v1/whatsapp/connections",
  tags: ["WhatsApp"],
  summary: "Disconnect WhatsApp messaging",
  security: [{ oauth2: ["savia.api.write"] }],
  request: { query: optionalAgencyIdQuerySchema },
  responses: {
    204: { description: "Connection disconnected" },
    403: { description: "An active tenant membership is required" },
    404: { description: "WhatsApp connection not found" },
    503: { description: "WhatsApp messaging is not configured" },
  },
});

const numberRoute = createRoute({
  method: "post",
  path: "/v1/whatsapp/connections/number",
  tags: ["WhatsApp"],
  summary: "Link a WhatsApp phone number to the connection",
  description:
    "Validates the phone number through Nango against the WhatsApp Cloud API and stores it without exposing Nango credentials.",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    body: {
      content: { "application/json": { schema: numberBodySchema } },
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
      description: "Connection with the linked phone number",
    },
    400: { description: "Invalid phone number input" },
    403: { description: "An active tenant membership is required" },
    404: { description: "WhatsApp connection not found" },
    409: { description: "The WhatsApp connection requires reconnection" },
    503: { description: "WhatsApp messaging is not configured" },
  },
});

const testSendRoute = createRoute({
  method: "post",
  path: "/v1/whatsapp/connections/test-send",
  tags: ["WhatsApp"],
  summary: "Send a test message through the WhatsApp connection",
  description:
    "Sends a short free-form text message through Nango to the WhatsApp Cloud API. Only works inside an open 24-hour customer-service window.",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    body: {
      content: { "application/json": { schema: testSendBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ data: z.object({ messageId: z.string() }) }),
        },
      },
      description: "Test message accepted by the WhatsApp API",
    },
    400: { description: "Invalid test message input" },
    403: { description: "An active tenant membership is required" },
    404: { description: "WhatsApp connection not found" },
    409: { description: "The WhatsApp connection requires reconnection" },
    422: { description: "The WhatsApp number is not linked yet" },
    503: { description: "WhatsApp messaging is not configured" },
  },
});

function connectionDocument(connection: WhatsappConnection) {
  return {
    id: connection.id,
    kind: "whatsapp-connection" as const,
    attributes: {
      agencyId: connection.agencyId,
      provider: connection.provider,
      status: connection.status,
      phoneNumberId: connection.phoneNumberId,
      displayPhoneNumber: connection.displayPhoneNumber,
      wabaId: connection.wabaId,
      externalAccountLabel: connection.externalAccountLabel,
      lastValidatedAt: connection.lastValidatedAt,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    },
  };
}

function providerDocument(provider: WhatsappProviderDefinition) {
  return {
    id: provider.id,
    kind: "whatsapp-provider" as const,
    attributes: {
      displayName: provider.displayName,
      availability: provider.availability,
      capabilities: [...provider.capabilities],
    },
  };
}

function canReadAgency(
  actor: ReturnType<typeof actorFromContext>,
  agencyId: number,
) {
  return authorizedAgencyIds(actor).includes(agencyId);
}

function resolveWritableAgencyId(
  actor: ReturnType<typeof actorFromContext>,
  agencyId?: number,
): number | undefined {
  if (agencyId === undefined) return undefined;
  return canReadAgency(actor, agencyId) ? agencyId : undefined;
}

function membershipRequiredResponse() {
  return {
    error: {
      code: "AUTHORIZATION_FORBIDDEN",
      message:
        "Selecciona un tenant explícito y asegúrate de tener una membresía activa para usar WhatsApp.",
    },
  };
}

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

function whatsappErrorResponse(exception: unknown) {
  if (
    exception instanceof WhatsappOrganizationConnectionExistsError ||
    exception instanceof WhatsappConnectionAlreadyAssignedError
  )
    return {
      status: 409,
      body: errorBody(exception.code, exception.message),
    } as const;
  if (exception instanceof WhatsappUnavailableError)
    return {
      status: 503,
      body: errorBody(exception.code, exception.message),
    } as const;
  if (exception instanceof WhatsappUpstreamError) {
    if (exception.code === "RECONNECT_REQUIRED")
      return {
        status: 409,
        body: errorBody(
          "WHATSAPP_RECONNECT_REQUIRED",
          "The WhatsApp connection requires reconnection",
        ),
      } as const;
    return {
      status: 502,
      body: errorBody(exception.code, exception.message),
    } as const;
  }
  if (exception instanceof WhatsappConnectionNotFoundError)
    return {
      status: 404,
      body: errorBody(exception.code, exception.message),
    } as const;
  if (exception instanceof WhatsappConnectionAccessError)
    return {
      status: 403,
      body: errorBody(exception.code, exception.message),
    } as const;
  return undefined;
}

type GraphPhoneDetails = {
  display_phone_number?: unknown;
  verified_name?: unknown;
  code_verification_status?: unknown;
};

async function validatePhoneNumber(
  dependencies: WhatsappRouteDependencies,
  connection: ActiveWhatsappConnection,
  phoneNumberId: string,
): Promise<GraphPhoneDetails | undefined> {
  const response = await dependencies.nango.proxy({
    method: "GET",
    path: `/v21.0/${phoneNumberId}`,
    connection,
  });
  if (response.status === 401 || response.status === 403) {
    throw new WhatsappUpstreamError(
      "RECONNECT_REQUIRED",
      "The WhatsApp connection requires reconnection",
      response.status,
    );
  }
  if (!response.ok) throw new WhatsappUpstreamError();
  const payload = (await response.json().catch(() => undefined)) as
    GraphPhoneDetails | undefined;
  return payload ?? undefined;
}

export function registerWhatsappRoutes(
  app: OpenAPIHono,
  db: D1Database,
  dependencies?: WhatsappRouteDependencies,
): void {
  const repository = createWhatsappRepository(db);
  const provider =
    dependencies?.provider ??
    createWhatsappProviderRegistry(
      whatsappNangoConfigurationFromEnvironment({}),
    );

  app.openapi(providerRoute, async (context) => {
    const actor = actorFromContext(context);
    const { agencyId } = context.req.valid("query");
    if (agencyId !== undefined && !canReadAgency(actor, agencyId))
      return context.json(
        errorBody(
          "AUTHORIZATION_FORBIDDEN",
          "The actor cannot access this agency",
        ),
        403,
      );
    return context.json({ data: [providerDocument(provider)] }, 200);
  });

  app.openapi(connectionListRoute, async (context) => {
    const actor = actorFromContext(context);
    const { agencyId } = context.req.valid("query");
    if (agencyId !== undefined) {
      if (!canReadAgency(actor, agencyId))
        return context.json(
          errorBody(
            "AUTHORIZATION_FORBIDDEN",
            "The actor cannot access this agency",
          ),
          403,
        );
      const connections = await repository.listConnections(
        agencyId,
        actor.principal.id,
      );
      return context.json({ data: connections.map(connectionDocument) }, 200);
    }
    const selectedAgencyId =
      agencyId === undefined
        ? authorizedAgencyIds(actor)[0]
        : resolveWritableAgencyId(actor, agencyId);
    if (selectedAgencyId === undefined) return context.json({ data: [] }, 200);
    const connections = await repository.listConnections(
      selectedAgencyId,
      actor.principal.id,
    );
    return context.json({ data: connections.map(connectionDocument) }, 200);
  });

  app.openapi(connectSessionRoute, async (context) => {
    const actor = actorFromContext(context);
    const { agencyId: requestedAgencyId } = context.req.valid("json");
    const agencyId = resolveWritableAgencyId(actor, requestedAgencyId);
    if (agencyId === undefined)
      return context.json(membershipRequiredResponse(), 403);
    if (provider.availability !== "enabled" || !dependencies)
      return context.json(
        errorBody(
          "WHATSAPP_UNAVAILABLE",
          "WhatsApp messaging is not configured",
        ),
        503,
      );
    try {
      const session = await dependencies.nango.createConnectSession({
        actor,
        agencyId,
      });
      return context.json({ data: session }, 200);
    } catch (exception) {
      const response = whatsappErrorResponse(exception);
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(reconnectSessionRoute, async (context) => {
    const actor = actorFromContext(context);
    const { agencyId: requestedAgencyId } = context.req.valid("json");
    const agencyId = resolveWritableAgencyId(actor, requestedAgencyId);
    if (agencyId === undefined)
      return context.json(membershipRequiredResponse(), 403);
    const existing = await repository.findActiveConnection(
      agencyId,
      actor.principal.id,
    );
    if (!existing)
      return context.json(
        errorBody(
          "WHATSAPP_CONNECTION_NOT_FOUND",
          "WhatsApp connection not found",
        ),
        404,
      );
    if (provider.availability !== "enabled" || !dependencies)
      return context.json(
        errorBody(
          "WHATSAPP_UNAVAILABLE",
          "WhatsApp messaging is not configured",
        ),
        503,
      );
    try {
      const session = await dependencies.nango.createReconnectSession({
        connectionId: existing.nangoConnectionId,
        integrationId: existing.nangoIntegrationId,
      });
      return context.json({ data: session }, 200);
    } catch (exception) {
      const response = whatsappErrorResponse(exception);
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(completeConnectionRoute, async (context) => {
    const actor = actorFromContext(context);
    const {
      agencyId: requestedAgencyId,
      connectionId,
      phoneNumberId,
      displayPhoneNumber,
      wabaId,
    } = context.req.valid("json");
    const agencyId = resolveWritableAgencyId(actor, requestedAgencyId);
    if (agencyId === undefined)
      return context.json(membershipRequiredResponse(), 403);
    if (
      provider.availability !== "enabled" ||
      !dependencies?.provider.integrationId
    )
      return context.json(
        errorBody(
          "WHATSAPP_UNAVAILABLE",
          "WhatsApp messaging is not configured",
        ),
        503,
      );
    if (!dependencies)
      return context.json(
        errorBody(
          "WHATSAPP_UNAVAILABLE",
          "WhatsApp messaging is not configured",
        ),
        503,
      );
    let integrationId: string | undefined;
    try {
      integrationId = whatsappIntegrationIdFor(
        whatsappNangoConfigurationFromEnvironment({
          NANGO_WHATSAPP_INTEGRATION_ID: dependencies.provider.integrationId,
        }),
      );
      const summary = await dependencies.nango.getConnection(
        connectionId,
        integrationId,
      );
      if (
        summary.connectionId !== connectionId ||
        summary.providerConfigKey !== integrationId
      )
        return context.json(
          errorBody(
            "WHATSAPP_CONNECTION_MISMATCH",
            "The Nango connection does not match the WhatsApp integration",
          ),
          400,
        );
      if (summary.organizationId !== `user:${actor.principal.id}`)
        return context.json(
          errorBody(
            "WHATSAPP_CONNECTION_ACCESS_DENIED",
            "The Nango connection does not belong to this user",
          ),
          403,
        );
      if (summary.agencyId !== agencyId)
        return context.json(
          errorBody(
            "WHATSAPP_CONNECTION_ACCESS_DENIED",
            "The Nango connection is not scoped to the selected tenant",
          ),
          403,
        );
      const metadataPhoneNumberId =
        typeof summary.metadata.phone_number_id === "string"
          ? summary.metadata.phone_number_id
          : undefined;
      const resolvedPhoneNumberId = phoneNumberId ?? metadataPhoneNumberId;
      let label: string | null =
        typeof summary.metadata.business_name === "string"
          ? summary.metadata.business_name
          : typeof summary.metadata.account_name === "string"
            ? summary.metadata.account_name
            : null;
      let resolvedDisplayPhoneNumber =
        displayPhoneNumber ??
        (typeof summary.metadata.display_phone_number === "string"
          ? summary.metadata.display_phone_number
          : null);
      let resolvedWabaId =
        wabaId ??
        (typeof summary.metadata.waba_id === "string"
          ? summary.metadata.waba_id
          : null);
      if (resolvedPhoneNumberId) {
        const candidate: ActiveWhatsappConnection = {
          id: "unpersisted-connection",
          agencyId,
          tenantId: agencyId,
          provider: "whatsapp",
          status: "pending",
          phoneNumberId: resolvedPhoneNumberId,
          displayPhoneNumber: resolvedDisplayPhoneNumber,
          wabaId: resolvedWabaId,
          externalAccountLabel: label,
          lastValidatedAt: null,
          createdAt: "",
          updatedAt: "",
          nangoConnectionId: connectionId,
          nangoIntegrationId: integrationId,
        };
        const details = await validatePhoneNumber(
          dependencies,
          candidate,
          resolvedPhoneNumberId,
        );
        if (
          typeof details?.display_phone_number === "string" &&
          !resolvedDisplayPhoneNumber
        )
          resolvedDisplayPhoneNumber = details.display_phone_number;
        if (typeof details?.verified_name === "string" && !label)
          label = details.verified_name;
      }
      const connection = await repository.saveConnection({
        agencyId,
        actor,
        nangoConnectionId: connectionId,
        nangoIntegrationId: integrationId,
        status: "connected",
        phoneNumberId: resolvedPhoneNumberId ?? null,
        displayPhoneNumber: resolvedDisplayPhoneNumber,
        wabaId: resolvedWabaId,
        externalAccountLabel: label,
        lastValidatedAt: new Date().toISOString(),
      });
      return context.json({ data: connectionDocument(connection) }, 200);
    } catch (exception) {
      if (
        exception instanceof WhatsappUpstreamError &&
        exception.code === "RECONNECT_REQUIRED" &&
        integrationId
      ) {
        const existing = await repository.findActiveConnection(
          agencyId,
          actor.principal.id,
        );
        if (
          existing?.nangoConnectionId === connectionId &&
          existing.nangoIntegrationId === integrationId
        )
          await repository.markReconnectRequired(
            existing.id,
            actor.principal.id,
          );
      }
      const response = whatsappErrorResponse(exception);
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(disconnectConnectionRoute, async (context) => {
    const actor = actorFromContext(context);
    const { agencyId: requestedAgencyId } = context.req.valid("query");
    const agencyId = resolveWritableAgencyId(actor, requestedAgencyId);
    if (agencyId === undefined || !canReadAgency(actor, agencyId))
      return context.json(membershipRequiredResponse(), 403);
    const connection = await repository.findActiveConnection(
      agencyId,
      actor.principal.id,
    );
    if (provider.availability !== "enabled" || !dependencies)
      return context.json(
        errorBody(
          "WHATSAPP_UNAVAILABLE",
          "WhatsApp messaging is not configured",
        ),
        503,
      );
    if (!connection)
      return context.json(
        errorBody(
          "WHATSAPP_CONNECTION_NOT_FOUND",
          "WhatsApp connection not found",
        ),
        404,
      );
    try {
      await dependencies.nango.deleteConnection(
        connection.nangoConnectionId,
        connection.nangoIntegrationId,
      );
      await repository.markDisconnected(agencyId, actor.principal.id);
      return new Response(null, { status: 204 });
    } catch (exception) {
      const response = whatsappErrorResponse(exception);
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(numberRoute, async (context) => {
    const actor = actorFromContext(context);
    const {
      agencyId: requestedAgencyId,
      phoneNumberId,
      displayPhoneNumber,
      wabaId,
    } = context.req.valid("json");
    const agencyId = resolveWritableAgencyId(actor, requestedAgencyId);
    if (agencyId === undefined)
      return context.json(membershipRequiredResponse(), 403);
    if (provider.availability !== "enabled" || !dependencies)
      return context.json(
        errorBody(
          "WHATSAPP_UNAVAILABLE",
          "WhatsApp messaging is not configured",
        ),
        503,
      );
    const connection = await repository.findActiveConnection(
      agencyId,
      actor.principal.id,
    );
    if (!connection)
      return context.json(
        errorBody(
          "WHATSAPP_CONNECTION_NOT_FOUND",
          "WhatsApp connection not found",
        ),
        404,
      );
    if (connection.status === "reconnect_required")
      return context.json(
        errorBody(
          "WHATSAPP_RECONNECT_REQUIRED",
          "The WhatsApp connection requires reconnection",
        ),
        409,
      );
    if (connection.status !== "connected")
      return context.json(
        errorBody(
          "WHATSAPP_CONNECTION_NOT_READY",
          "The WhatsApp connection is not ready",
        ),
        409,
      );
    try {
      const details = await validatePhoneNumber(
        dependencies,
        { ...connection, phoneNumberId },
        phoneNumberId,
      );
      const label =
        typeof details?.verified_name === "string"
          ? details.verified_name
          : connection.externalAccountLabel;
      const display =
        displayPhoneNumber ??
        (typeof details?.display_phone_number === "string"
          ? details.display_phone_number
          : connection.displayPhoneNumber);
      const updated = await repository.updateNumber({
        agencyId,
        principalId: actor.principal.id,
        phoneNumberId,
        displayPhoneNumber: display,
        wabaId: wabaId ?? connection.wabaId,
        externalAccountLabel: label,
        lastValidatedAt: new Date().toISOString(),
      });
      if (!updated)
        return context.json(
          errorBody(
            "WHATSAPP_CONNECTION_NOT_FOUND",
            "WhatsApp connection not found",
          ),
          404,
        );
      return context.json({ data: connectionDocument(updated) }, 200);
    } catch (exception) {
      if (
        exception instanceof WhatsappUpstreamError &&
        exception.code === "RECONNECT_REQUIRED"
      )
        await repository.markReconnectRequired(
          connection.id,
          actor.principal.id,
        );
      const response = whatsappErrorResponse(exception);
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(testSendRoute, async (context) => {
    const actor = actorFromContext(context);
    const { agencyId, to, text } = context.req.valid("json");
    if (!canReadAgency(actor, agencyId))
      return context.json(
        errorBody(
          "AUTHORIZATION_FORBIDDEN",
          "The actor cannot access this agency",
        ),
        403,
      );
    if (provider.availability !== "enabled" || !dependencies)
      return context.json(
        errorBody(
          "WHATSAPP_UNAVAILABLE",
          "WhatsApp messaging is not configured",
        ),
        503,
      );
    const connection = await repository.findActiveConnection(
      agencyId,
      actor.principal.id,
    );
    if (!connection)
      return context.json(
        errorBody(
          "WHATSAPP_CONNECTION_NOT_FOUND",
          "WhatsApp connection not found",
        ),
        404,
      );
    if (connection.status === "reconnect_required")
      return context.json(
        errorBody(
          "WHATSAPP_RECONNECT_REQUIRED",
          "The WhatsApp connection requires reconnection",
        ),
        409,
      );
    if (connection.status !== "connected")
      return context.json(
        errorBody(
          "WHATSAPP_CONNECTION_NOT_READY",
          "The WhatsApp connection is not ready",
        ),
        409,
      );
    if (!connection.phoneNumberId)
      return context.json(
        errorBody(
          "WHATSAPP_NUMBER_NOT_LINKED",
          "Link a WhatsApp phone number before sending messages",
        ),
        422,
      );
    try {
      const response = await dependencies.nango.proxy({
        method: "POST",
        path: `/v21.0/${connection.phoneNumberId}/messages`,
        connection,
        body: {
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: text, preview_url: false },
        },
      });
      if (response.status === 401 || response.status === 403) {
        await repository.markReconnectRequired(
          connection.id,
          actor.principal.id,
        );
        return context.json(
          errorBody(
            "WHATSAPP_RECONNECT_REQUIRED",
            "The WhatsApp connection requires reconnection",
          ),
          409,
        );
      }
      if (!response.ok)
        return context.json(
          errorBody(
            "WHATSAPP_SEND_FAILED",
            "The WhatsApp message was not accepted",
          ),
          502,
        );
      const payload = (await response.json().catch(() => undefined)) as
        { messages?: Array<{ id?: unknown }> } | undefined;
      const messageId = payload?.messages?.[0]?.id;
      if (typeof messageId !== "string")
        return context.json(
          errorBody(
            "WHATSAPP_SEND_FAILED",
            "The WhatsApp message was not accepted",
          ),
          502,
        );
      return context.json({ data: { messageId } }, 200);
    } catch (exception) {
      const response = whatsappErrorResponse(exception);
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });
}
