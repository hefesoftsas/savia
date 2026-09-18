import { RealtimeHubError } from "./realtime/hub-client";
import { installRequestResultEnvelope } from "./request-results/routes";

import { HTTPException } from "hono/http-exception";

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { registerAdminOAuthRoutes } from "./auth/admin-oauth";
import { betterAuthAuthenticator, type AuthService } from "./auth/better-auth";
import {
  authenticationErrorResponse,
  authenticationMiddleware,
} from "./auth/middleware";
import {
  protectedResourceMetadata,
  type OAuthResourceAuthenticator,
} from "./auth/oauth-resource";
import { AuthenticationError, type Authenticator } from "./auth/types";
import { publicAuthUrls, type PublicAuthUrls } from "./public-origin";

import { registerHealthRoute } from "./routes/health";
import { canonicalHostForApi, tenantHostGuard } from "./auth/tenant-host-guard";

export const openApiDocument = {
  openapi: "3.1.0" as const,
  info: {
    title: "Savia Core API",
    version: "2.0.0",
  },
  security: [{ oauth2: [] }],
};

const oauthScopes = {
  openid: "OpenID Connect identity",
  profile: "Basic Savia profile",
  email: "Verified Savia email",
  "savia.api.read": "Read Savia domain data",
  "savia.api.write": "Execute Savia commands and administrative writes",
};

type ScalarOAuthClient = {
  clientId: string;
  redirectUri: string;
  resource: string;
  scopes: string[];
};

const localPublicAuthUrls = publicAuthUrls("http://127.0.0.1:8787");

type OpenApiDocument = ReturnType<OpenAPIHono["getOpenAPI31Document"]>;

const betterAuthSignInRoute = createRoute({
  method: "post",
  path: "/api/auth/sign-in/email",
  tags: ["Identity & access"],
  summary: "Start a Better Auth session",
  description:
    "Signs in with email and password. The first-party savia.session_token cookie returned by this operation authorizes the rest of the Scalar session.",
  security: [],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            email: z.string().email(),
            password: z.string().min(1),
          }),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      headers: {
        "set-cookie": {
          schema: { type: "string" },
          description: "First-party Better Auth session cookie",
        },
      },
      description: "Authenticated session",
    },
    401: { description: "Invalid email or password" },
    503: { description: "Authentication service is unavailable" },
  },
});

const betterAuthPasswordResetRequestRoute = createRoute({
  method: "post",
  path: "/api/auth/request-password-reset",
  tags: ["Identity & access"],
  summary: "Request a password-reset email",
  description:
    "Requests a short-lived password-reset link. The response is intentionally the same whether or not the email belongs to a Savia user.",
  security: [],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            email: z.string().email(),
            redirectTo: z.string().url().optional(),
          }),
        },
      },
      required: true,
    },
  },
  responses: {
    200: { description: "Password-reset request accepted" },
    400: { description: "Invalid request" },
    503: { description: "Authentication service is unavailable" },
  },
});

const betterAuthPasswordResetRoute = createRoute({
  method: "post",
  path: "/api/auth/reset-password",
  tags: ["Identity & access"],
  summary: "Set a password from a reset token",
  description:
    "Consumes the one-time token from a password-reset link and revokes the user's existing sessions.",
  security: [],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            token: z.string().min(1),
            newPassword: z.string().min(12),
          }),
        },
      },
      required: true,
    },
  },
  responses: {
    200: { description: "Password reset" },
    400: { description: "Invalid or expired token, or invalid password" },
    503: { description: "Authentication service is unavailable" },
  },
});

const betterAuthTotpEnrollmentRoute = createRoute({
  method: "post",
  path: "/api/auth/two-factor/enable",
  tags: ["Identity & access"],
  summary: "Enroll TOTP multi-factor authentication",
  description:
    "Starts TOTP enrollment for the active session. Scan the returned URI with an authenticator app, keep the recovery codes offline, then complete enrollment with the verification operation.",
  security: [{ sessionAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            password: z.string().min(1),
            method: z.literal("totp"),
          }),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            method: z.literal("totp"),
            totpURI: z.string().url(),
            backupCodes: z.array(z.string()).min(1),
          }),
        },
      },
      description: "TOTP URI and one-time recovery codes",
    },
    401: { description: "An active session and current password are required" },
    503: { description: "Authentication service is unavailable" },
  },
});

