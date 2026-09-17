import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { authorizedAgencyIds, canManageIdentity } from "../auth/access-policy";
import { actorFromContext } from "../auth/middleware";
import type {
  CrmConnection,
  CrmProviderAdapter,
  CrmProviderDefinition,
  CrmProviderId,
  CrmRepository,
  NangoClient,
} from "../crm/contracts";
import {
  CrmConnectionAccessError,
  CrmConnectionNotFoundError,
  CrmUnavailableError,
  CrmUpstreamError,
  isCrmProviderId,
} from "../crm/contracts";
import { createCrmProviderRegistry } from "../crm/providers";
import { createCrmRepository } from "../crm/repository";

export type CrmRouteDependencies = {
  nango: NangoClient;
  providers: Record<CrmProviderId, CrmProviderDefinition>;
  adapters: Partial<Record<CrmProviderId, CrmProviderAdapter>>;
};

const agencyIdSchema = z.coerce.number().int().positive();
const optionalAgencyIdQuerySchema = z.object({
  agencyId: agencyIdSchema.optional(),
});
const optionalAgencyIdBodySchema = z.object({
  agencyId: agencyIdSchema.optional(),
});
const optionalAgencyIdCompleteBodySchema = z.object({
  agencyId: agencyIdSchema.optional(),
  connectionId: z.string().trim().min(1).max(255),
});
const providerParamSchema = z.object({
  provider: z.string().trim().min(1).max(32),
});
const connectionAttributesSchema = z.object({
  agencyId: z.number().int().positive(),
  provider: z.enum(["hubspot", "salesforce", "zoho", "pipedrive"]),
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
  kind: z.literal("crm-connection"),
  attributes: connectionAttributesSchema,
});
const providerDocumentSchema = z.object({
  id: z.enum(["hubspot", "salesforce", "zoho", "pipedrive"]),
  kind: z.literal("crm-provider"),
  attributes: z.object({
    displayName: z.string(),
    availability: z.enum(["enabled", "unavailable", "coming_soon"]),
    capabilities: z.array(z.string()),
  }),
});
const connectSessionSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  connectUrl: z.string().url(),
  apiUrl: z.string().url(),
});
const contactSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  companyId: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
const companySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  domain: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
const dealSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  amount: z.string().nullable(),
  stage: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
const operationListQuerySchema = z.object({
  agencyId: agencyIdSchema,
  provider: z.string().trim().min(1).max(32),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).max(200).optional(),
});
const contactWriteFields = {
  email: z.string().trim().email().max(254).optional(),
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  companyId: z.string().trim().min(1).max(255).optional(),
};
const contactWriteBodySchema = z
  .object({
    agencyId: agencyIdSchema,
    provider: z.string().trim().min(1).max(32),
    ...contactWriteFields,
  })
  .strict()
  .refine(
    (value) =>
      value.email !== undefined ||
      value.firstName !== undefined ||
      value.lastName !== undefined ||
      value.companyId !== undefined,
    "At least one contact field is required",
  );

const providerListRoute = createRoute({
  method: "get",
  path: "/v1/crm/providers",
  tags: ["CRM connections"],
  summary: "List CRM providers available to the authenticated user",
  description:
    "Lists Savia's provider registry. Provider credentials and Nango integration configuration are never returned.",
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
    403: { description: "The actor cannot access CRM integrations" },
  },
});

const connectionListRoute = createRoute({
  method: "get",
  path: "/v1/crm/connections",
  tags: ["CRM connections"],
  summary: "List the current user’s active CRM connections",
  security: [{ oauth2: ["savia.api.read"] }],
  request: { query: optionalAgencyIdQuerySchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ data: z.array(connectionDocumentSchema) }),
        },
      },
      description: "Active CRM connection state without Nango credentials",
    },
    400: { description: "Invalid agency identifier" },
    403: { description: "The actor cannot access CRM integrations" },
  },
});

