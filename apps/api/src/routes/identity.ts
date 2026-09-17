import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  actorFromContext,
  requirePlatformAdministrator,
} from "../auth/middleware";
import {
  activePlatformAdministratorCount,
  deletePrincipal,
  findPrincipal,
  grantMembership,
  loadActor,
  removeMembership,
  setPlatformAdministrator,
  setPrincipalActive,
  updatePrincipal,
  upsertPrincipal,
} from "../auth/identity-repository";
import {
  TenantMembershipInvariantError,
  assertPrincipalCanLoseActiveMembership,
  ensureActiveCommercialTenant,
} from "../auth/tenant-membership-invariants";
import type {
  IdentityUserAdministrator,
  ManagedIdentityUser,
  OAuthClientAdministrator,
} from "../auth/better-auth";
import { AuthenticationError, type AgencyRole } from "../auth/types";
import type { AppActor } from "../auth/types";

const membershipSchema = z.object({
  id: z.string(),
  role: z.enum(["tenant_admin", "agency_admin", "operator", "viewer"]),
  attributes: z.object({ isActive: z.boolean() }),
  relationships: z.object({ tenant: z.object({ id: z.string() }), agency: z.object({ id: z.string() }) }),
});

const actorSchema = z.object({
  id: z.string(),
  kind: z.literal("identity-principal"),
  attributes: z.object({
    email: z.string().email(),
    displayName: z.string(),
    isActive: z.boolean(),
    globalRoles: z.array(z.literal("platform_admin")),
  }),
  relationships: z.object({ memberships: z.array(membershipSchema) }),
});

const managedActorSchema = actorSchema.extend({
  attributes: actorSchema.shape.attributes.extend({
    account: z.object({
      role: z.enum(["admin", "user"]),
      isBanned: z.boolean(),
      twoFactorEnabled: z.boolean(),
    }),
  }),
});

const currentIdentityRoute = createRoute({
  method: "get",
  path: "/v1/identity/me",
  tags: ["Identity & access"],
  summary: "Get current identity",
  description:
    "Returns the Better Auth identity and Savia authorization memberships.",
  security: [{ oauth2: ["savia.api.read"] }],
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ data: actorSchema }) },
      },
      description: "Authenticated principal",
    },
    401: { description: "Bearer token is missing or invalid" },
  },
});

const identityUsersRoute = createRoute({
  method: "get",
  path: "/v1/identity/users",
  tags: ["Identity & access"],
  summary: "List Savia users",
  description:
    "Lists locally provisioned Better Auth users and their memberships.",
  security: [{ oauth2: ["savia.api.read"] }],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ data: z.array(managedActorSchema) }),
        },
      },
      description: "Provisioned users",
    },
    403: { description: "Platform administrator role is required" },
  },
});

const membershipInputSchema = z.object({
  tenantId: z.number().int().positive().optional(),
  agencyId: z.number().int().positive().optional(),
  role: z.enum(["tenant_admin", "agency_admin", "operator", "viewer"]),
}).refine((input) => input.tenantId !== undefined || input.agencyId !== undefined, {
  message: "A tenantId is required",
}).refine((input) => input.tenantId === undefined || input.agencyId === undefined || input.tenantId === input.agencyId, {
  message: "tenantId and agencyId must identify the same tenant",
});

const userProvisionSchema = z
  .object({
    email: z.string().email(),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    platformAdmin: z.boolean().default(false),
    temporaryPassword: z.string().min(12).max(128).optional(),
    membership: membershipInputSchema.optional(),
  })
  .superRefine((input, context) => {
    if (!input.platformAdmin && !input.membership) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["membership"],
        message: "A commercial tenant membership is required",
      });
    }
  });