const betterAuthTotpVerificationRoute = createRoute({
  method: "post",
  path: "/api/auth/two-factor/verify-totp",
  tags: ["Identity & access"],
  summary: "Complete a TOTP challenge",
  description:
    "Completes either enrollment or an interrupted sign-in. The browser must retain the short-lived Better Auth challenge cookie set by the previous operation.",
  security: [],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ code: z.string().regex(/^\d{6}$/) }),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      headers: {
        "set-cookie": {
          schema: { type: "string" },
          description: "Authenticated Better Auth session cookie",
        },
      },
      description: "MFA challenge accepted and session created",
    },
    400: { description: "The challenge or TOTP code is invalid" },
    503: { description: "Authentication service is unavailable" },
  },
});

const betterAuthRecoveryCodeRoute = createRoute({
  method: "post",
  path: "/api/auth/two-factor/verify-backup-code",
  tags: ["Identity & access"],
  summary: "Complete a recovery-code challenge",
  description:
    "Completes an interrupted sign-in with one unused recovery code. The browser must retain the short-lived Better Auth challenge cookie set by the previous operation.",
  security: [],
  request: {
    body: {
      content: {
        "application/json": { schema: z.object({ code: z.string().min(1) }) },
      },
      required: true,
    },
  },
  responses: {
    200: {
      headers: {
        "set-cookie": {
          schema: { type: "string" },
          description: "Authenticated Better Auth session cookie",
        },
      },
      description: "Recovery code accepted and session created",
    },
    400: { description: "The challenge or recovery code is invalid" },
    503: { description: "Authentication service is unavailable" },
  },
});

function authenticationUnavailableResponse(): Response {
  return Response.json(
    {
      error: {
        code: "AUTHENTICATION_UNAVAILABLE",
        message: "Authentication service is unavailable",
      },
    },
    { status: 503 },
  );
}