const connectSessionRoute = createRoute({
  method: "post",
  path: "/v1/crm/connections/{provider}/connect-session",
  tags: ["CRM connections"],
  summary: "Create a short-lived Nango Connect session",
  description:
    "Creates a session scoped to the authenticated user and one enabled provider. The result is not a CRM credential.",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    params: providerParamSchema,
    body: {
      content: {
        "application/json": { schema: optionalAgencyIdBodySchema },
      },
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
    400: { description: "Invalid request or Nango connection identity" },
    403: { description: "An active tenant membership is required" },
    404: { description: "Provider is unknown" },
    424: { description: "Provider is not available yet" },
    503: { description: "Provider is not configured" },
  },
});

const completeConnectionRoute = createRoute({
  method: "post",
  path: "/v1/crm/connections/{provider}/complete",
  tags: ["CRM connections"],
  summary: "Verify and persist a completed CRM connection",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    params: providerParamSchema,
    body: {
      content: {
        "application/json": {
          schema: optionalAgencyIdCompleteBodySchema,
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
      description: "Validated user-owned CRM connection",
    },
    400: {
      description: "Nango connection does not match the requested provider",
    },
    403: { description: "An active tenant membership is required" },
    404: { description: "Provider is unknown" },
    424: { description: "Provider is not available yet" },
    503: { description: "Provider is not configured" },
  },
});

const reconnectSessionRoute = createRoute({
  method: "post",
  path: "/v1/crm/connections/{provider}/reconnect-session",
  tags: ["CRM connections"],
  summary: "Create a reconnect session for an existing CRM connection",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    params: providerParamSchema,
    body: {
      content: {
        "application/json": { schema: optionalAgencyIdBodySchema },
      },
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
    404: { description: "Provider or connection is not found" },
    424: { description: "Provider is not available yet" },
    503: { description: "Provider is not configured" },
  },
});

const disconnectConnectionRoute = createRoute({
  method: "delete",
  path: "/v1/crm/connections/{provider}",
  tags: ["CRM connections"],
  summary: "Disconnect a user CRM provider",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    params: providerParamSchema,
    query: optionalAgencyIdQuerySchema,
  },
  responses: {
    204: { description: "Connection disconnected" },
    403: { description: "An active tenant membership is required" },
    404: { description: "Provider or connection is not found" },
    424: { description: "Provider is not available yet" },
    503: { description: "Provider is not configured" },
  },
});

const contactListRoute = createRoute({
  method: "get",
  path: "/v1/crm/contacts",
  tags: ["CRM operations"],
  summary: "List normalized CRM contacts",
  description:
    "Reads contacts through the selected agency connection. Savia does not accept an arbitrary CRM path or request headers.",
  security: [{ oauth2: ["savia.api.read"] }],
  request: { query: operationListQuerySchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ data: z.array(contactSchema) }),
        },
      },
      description: "Normalized contacts",
    },
    400: { description: "Invalid list query" },
    403: { description: "No active membership for the agency" },
    409: { description: "The CRM connection requires reconnection" },
    424: { description: "Provider is not available yet" },
  },
});

const contactCreateRoute = createRoute({
  method: "post",
  path: "/v1/crm/contacts",
  tags: ["CRM operations"],
  summary: "Create a normalized CRM contact",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    body: {
      content: { "application/json": { schema: contactWriteBodySchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: {
        "application/json": { schema: z.object({ data: contactSchema }) },
      },
      description: "Created normalized contact",
    },
    400: { description: "Invalid contact input" },
    403: { description: "No active membership for the agency" },
    409: { description: "The CRM connection requires reconnection" },
    424: { description: "Provider is not available yet" },
  },
});

const contactUpdateRoute = createRoute({
  method: "patch",
  path: "/v1/crm/contacts/{contactId}",
  tags: ["CRM operations"],
  summary: "Update a normalized CRM contact",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    params: z.object({ contactId: z.string().trim().min(1).max(255) }),
    body: {
      content: { "application/json": { schema: contactWriteBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ data: contactSchema }) },
      },
      description: "Updated normalized contact",
    },
    400: { description: "Invalid contact input" },
    403: { description: "No active membership for the agency" },
    409: { description: "The CRM connection requires reconnection" },
    424: { description: "Provider is not available yet" },
  },
});