const provisionIdentityRoute = createRoute({
  method: "post",
  path: "/v1/identity/users",
  tags: ["Identity & access"],
  summary: "Provision a Better Auth user",
  description:
    "Creates a Better Auth user and a Savia principal in a commercial tenant, or in the internal platform tenant for a platform administrator.",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    body: {
      content: { "application/json": { schema: userProvisionSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: {
        "application/json": { schema: z.object({ data: managedActorSchema }) },
      },
      description: "Provisioned user without password data",
    },
    403: { description: "Platform administrator role is required" },
    404: { description: "Tenant was not found" },
    409: { description: "Tenant membership invariant prevented provisioning" },
    503: { description: "Better Auth provisioning is unavailable" },
  },
});

const membershipParamsSchema = z.object({ principalId: z.string().uuid() });
const grantMembershipRoute = createRoute({
  method: "post",
  path: "/v1/identity/users/{principalId}/memberships",
  tags: ["Identity & access"],
  summary: "Assign tenant access",
  description: "Assigns the user to one tenant or updates the existing tenant role.",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    params: membershipParamsSchema,
    body: {
      content: { "application/json": { schema: membershipInputSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: {
        "application/json": { schema: z.object({ data: managedActorSchema }) },
      },
      description: "User with updated tenant assignment",
    },
    403: { description: "Platform administrator role is required" },
    404: { description: "Identity principal or tenant was not found" },
    409: { description: "User already belongs to another tenant" },
  },
});

const identityUserParamsSchema = z.object({ principalId: z.string().uuid() });
const updateIdentityUserSchema = z
  .object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    platformAdmin: z.boolean().optional(),
    membership: membershipInputSchema.optional(),
  })
  .refine(
    (input) =>
      input.firstName !== undefined ||
      input.lastName !== undefined ||
      input.platformAdmin !== undefined ||
      input.membership !== undefined,
    { message: "At least one change is required" },
  );

const identityUserRoute = createRoute({
  method: "get",
  path: "/v1/identity/users/{principalId}",
  tags: ["Identity & access"],
  summary: "Get a Savia user",
  security: [{ oauth2: ["savia.api.read"] }],
  request: { params: identityUserParamsSchema },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ data: managedActorSchema }) },
      },
      description: "User with account and access state",
    },
    403: { description: "Platform administrator role is required" },
    404: { description: "Identity principal was not found" },
  },
});

const updateIdentityUserRoute = createRoute({
  method: "patch",
  path: "/v1/identity/users/{principalId}",
  tags: ["Identity & access"],
  summary: "Update a Savia user and platform role",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    params: identityUserParamsSchema,
    body: {
      content: { "application/json": { schema: updateIdentityUserSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ data: managedActorSchema }) },
      },
      description: "Updated user",
    },
    400: {
      description:
        "The update is invalid or would remove the final administrator",
    },
    403: { description: "Platform administrator role is required" },
    404: { description: "Identity principal was not found" },
  },
});

const deleteMembershipRoute = createRoute({
  method: "delete",
  path: "/v1/identity/users/{principalId}/memberships/{agencyId}",
  tags: ["Identity & access"],
  summary: "Remove tenant access",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    params: identityUserParamsSchema.extend({
      agencyId: z.coerce.number().int().positive(),
    }),
  },
  responses: { 204: { description: "Tenant assignment removed" } },
});

const accountActionParamsSchema = identityUserParamsSchema;

function accountActionRoute(
  method: "post" | "delete",
  suffix: string,
  summary: string,
  description: string,
) {
  return createRoute({
    method,
    path: `/v1/identity/users/{principalId}/${suffix}`,
    tags: ["Identity & access"],
    summary,
    security: [{ oauth2: ["savia.api.write"] }],
    request: { params: accountActionParamsSchema },
    responses: { 204: { description } },
  });
}

const suspendIdentityUserRoute = accountActionRoute(
  "post",
  "suspension",
  "Suspend a Savia user",
  "Account blocked and sessions revoked",
);
const reactivateIdentityUserRoute = accountActionRoute(
  "delete",
  "suspension",
  "Reactivate a Savia user",
  "Account reactivated",
);
const revokeIdentityUserSessionsRoute = accountActionRoute(
  "post",
  "sessions/revoke",
  "Revoke user sessions",
  "All user sessions revoked",
);
const passwordResetIdentityUserRoute = accountActionRoute(
  "post",
  "password-reset",
  "Send a password reset link",
  "Password reset link accepted for delivery",
);