function registerOpenApiAuthentication(
  app: OpenAPIHono,
  oauthUrls: PublicAuthUrls,
): void {
  app.openAPIRegistry.registerComponent("securitySchemes", "sessionAuth", {
    type: "apiKey",
    in: "cookie",
    name: "savia.session_token",
    description: "First-party Better Auth session cookie",
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "oauth2", {
    type: "oauth2",
    flows: {
      authorizationCode: {
        authorizationUrl: oauthUrls.authorizationUrl,
        tokenUrl: oauthUrls.tokenUrl,
        scopes: oauthScopes,
        "x-usePkce": "SHA-256",
      },
    },
  });
}

function scalarConfiguration(
  client: ScalarOAuthClient,
  document: OpenApiDocument,
  oauthUrls: PublicAuthUrls,
) {
  return {
    content: {
      ...document,
      components: {
        ...document.components,
        securitySchemes: {
          ...document.components?.securitySchemes,
          oauth2: {
            flows: {
              authorizationCode: {
                authorizationUrl: oauthUrls.authorizationUrl,
                tokenUrl: oauthUrls.tokenUrl,
                scopes: oauthScopes,
                "x-scalar-client-id": client.clientId,
                "x-scalar-redirect-uri": client.redirectUri,
                "x-scalar-security-query": [
                  { name: "resource", value: client.resource },
                ],
                "x-usePkce": "SHA-256",
              },
            },
            type: "oauth2",
          },
        },
      },
    },
    authentication: {
      preferredSecurityScheme: "oauth2",
    },
  };
}

async function scalarOAuthClient(
  service?: AuthService,
): Promise<ScalarOAuthClient | undefined> {
  if (!service) return undefined;
  const response = await service.fetch(
    new Request("https://savia-auth.internal/_internal/oauth/scalar-client"),
  );
  if (!response.ok) return undefined;
  const candidate = (await response.json()) as Partial<ScalarOAuthClient>;
  if (
    typeof candidate.clientId !== "string" ||
    typeof candidate.redirectUri !== "string" ||
    typeof candidate.resource !== "string" ||
    !Array.isArray(candidate.scopes)
  ) {
    return undefined;
  }
  return candidate as ScalarOAuthClient;
}

export function createApiShell(
  db: D1Database,
  authenticator?: Authenticator,
  authService?: AuthService,
  oauthResource?: OAuthResourceAuthenticator,
  oauthUrls: PublicAuthUrls = localPublicAuthUrls,
  document = openApiDocument,
  configureMiddleware?: (app: OpenAPIHono) => void,
  tenantHost?: { canonicalHost?: string },
): OpenAPIHono {
  const app = new OpenAPIHono({
    defaultHook: (result, context) => {
      if (!result.success) {
        return context.json(
          { error: { code: "VALIDATION_ERROR", message: "Invalid request" } },
          400,
        );
      }
    },
  });

  app.onError((exception, context) => {
    if (exception instanceof RealtimeHubError) return exception.getResponse();
    if (exception instanceof HTTPException)
      return context.json(
        { error: { code: "CRM_SYNC_ERROR", message: exception.message } },
        exception.status,
      );
    if (exception instanceof AuthenticationError)
      return authenticationErrorResponse(exception);
    return context.json(
      { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
      500,
    );
  });
  app.notFound((context) =>
    context.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404),
  );
  installRequestResultEnvelope(app);
  configureMiddleware?.(app);
  const resolvedAuthService = authService;
  registerOpenApiAuthentication(app, oauthUrls);
  app.openapi(betterAuthPasswordResetRequestRoute, (context) => {
    if (!resolvedAuthService) return authenticationUnavailableResponse();
    return resolvedAuthService.fetch(
      new Request(context.req.url, {
        method: "POST",
        headers: context.req.raw.headers,
        body: JSON.stringify(context.req.valid("json")),
      }),
    );
  });
  app.openapi(betterAuthPasswordResetRoute, (context) => {
    if (!resolvedAuthService) return authenticationUnavailableResponse();
    return resolvedAuthService.fetch(
      new Request(context.req.url, {
        method: "POST",
        headers: context.req.raw.headers,
        body: JSON.stringify(context.req.valid("json")),
      }),
    );
  });
  app.openapi(betterAuthSignInRoute, (context) => {
    if (!resolvedAuthService) return authenticationUnavailableResponse();
    return resolvedAuthService.fetch(
      new Request(context.req.url, {
        method: "POST",
        headers: context.req.raw.headers,
        body: JSON.stringify(context.req.valid("json")),
      }),
    );
  });
  app.openapi(betterAuthTotpEnrollmentRoute, (context) => {
    if (!resolvedAuthService) return authenticationUnavailableResponse();
    return resolvedAuthService.fetch(
      new Request(context.req.url, {
        method: "POST",
        headers: context.req.raw.headers,
        body: JSON.stringify(context.req.valid("json")),
      }),
    );
  });
  app.openapi(betterAuthTotpVerificationRoute, (context) => {
    if (!resolvedAuthService) return authenticationUnavailableResponse();
    return resolvedAuthService.fetch(
      new Request(context.req.url, {
        method: "POST",
        headers: context.req.raw.headers,
        body: JSON.stringify(context.req.valid("json")),
      }),
    );
  });
  app.openapi(betterAuthRecoveryCodeRoute, (context) => {
    if (!resolvedAuthService) return authenticationUnavailableResponse();
    return resolvedAuthService.fetch(
      new Request(context.req.url, {
        method: "POST",
        headers: context.req.raw.headers,
        body: JSON.stringify(context.req.valid("json")),
      }),
    );
  });
  const canonicalHost =
    tenantHost?.canonicalHost ??
    canonicalHostForApi(oauthUrls?.authorizationUrl);
  registerAdminOAuthRoutes(app, db, resolvedAuthService, canonicalHost);
  app.all("/api/auth/*", (context) => {
    if (!resolvedAuthService) return authenticationUnavailableResponse();
    return resolvedAuthService.fetch(context.req.raw);
  });
  if (oauthResource) {
    app.get("/.well-known/oauth-protected-resource", async (context) =>
      context.json(
        await protectedResourceMetadata(oauthResource.configuration),
      ),
    );
  }
  app.use(
    "/v1/*",
    authenticationMiddleware(
      db,
      authenticator ??
        betterAuthAuthenticator(resolvedAuthService, oauthResource),
    ),
  );
  app.use(
    "/api/assistant/*",
    authenticationMiddleware(
      db,
      authenticator ??
        betterAuthAuthenticator(resolvedAuthService, oauthResource),
    ),
  );
  app.use(
    "/api/lookups/*",
    authenticationMiddleware(
      db,
      authenticator ??
        betterAuthAuthenticator(resolvedAuthService, oauthResource),
    ),
  );
  if (canonicalHost) {
    const guard = tenantHostGuard(db, canonicalHost);
    app.use("/v1/*", guard);
    app.use("/api/assistant/*", guard);
  }
  registerHealthRoute(app, db);
  app.doc31("/openapi.json", document);
  app.get("/docs", async (context) => {
    const client = await scalarOAuthClient(resolvedAuthService);
    if (!client) return authenticationUnavailableResponse();
    return Scalar(() =>
      scalarConfiguration(
        client,
        app.getOpenAPI31Document(document),
        oauthUrls,
      ),
    )(context, async () => {});
  });

  return app;
}