const companyListRoute = createRoute({
  method: "get",
  path: "/v1/crm/companies",
  tags: ["CRM operations"],
  summary: "List normalized CRM companies",
  security: [{ oauth2: ["savia.api.read"] }],
  request: { query: operationListQuerySchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ data: z.array(companySchema) }),
        },
      },
      description: "Normalized companies",
    },
    400: { description: "Invalid list query" },
    403: { description: "No active membership for the agency" },
    409: { description: "The CRM connection requires reconnection" },
    424: { description: "Provider is not available yet" },
  },
});

const dealListRoute = createRoute({
  method: "get",
  path: "/v1/crm/deals",
  tags: ["CRM operations"],
  summary: "List normalized CRM deals",
  security: [{ oauth2: ["savia.api.read"] }],
  request: { query: operationListQuerySchema },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ data: z.array(dealSchema) }) },
      },
      description: "Normalized deals",
    },
    400: { description: "Invalid list query" },
    403: { description: "No active membership for the agency" },
    409: { description: "The CRM connection requires reconnection" },
    424: { description: "Provider is not available yet" },
  },
});

function connectionDocument(connection: CrmConnection) {
  return {
    id: connection.id,
    kind: "crm-connection" as const,
    attributes: {
      agencyId: connection.agencyId,
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

function providerDocument(provider: CrmProviderDefinition) {
  return {
    id: provider.id,
    kind: "crm-provider" as const,
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

function canManageCrm(
  actor: ReturnType<typeof actorFromContext>,
  agencyId: number,
) {
  return canReadAgency(actor, agencyId);
}

function canManageUserOwnedCrm(
  actor: ReturnType<typeof actorFromContext>,
  tenantId?: number,
) {
  if (canManageIdentity(actor)) return true;
  if (tenantId !== undefined) return canReadAgency(actor, tenantId);
  return authorizedAgencyIds(actor).length > 0;
}

async function resolveWritableAgencyId(
  repository: CrmRepository,
  actor: ReturnType<typeof actorFromContext>,
  agencyId?: number,
): Promise<number | undefined> {
  if (agencyId !== undefined) {
    return canReadAgency(actor, agencyId) ? agencyId : undefined;
  }
  const authorized = authorizedAgencyIds(actor);
  if (authorized.length > 0) return authorized[0];
  if (canManageIdentity(actor)) return repository.resolveDefaultTenantId();
  return undefined;
}

function membershipRequiredResponse() {
  return errorBody(
    "AUTHORIZATION_FORBIDDEN",
    "Necesitas una membresía activa en un tenant para conectar un CRM.",
  );
}

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

function providerStatus(
  provider: CrmProviderDefinition,
): 424 | 503 | undefined {
  if (provider.availability === "coming_soon") return 424;
  if (provider.availability === "unavailable") return 503;
  return undefined;
}

export function crmErrorResponse(exception: unknown) {
  if (exception instanceof CrmUnavailableError)
    return {
      status: 503,
      body: errorBody(exception.code, exception.message),
    } as const;
  if (exception instanceof CrmUpstreamError)
    return {
      status: 502,
      body: errorBody(exception.code, exception.message),
    } as const;
  if (exception instanceof CrmConnectionNotFoundError)
    return {
      status: 404,
      body: errorBody(exception.code, exception.message),
    } as const;
  if (exception instanceof CrmConnectionAccessError)
    return {
      status: 403,
      body: errorBody(exception.code, exception.message),
    } as const;
  return undefined;
}

type CrmOperationResolution =
  | {
      connection: NonNullable<
        Awaited<ReturnType<CrmRepository["findActiveConnection"]>>
      >;
      adapter: CrmProviderAdapter;
    }
  | { status: 403 | 404 | 409 | 424 | 503; body: ReturnType<typeof errorBody> };

function operationError(
  status: 403 | 404 | 409 | 424 | 503,
  code: string,
  message: string,
): CrmOperationResolution {
  return { status, body: errorBody(code, message) };
}

async function resolveCrmOperation(
  repository: CrmRepository,
  dependencies: CrmRouteDependencies | undefined,
  providers: Record<CrmProviderId, CrmProviderDefinition>,
  actor: ReturnType<typeof actorFromContext>,
  agencyId: number,
  requestedProvider: string,
): Promise<CrmOperationResolution> {
  if (!canReadAgency(actor, agencyId))
    return operationError(
      403,
      "AUTHORIZATION_FORBIDDEN",
      "The actor cannot access this agency",
    );
  if (!isCrmProviderId(requestedProvider))
    return operationError(
      404,
      "CRM_PROVIDER_NOT_FOUND",
      "CRM provider not found",
    );
  const provider = providers[requestedProvider];
  const status = providerStatus(provider);
  if (status)
    return operationError(
      status,
      status === 424 ? "CRM_PROVIDER_COMING_SOON" : "CRM_PROVIDER_UNAVAILABLE",
      status === 424
        ? "The requested CRM provider is not available yet"
        : "The requested CRM provider is unavailable",
    );
  const adapter = dependencies?.adapters[requestedProvider];
  if (!adapter)
    return operationError(
      503,
      "CRM_PROVIDER_UNAVAILABLE",
      "The requested CRM provider is unavailable",
    );
  const connection = await repository.findActiveConnection(
    agencyId,
    requestedProvider,
    actor.principal.id,
  );
  if (!connection)
    return operationError(
      404,
      "CRM_CONNECTION_NOT_FOUND",
      "CRM connection not found",
    );
  if (connection.status === "reconnect_required")
    return operationError(
      409,
      "CRM_RECONNECT_REQUIRED",
      "The CRM connection requires reconnection",
    );
  if (connection.status !== "connected")
    return operationError(
      409,
      "CRM_CONNECTION_NOT_READY",
      "The CRM connection is not ready",
    );
  return { connection, adapter };
}

function isOperationError(
  resolution: CrmOperationResolution,
): resolution is Extract<CrmOperationResolution, { status: number }> {
  return "status" in resolution;
}

async function crmOperationErrorResponse(
  exception: unknown,
  repository: CrmRepository,
  connection: NonNullable<
    Awaited<ReturnType<CrmRepository["findActiveConnection"]>>
  >,
  actor: ReturnType<typeof actorFromContext>,
) {
  if (
    exception instanceof CrmUpstreamError &&
    exception.code === "RECONNECT_REQUIRED"
  ) {
    await repository.markReconnectRequired(connection.id, actor.principal.id);
    await repository.appendAuditEvent({
      connectionId: connection.id,
      agencyId: connection.agencyId,
      principalId: actor.principal.id,
      provider: connection.provider,
      eventType: "operation_reconnect_required",
      outcome: "failure",
      errorCode: exception.code,
    });
    return {
      status: 409,
      body: errorBody(
        "CRM_RECONNECT_REQUIRED",
        "The CRM connection requires reconnection",
      ),
    } as const;
  }
  return crmErrorResponse(exception);
}

export function registerCrmRoutes(
  app: OpenAPIHono,
  db: D1Database,
  dependencies?: CrmRouteDependencies,
): void {
  const repository = createCrmRepository(db);
  const providers = dependencies?.providers ?? createCrmProviderRegistry({});

  app.openapi(providerListRoute, async (context) => {
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
    return context.json(
      { data: Object.values(providers).map(providerDocument) },
      200,
    );
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
    const connections = await repository.listConnectionsForPrincipal(
      actor.principal.id,
    );
    return context.json({ data: connections.map(connectionDocument) }, 200);
  });

  app.openapi(connectSessionRoute, async (context) => {
    const actor = actorFromContext(context);
    const { agencyId: requestedAgencyId } = context.req.valid("json");
    const requestedProvider = context.req.valid("param").provider;
    const agencyId = await resolveWritableAgencyId(
      repository,
      actor,
      requestedAgencyId,
    );
    if (agencyId === undefined)
      return context.json(membershipRequiredResponse(), 403);
    if (!isCrmProviderId(requestedProvider))
      return context.json(
        errorBody("CRM_PROVIDER_NOT_FOUND", "CRM provider not found"),
        404,
      );
    const provider = providers[requestedProvider];
    const status = providerStatus(provider);
    if (status)
      return context.json(
        errorBody(
          status === 424
            ? "CRM_PROVIDER_COMING_SOON"
            : "CRM_PROVIDER_UNAVAILABLE",
          status === 424
            ? "The requested CRM provider is not available yet"
            : "The requested CRM provider is unavailable",
        ),
        status,
      );
    if (!dependencies)
      return context.json(
        errorBody(
          "CRM_PROVIDER_UNAVAILABLE",
          "The requested CRM provider is unavailable",
        ),
        503,
      );
    try {
      const session = await dependencies.nango.createConnectSession({
        actor,
        agencyId,
        provider: requestedProvider,
      });
      return context.json({ data: session }, 200);
    } catch (exception) {
      const response = crmErrorResponse(exception);
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(reconnectSessionRoute, async (context) => {
    const actor = actorFromContext(context);
    const { agencyId: requestedAgencyId } = context.req.valid("json");
    const requestedProvider = context.req.valid("param").provider;
    if (!isCrmProviderId(requestedProvider))
      return context.json(
        errorBody("CRM_PROVIDER_NOT_FOUND", "CRM provider not found"),
        404,
      );
    const existing =
      requestedAgencyId === undefined
        ? await repository.findActiveConnectionForPrincipal(
            requestedProvider,
            actor.principal.id,
          )
        : await repository.findActiveConnection(
            requestedAgencyId,
            requestedProvider,
            actor.principal.id,
          );
    const agencyId =
      existing?.agencyId ??
      (await resolveWritableAgencyId(
        repository,
        actor,
        requestedAgencyId,
      ));
    if (agencyId === undefined)
      return context.json(membershipRequiredResponse(), 403);
    if (!existing)
      return context.json(
        errorBody("CRM_CONNECTION_NOT_FOUND", "CRM connection not found"),
        404,
      );
    const provider = providers[requestedProvider];
    const status = providerStatus(provider);
    if (status)
      return context.json(
        errorBody(
          status === 424
            ? "CRM_PROVIDER_COMING_SOON"
            : "CRM_PROVIDER_UNAVAILABLE",
          "The requested CRM provider is unavailable",
        ),
        status,
      );
    if (!dependencies)
      return context.json(
        errorBody(
          "CRM_PROVIDER_UNAVAILABLE",
          "The requested CRM provider is unavailable",
        ),
        503,
      );
    try {
      const session = await dependencies.nango.createConnectSession({
        actor,
        agencyId,
        provider: requestedProvider,
      });
      return context.json({ data: session }, 200);
    } catch (exception) {
      const response = crmErrorResponse(exception);
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(completeConnectionRoute, async (context) => {
    const actor = actorFromContext(context);
    const { agencyId: requestedAgencyId, connectionId } =
      context.req.valid("json");
    const requestedProvider = context.req.valid("param").provider;
    const existingForPrincipal = isCrmProviderId(requestedProvider)
      ? await repository.findActiveConnectionForPrincipal(
          requestedProvider,
          actor.principal.id,
        )
      : undefined;
    const agencyId =
      existingForPrincipal?.agencyId ??
      (await resolveWritableAgencyId(
        repository,
        actor,
        requestedAgencyId,
      ));
    if (agencyId === undefined)
      return context.json(membershipRequiredResponse(), 403);
    if (!isCrmProviderId(requestedProvider))
      return context.json(
        errorBody("CRM_PROVIDER_NOT_FOUND", "CRM provider not found"),
        404,
      );
    const provider = providers[requestedProvider];
    const status = providerStatus(provider);
    if (status)
      return context.json(
        errorBody(
          status === 424
            ? "CRM_PROVIDER_COMING_SOON"
            : "CRM_PROVIDER_UNAVAILABLE",
          "The requested CRM provider is unavailable",
        ),
        status,
      );
    if (!dependencies || !provider.integrationId)
      return context.json(
        errorBody(
          "CRM_PROVIDER_UNAVAILABLE",
          "The requested CRM provider is unavailable",
        ),
        503,
      );
    const adapter = dependencies.adapters[requestedProvider];
    if (!adapter)
      return context.json(
        errorBody(
          "CRM_PROVIDER_UNAVAILABLE",
          "The requested CRM provider is unavailable",
        ),
        503,
      );
    try {
      const summary = await dependencies.nango.getConnection(
        connectionId,
        provider.integrationId,
      );
      if (
        summary.connectionId !== connectionId ||
        summary.providerConfigKey !== provider.integrationId
      )
        return context.json(
          errorBody(
            "CRM_CONNECTION_MISMATCH",
            "The Nango connection does not match the requested provider",
          ),
          400,
        );
      if (summary.organizationId !== `user:${actor.principal.id}`)
        return context.json(
          errorBody(
            "CRM_CONNECTION_ACCESS_DENIED",
            "The Nango connection does not belong to this user",
          ),
          403,
        );
      const current =
        existingForPrincipal ??
        (await repository.findActiveConnection(
          agencyId,
          requestedProvider,
          actor.principal.id,
        ));
      const candidate = {
        ...(current ?? {
          id: "unpersisted-connection",
          agencyId,
          provider: requestedProvider,
          status: "pending" as const,
          externalAccountId: null,
          externalAccountLabel: null,
          scopes: [],
          lastValidatedAt: null,
          createdAt: "",
          updatedAt: "",
        }),
        nangoConnectionId: connectionId,
        nangoIntegrationId: provider.integrationId,
      };
      const validation = await adapter.validate(candidate);
      const connection = await repository.saveConnection({
        agencyId,
        actor,
        provider: requestedProvider,
        nangoConnectionId: connectionId,
        nangoIntegrationId: provider.integrationId,
        status: "connected",
        externalAccountId: validation.externalAccountId,
        externalAccountLabel: validation.externalAccountLabel,
        scopes: validation.scopes,
        lastValidatedAt: new Date().toISOString(),
      });
      if (validation.externalAccountId) {
        try {
          await db
            .prepare(
              `UPDATE crm_collection_bindings
               SET config = json_set(config, '$.connectionId', ?)
               WHERE json_extract(config, '$.principalId') = ?
                 AND json_extract(config, '$.accountId') = ?
                 AND json_extract(config, '$.provider') = ?`,
            )
            .bind(
              connection.id,
              actor.principal.id,
              validation.externalAccountId,
              requestedProvider,
            )
            .run();
        } catch {}
      }
      await repository.appendAuditEvent({
        connectionId: connection.id,
        agencyId,
        principalId: actor.principal.id,
        provider: requestedProvider,
        eventType: "connection_completed",
        outcome: "success",
      });
      return context.json({ data: connectionDocument(connection) }, 200);
    } catch (exception) {
      const response = crmErrorResponse(exception);
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(disconnectConnectionRoute, async (context) => {
    const actor = actorFromContext(context);
    const { agencyId: requestedAgencyId } = context.req.valid("query");
    const requestedProvider = context.req.valid("param").provider;
    if (!isCrmProviderId(requestedProvider))
      return context.json(
        errorBody("CRM_PROVIDER_NOT_FOUND", "CRM provider not found"),
        404,
      );
    const connection =
      requestedAgencyId === undefined
        ? await repository.findActiveConnectionForPrincipal(
            requestedProvider,
            actor.principal.id,
          )
        : await repository.findActiveConnection(
            requestedAgencyId,
            requestedProvider,
            actor.principal.id,
          );
    const agencyId = connection?.agencyId ?? requestedAgencyId;
    if (agencyId === undefined || !canManageUserOwnedCrm(actor, agencyId))
      return context.json(membershipRequiredResponse(), 403);
    const provider = providers[requestedProvider];
    const status = providerStatus(provider);
    if (status)
      return context.json(
        errorBody(
          status === 424
            ? "CRM_PROVIDER_COMING_SOON"
            : "CRM_PROVIDER_UNAVAILABLE",
          "The requested CRM provider is unavailable",
        ),
        status,
      );
    if (!dependencies)
      return context.json(
        errorBody(
          "CRM_PROVIDER_UNAVAILABLE",
          "The requested CRM provider is unavailable",
        ),
        503,
      );
    if (!connection)
      return context.json(
        errorBody("CRM_CONNECTION_NOT_FOUND", "CRM connection not found"),
        404,
      );
    try {
      await dependencies.nango.deleteConnection(
        connection.nangoConnectionId,
        connection.nangoIntegrationId,
      );
      await repository.markDisconnected(
        agencyId,
        requestedProvider,
        actor.principal.id,
      );
      await repository.appendAuditEvent({
        connectionId: connection.id,
        agencyId,
        principalId: actor.principal.id,
        provider: requestedProvider,
        eventType: "connection_disconnected",
        outcome: "success",
      });
      return new Response(null, { status: 204 });
    } catch (exception) {
      const response = crmErrorResponse(exception);
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(contactListRoute, async (context) => {
    const actor = actorFromContext(context);
    const { agencyId, provider, limit, search } = context.req.valid("query");
    const resolved = await resolveCrmOperation(
      repository,
      dependencies,
      providers,
      actor,
      agencyId,
      provider,
    );
    if (isOperationError(resolved))
      return context.json(resolved.body, resolved.status);
    try {
      const query = search === undefined ? { limit } : { limit, search };
      const contacts = await resolved.adapter.listContacts(
        resolved.connection,
        query,
      );
      return context.json({ data: contacts }, 200);
    } catch (exception) {
      const response = await crmOperationErrorResponse(
        exception,
        repository,
        resolved.connection,
        actor,
      );
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(contactCreateRoute, async (context) => {
    const actor = actorFromContext(context);
    const { agencyId, provider, email, firstName, lastName, companyId } =
      context.req.valid("json");
    const resolved = await resolveCrmOperation(
      repository,
      dependencies,
      providers,
      actor,
      agencyId,
      provider,
    );
    if (isOperationError(resolved))
      return context.json(resolved.body, resolved.status);
    try {
      const contact = await resolved.adapter.createContact(
        resolved.connection,
        {
          email,
          firstName,
          lastName,
          companyId,
        },
      );
      return context.json({ data: contact }, 201);
    } catch (exception) {
      const response = await crmOperationErrorResponse(
        exception,
        repository,
        resolved.connection,
        actor,
      );
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(contactUpdateRoute, async (context) => {
    const actor = actorFromContext(context);
    const { agencyId, provider, email, firstName, lastName, companyId } =
      context.req.valid("json");
    const { contactId } = context.req.valid("param");
    const resolved = await resolveCrmOperation(
      repository,
      dependencies,
      providers,
      actor,
      agencyId,
      provider,
    );
    if (isOperationError(resolved))
      return context.json(resolved.body, resolved.status);
    try {
      const contact = await resolved.adapter.updateContact(
        resolved.connection,
        contactId,
        { email, firstName, lastName, companyId },
      );
      return context.json({ data: contact }, 200);
    } catch (exception) {
      const response = await crmOperationErrorResponse(
        exception,
        repository,
        resolved.connection,
        actor,
      );
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(companyListRoute, async (context) => {
    const actor = actorFromContext(context);
    const { agencyId, provider, limit, search } = context.req.valid("query");
    const resolved = await resolveCrmOperation(
      repository,
      dependencies,
      providers,
      actor,
      agencyId,
      provider,
    );
    if (isOperationError(resolved))
      return context.json(resolved.body, resolved.status);
    try {
      const query = search === undefined ? { limit } : { limit, search };
      const companies = await resolved.adapter.listCompanies(
        resolved.connection,
        query,
      );
      return context.json({ data: companies }, 200);
    } catch (exception) {
      const response = await crmOperationErrorResponse(
        exception,
        repository,
        resolved.connection,
        actor,
      );
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });

  app.openapi(dealListRoute, async (context) => {
    const actor = actorFromContext(context);
    const { agencyId, provider, limit, search } = context.req.valid("query");
    const resolved = await resolveCrmOperation(
      repository,
      dependencies,
      providers,
      actor,
      agencyId,
      provider,
    );
    if (isOperationError(resolved))
      return context.json(resolved.body, resolved.status);
    try {
      const query = search === undefined ? { limit } : { limit, search };
      const deals = await resolved.adapter.listDeals(
        resolved.connection,
        query,
      );
      return context.json({ data: deals }, 200);
    } catch (exception) {
      const response = await crmOperationErrorResponse(
        exception,
        repository,
        resolved.connection,
        actor,
      );
      if (!response) throw exception;
      return context.json(response.body, response.status);
    }
  });
}