const deleteIdentityRoute = createRoute({
  method: "delete",
  path: "/v1/identity/users/{principalId}",
  tags: ["Identity & access"],
  summary: "Delete a Savia user",
  description:
    "Removes the Better Auth account and its Savia principal memberships.",
  security: [{ oauth2: ["savia.api.write"] }],
  request: { params: membershipParamsSchema },
  responses: {
    204: { description: "User removed from Better Auth and Savia" },
    403: { description: "Platform administrator role is required" },
    404: { description: "Identity principal was not found" },
  },
});

const oauthClientAuthenticationSchema = z.enum([
  "none",
  "client_secret_basic",
  "client_secret_post",
]);
const oauthClientSummarySchema = z.object({
  applicationType: z.enum(["native", "web"]),
  clientAuthentication: oauthClientAuthenticationSchema,
  clientId: z.string().min(1),
  clientName: z.string().min(1),
  redirectUris: z.array(z.string().url()).min(1),
  scopes: z.array(z.string().min(1)),
  trusted: z.boolean(),
});
const oauthClientCreatedSchema = oauthClientSummarySchema.extend({
  clientSecret: z.string().min(1).optional(),
});
const oauthClientCreateSchema = z.object({
  clientAuthentication: oauthClientAuthenticationSchema,
  clientName: z.string().min(1).max(120),
  redirectUris: z.array(z.string().url()).min(1),
  scopes: z.array(z.string().min(1)).min(1),
  trusted: z.boolean().default(false),
});
const oauthClientUpdateSchema = oauthClientCreateSchema
  .omit({ clientAuthentication: true })
  .partial()
  .refine((input) => Object.keys(input).length > 0);
const oauthClientParamsSchema = z.object({ clientId: z.string().min(1) });

const listOAuthClientsRoute = createRoute({
  method: "get",
  path: "/v1/identity/oauth-clients",
  tags: ["Identity & access"],
  summary: "List OAuth clients",
  security: [{ oauth2: ["savia.api.read"] }],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ data: z.array(oauthClientSummarySchema) }),
        },
      },
      description: "OAuth clients without secrets",
    },
    403: { description: "Platform administrator role is required" },
  },
});

const createOAuthClientRoute = createRoute({
  method: "post",
  path: "/v1/identity/oauth-clients",
  tags: ["Identity & access"],
  summary: "Create an OAuth client",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    body: {
      content: { "application/json": { schema: oauthClientCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: z.object({ data: oauthClientCreatedSchema }),
        },
      },
      description: "Client; a confidential client secret is returned only once",
    },
    403: { description: "Platform administrator role is required" },
  },
});

const updateOAuthClientRoute = createRoute({
  method: "patch",
  path: "/v1/identity/oauth-clients/{clientId}",
  tags: ["Identity & access"],
  summary: "Update an OAuth client",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    params: oauthClientParamsSchema,
    body: {
      content: { "application/json": { schema: oauthClientUpdateSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ data: oauthClientSummarySchema }),
        },
      },
      description: "Client without a secret",
    },
  },
});

const deleteOAuthClientRoute = createRoute({
  method: "delete",
  path: "/v1/identity/oauth-clients/{clientId}",
  tags: ["Identity & access"],
  summary: "Disable an OAuth client",
  security: [{ oauth2: ["savia.api.write"] }],
  request: { params: oauthClientParamsSchema },
  responses: { 204: { description: "Client disabled" } },
});

const rotateOAuthClientSecretRoute = createRoute({
  method: "post",
  path: "/v1/identity/oauth-clients/{clientId}/rotate-secret",
  tags: ["Identity & access"],
  summary: "Rotate a confidential OAuth client secret",
  security: [{ oauth2: ["savia.api.write"] }],
  request: { params: oauthClientParamsSchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            data: z.object({ clientId: z.string(), clientSecret: z.string() }),
          }),
        },
      },
      description: "New secret, returned only once",
    },
  },
});

function actorDocument(actor: AppActor) {
  return {
    id: actor.principal.id,
    kind: "identity-principal" as const,
    attributes: {
      email: actor.principal.email,
      displayName: actor.principal.displayName,
      isActive: actor.principal.isActive,
      globalRoles: actor.globalRoles,
    },
    relationships: {
      memberships: actor.memberships.map((entry) => ({
        id: entry.id,
        role: entry.role,
        attributes: { isActive: entry.isActive },
        relationships: { tenant: { id: String(entry.tenantId ?? entry.agencyId) }, agency: { id: String(entry.agencyId) } },
      })),
    },
  };
}

function managedActorDocument(actor: AppActor, account: ManagedIdentityUser) {
  const document = actorDocument(actor);
  return {
    ...document,
    attributes: {
      ...document.attributes,
      account: {
        role: account.role,
        isBanned: account.isBanned,
        twoFactorEnabled: account.twoFactorEnabled,
      },
    },
  };
}

async function managedActor(
  d1: D1Database,
  principalId: string,
  administrator: IdentityUserAdministrator,
  request: Request,
) {
  const principal = await findPrincipal(d1, principalId);
  if (!principal) return undefined;
  const [actor, account] = await Promise.all([
    loadActor(d1, principal),
    administrator.getUser(principal.subject, request),
  ]);
  return managedActorDocument(actor, account);
}

function unavailableUserAdministration(): never {
  throw new AuthenticationError(
    "AUTHENTICATION_UNAVAILABLE",
    "User administration is not configured",
  );
}

function preventSelfAdministration(actor: AppActor, principalId: string): void {
  if (actor.principal.id === principalId) {
    throw new AuthenticationError(
      "AUTHORIZATION_FORBIDDEN",
      "Platform administrators cannot perform this action on themselves",
    );
  }
}

async function preventRemovingFinalAdministrator(
  d1: D1Database,
  target: AppActor,
): Promise<Response | undefined> {
  if (
    target.globalRoles.includes("platform_admin") &&
    (await activePlatformAdministratorCount(d1)) <= 1
  ) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message:
            "Savia must retain at least one active platform administrator",
        },
      },
      { status: 400 },
    );
  }
  return undefined;
}

function membershipInvariantResponse(
  context: { json: (body: unknown, status: 404 | 409) => Response },
  error: TenantMembershipInvariantError,
): Response {
  return context.json(
    { error: { code: error.code, message: error.message } },
    error.code === "TENANT_NOT_FOUND" ? 404 : 409,
  );
}

export function registerIdentityRoutes(
  app: OpenAPIHono,
  d1: D1Database,
  userAdministrator?: IdentityUserAdministrator,
  oauthClientAdministrator?: OAuthClientAdministrator,
): void {
  app.openapi(currentIdentityRoute, (context) =>
    context.json({ data: actorDocument(actorFromContext(context)) }, 200),
  );
  app.openapi(identityUsersRoute, async (context) => {
    requirePlatformAdministrator(actorFromContext(context));
    if (!userAdministrator) unavailableUserAdministration();
    const documents = await Promise.all(
      (await userAdministrator.listUsers(context.req.raw)).map(
        async (account) => {
          const principal = await upsertPrincipal(d1, {
            issuer: userAdministrator.issuer,
            subject: account.subject,
            email: account.email,
            displayName: account.displayName,
          });
          if (account.role === "admin") {
            await setPlatformAdministrator(d1, principal.id, true);
          }
          return managedActorDocument(await loadActor(d1, principal), account);
        },
      ),
    );
    return context.json({ data: documents }, 200);
  });
  app.openapi(provisionIdentityRoute, async (context) => {
    requirePlatformAdministrator(actorFromContext(context));
    if (!userAdministrator) unavailableUserAdministration();
    const input = context.req.valid("json");
    const authenticatedUser = await userAdministrator.createUser(
      input,
      context.req.raw,
    );
    let createdPrincipalId: string | undefined;
    try {
      const principal = await upsertPrincipal(d1, {
        issuer: userAdministrator.issuer,
        subject: authenticatedUser.subject,
        email: authenticatedUser.email,
        displayName: authenticatedUser.displayName,
      });
      createdPrincipalId = principal.id;
      if (input.platformAdmin) {
        await setPlatformAdministrator(d1, principal.id, true);
      } else if (input.membership) {
        await grantMembership(
          d1,
          principal.id,
          (input.membership.tenantId ?? input.membership.agencyId)!,
          input.membership.role as AgencyRole,
        );
      }
      if (!input.temporaryPassword) {
        await userAdministrator.sendPasswordReset(
          authenticatedUser.subject,
          context.req.raw,
        );
      }
      return context.json(
        {
          data: managedActorDocument(
            await loadActor(d1, principal),
            await userAdministrator.getUser(
              authenticatedUser.subject,
              context.req.raw,
            ),
          ),
        },
        201,
      );
    } catch (exception) {
      if (createdPrincipalId) await deletePrincipal(d1, createdPrincipalId);
      await userAdministrator.deleteUser(
        authenticatedUser.subject,
        context.req.raw,
      );
      if (exception instanceof TenantMembershipInvariantError) {
        return membershipInvariantResponse(context, exception);
      }
      throw exception;
    }
  });
  app.openapi(grantMembershipRoute, async (context) => {
    requirePlatformAdministrator(actorFromContext(context));
    if (!userAdministrator) unavailableUserAdministration();
    const { principalId } = context.req.valid("param");
    const principal = await findPrincipal(d1, principalId);
    if (!principal) {
      return context.json(
        {
          error: { code: "NOT_FOUND", message: "Identity principal not found" },
        },
        404,
      );
    }
    const input = context.req.valid("json");
    try {
      await grantMembership(d1, principal.id, (input.tenantId ?? input.agencyId)!, input.role);
    } catch (error) {
      if (error instanceof TenantMembershipInvariantError) {
        return membershipInvariantResponse(context, error);
      }
      throw error;
    }
    return context.json(
      {
        data: managedActorDocument(
          await loadActor(d1, principal),
          await userAdministrator.getUser(principal.subject, context.req.raw),
        ),
      },
      201,
    );
  });
  app.openapi(identityUserRoute, async (context) => {
    requirePlatformAdministrator(actorFromContext(context));
    if (!userAdministrator) unavailableUserAdministration();
    const { principalId } = context.req.valid("param");
    const document = await managedActor(
      d1,
      principalId,
      userAdministrator,
      context.req.raw,
    );
    if (!document) {
      return context.json(
        {
          error: { code: "NOT_FOUND", message: "Identity principal not found" },
        },
        404,
      );
    }
    return context.json({ data: document }, 200);
  });
  app.openapi(updateIdentityUserRoute, async (context) => {
    const actor = actorFromContext(context);
    requirePlatformAdministrator(actor);
    if (!userAdministrator) unavailableUserAdministration();
    const { principalId } = context.req.valid("param");
    const target = await findPrincipal(d1, principalId);
    if (!target) {
      return context.json(
        {
          error: { code: "NOT_FOUND", message: "Identity principal not found" },
        },
        404,
      );
    }
    const input = context.req.valid("json");
    const targetActor = await loadActor(d1, target);
    try {
      if (input.platformAdmin === true) {
        await assertPrincipalCanLoseActiveMembership(d1, target.id);
      }
      if (
        input.platformAdmin === false &&
        targetActor.globalRoles.includes("platform_admin") &&
        input.membership
      ) {
        await ensureActiveCommercialTenant(
          d1,
          input.membership.tenantId ?? input.membership.agencyId!,
        );
      }
    } catch (error) {
      if (error instanceof TenantMembershipInvariantError) {
        return membershipInvariantResponse(context, error);
      }
      throw error;
    }
    if (input.platformAdmin === false) {
      preventSelfAdministration(actor, target.id);
      const blocked = await preventRemovingFinalAdministrator(d1, targetActor);
      if (blocked) return blocked;
      if (targetActor.globalRoles.includes("platform_admin") && !input.membership) {
        return context.json(
          {
            error: {
              code: "COMMERCIAL_MEMBERSHIP_REQUIRED",
              message:
                "A commercial tenant membership is required when revoking platform administration",
            },
          },
          400,
        );
      }
    }
    const displayName =
      input.firstName === undefined && input.lastName === undefined
        ? undefined
        : [input.firstName, input.lastName]
            .filter((part): part is string => Boolean(part))
            .join(" ");
    const account = await userAdministrator.updateUser(
      target.subject,
      { displayName, platformAdmin: input.platformAdmin },
      context.req.raw,
    );
    const savedPrincipal = displayName
      ? await updatePrincipal(d1, target.id, { displayName })
      : target;
    if (input.platformAdmin !== undefined) {
      try {
        await setPlatformAdministrator(
          d1,
          target.id,
          input.platformAdmin,
          input.membership?.tenantId ?? input.membership?.agencyId,
          input.membership?.role,
        );
      } catch (error) {
        if (error instanceof TenantMembershipInvariantError) {
          return membershipInvariantResponse(context, error);
        }
        throw error;
      }
    } else if (input.membership) {
      try {
        await grantMembership(
          d1,
          target.id,
          input.membership.tenantId ?? input.membership.agencyId!,
          input.membership.role,
        );
      } catch (error) {
        if (error instanceof TenantMembershipInvariantError) {
          return membershipInvariantResponse(context, error);
        }
        throw error;
      }
    }
    return context.json(
      {
        data: managedActorDocument(
          await loadActor(d1, savedPrincipal),
          account,
        ),
      },
      200,
    );
  });
  app.openapi(deleteMembershipRoute, async (context) => {
    requirePlatformAdministrator(actorFromContext(context));
    const { principalId, agencyId } = context.req.valid("param");
    const target = await findPrincipal(d1, principalId);
    if (!target) {
      return context.json(
        {
          error: { code: "NOT_FOUND", message: "Identity principal not found" },
        },
        404,
      );
    }
    try {
      await removeMembership(d1, principalId, agencyId);
    } catch (error) {
      if (error instanceof TenantMembershipInvariantError) {
        return membershipInvariantResponse(context, error);
      }
      throw error;
    }
    return context.body(null, 204);
  });
  app.openapi(suspendIdentityUserRoute, async (context) => {
    const actor = actorFromContext(context);
    requirePlatformAdministrator(actor);
    if (!userAdministrator) unavailableUserAdministration();
    const { principalId } = context.req.valid("param");
    preventSelfAdministration(actor, principalId);
    const target = await findPrincipal(d1, principalId);
    if (!target) {
      return context.json(
        {
          error: { code: "NOT_FOUND", message: "Identity principal not found" },
        },
        404,
      );
    }
    const targetActor = await loadActor(d1, target);
    const blocked = await preventRemovingFinalAdministrator(d1, targetActor);
    if (blocked) return blocked;
    try {
      await assertPrincipalCanLoseActiveMembership(d1, target.id);
      await userAdministrator.setAccountActive(
        target.subject,
        false,
        context.req.raw,
      );
      await setPrincipalActive(d1, target.id, false);
    } catch (error) {
      if (error instanceof TenantMembershipInvariantError) {
        return membershipInvariantResponse(context, error);
      }
      throw error;
    }
    return context.body(null, 204);
  });
  app.openapi(reactivateIdentityUserRoute, async (context) => {
    requirePlatformAdministrator(actorFromContext(context));
    if (!userAdministrator) unavailableUserAdministration();
    const { principalId } = context.req.valid("param");
    const target = await findPrincipal(d1, principalId);
    if (!target) {
      return context.json(
        {
          error: { code: "NOT_FOUND", message: "Identity principal not found" },
        },
        404,
      );
    }
    await userAdministrator.setAccountActive(
      target.subject,
      true,
      context.req.raw,
    );
    await setPrincipalActive(d1, target.id, true);
    return context.body(null, 204);
  });
  app.openapi(revokeIdentityUserSessionsRoute, async (context) => {
    const actor = actorFromContext(context);
    requirePlatformAdministrator(actor);
    if (!userAdministrator) unavailableUserAdministration();
    const { principalId } = context.req.valid("param");
    preventSelfAdministration(actor, principalId);
    const target = await findPrincipal(d1, principalId);
    if (!target) {
      return context.json(
        {
          error: { code: "NOT_FOUND", message: "Identity principal not found" },
        },
        404,
      );
    }
    await userAdministrator.revokeSessions(target.subject, context.req.raw);
    return context.body(null, 204);
  });
  app.openapi(passwordResetIdentityUserRoute, async (context) => {
    requirePlatformAdministrator(actorFromContext(context));
    if (!userAdministrator) unavailableUserAdministration();
    const { principalId } = context.req.valid("param");
    const target = await findPrincipal(d1, principalId);
    if (!target) {
      return context.json(
        {
          error: { code: "NOT_FOUND", message: "Identity principal not found" },
        },
        404,
      );
    }
    await userAdministrator.sendPasswordReset(target.subject, context.req.raw);
    return context.body(null, 204);
  });
  app.openapi(deleteIdentityRoute, async (context) => {
    const actor = actorFromContext(context);
    requirePlatformAdministrator(actor);
    if (!userAdministrator) unavailableUserAdministration();
    const { principalId } = context.req.valid("param");
    const principal = await findPrincipal(d1, principalId);
    if (!principal) {
      return context.json(
        {
          error: { code: "NOT_FOUND", message: "Identity principal not found" },
        },
        404,
      );
    }
    preventSelfAdministration(actor, principal.id);
    const targetActor = await loadActor(d1, principal);
    const blocked = await preventRemovingFinalAdministrator(d1, targetActor);
    if (blocked) return blocked;
    try {
      await assertPrincipalCanLoseActiveMembership(d1, principal.id);
    } catch (error) {
      if (error instanceof TenantMembershipInvariantError) {
        return membershipInvariantResponse(context, error);
      }
      throw error;
    }
    await userAdministrator.deleteUser(principal.subject, context.req.raw);
    await deletePrincipal(d1, principal.id);
    return context.body(null, 204);
  });
  app.openapi(listOAuthClientsRoute, async (context) => {
    requirePlatformAdministrator(actorFromContext(context));
    if (!oauthClientAdministrator) {
      throw new AuthenticationError(
        "AUTHENTICATION_UNAVAILABLE",
        "OAuth client management is not configured",
      );
    }
    return context.json(
      { data: await oauthClientAdministrator.list(context.req.raw) },
      200,
    );
  });
  app.openapi(createOAuthClientRoute, async (context) => {
    requirePlatformAdministrator(actorFromContext(context));
    if (!oauthClientAdministrator) {
      throw new AuthenticationError(
        "AUTHENTICATION_UNAVAILABLE",
        "OAuth client management is not configured",
      );
    }
    return context.json(
      {
        data: await oauthClientAdministrator.create(
          context.req.valid("json"),
          context.req.raw,
        ),
      },
      201,
    );
  });
  app.openapi(updateOAuthClientRoute, async (context) => {
    requirePlatformAdministrator(actorFromContext(context));
    if (!oauthClientAdministrator) {
      throw new AuthenticationError(
        "AUTHENTICATION_UNAVAILABLE",
        "OAuth client management is not configured",
      );
    }
    const { clientId } = context.req.valid("param");
    return context.json(
      {
        data: await oauthClientAdministrator.update(
          clientId,
          context.req.valid("json"),
          context.req.raw,
        ),
      },
      200,
    );
  });
  app.openapi(deleteOAuthClientRoute, async (context) => {
    requirePlatformAdministrator(actorFromContext(context));
    if (!oauthClientAdministrator) {
      throw new AuthenticationError(
        "AUTHENTICATION_UNAVAILABLE",
        "OAuth client management is not configured",
      );
    }
    const { clientId } = context.req.valid("param");
    await oauthClientAdministrator.disable(clientId, context.req.raw);
    return context.body(null, 204);
  });
  app.openapi(rotateOAuthClientSecretRoute, async (context) => {
    requirePlatformAdministrator(actorFromContext(context));
    if (!oauthClientAdministrator) {
      throw new AuthenticationError(
        "AUTHENTICATION_UNAVAILABLE",
        "OAuth client management is not configured",
      );
    }
    const { clientId } = context.req.valid("param");
    return context.json(
      {
        data: await oauthClientAdministrator.rotateSecret(
          clientId,
          context.req.raw,
        ),
      },
      200,
    );
  });
}
