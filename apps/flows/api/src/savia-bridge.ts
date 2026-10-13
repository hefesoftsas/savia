import type { JWTTokenPayload } from "@savia/flows-types";
import type { Context, MiddlewareHandler } from "hono";
import { eq } from "drizzle-orm";
import { jwtVerify } from "jose";
import type { ApiContext } from "./context";
import { createDatabase, memberships, organizations, users } from "./db";

type SaviaBridgeClaims = {
  sub: string;
  name: string;
  email?: string;
  organization: { id: string; name: string; role: string } | null;
  platformAdmin: boolean;
};

function validClaims(value: unknown): value is SaviaBridgeClaims {
  if (!value || typeof value !== "object") return false;
  const claims = value as Record<string, unknown>;
  if (
    typeof claims.sub !== "string" ||
    claims.sub.length === 0 ||
    typeof claims.name !== "string" ||
    typeof claims.platformAdmin !== "boolean"
  )
    return false;
  if (claims.email !== undefined && typeof claims.email !== "string")
    return false;
  if (claims.organization === null) return claims.platformAdmin;
  if (!claims.organization || typeof claims.organization !== "object")
    return false;
  const organization = claims.organization as Record<string, unknown>;
  return (
    typeof organization.id === "string" &&
    typeof organization.name === "string" &&
    typeof organization.role === "string"
  );
}

export const saviaBridgeMiddleware: MiddlewareHandler<ApiContext> = async (
  c,
  next,
) => {
  const token = c.req.header("x-savia-flows-context");
  if (!token) {
    const path = c.req.path;
    const publicPath = [
      "/health",
      "/stripe/webhooks",
      "/telegram",
      "/discord",
      "/whatsapp",
      "/slack",
      "/http",
      "/queues",
      "/forms",
      "/form-triggers",
      "/feedback-forms",
      "/templates",
      "/types",
      "/robots.txt",
      "/llms.txt",
    ].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
    const readOnlyPublicCatalog = ["/templates", "/types"].some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    );
    if (
      publicPath &&
      (!readOnlyPublicCatalog || ["GET", "HEAD"].includes(c.req.method))
    ) {
      return next();
    }
    return c.json({ error: "Savia host identity required" }, 401);
  }

  const secret = c.env.SAVIA_FLOWS_BRIDGE_SECRET;
  if (!secret || new TextEncoder().encode(secret).byteLength < 32) {
    return c.json({ error: "Savia bridge is unavailable" }, 503);
  }
  let claims: SaviaBridgeClaims;
  let tokenExpiresAt: number;
  try {
    const verified = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: "savia",
      audience: "savia-flows",
      algorithms: ["HS256"],
      maxTokenAge: "60s",
    });
    const exp = verified.payload.exp;
    if (!validClaims(verified.payload) || !Number.isInteger(exp))
      throw new Error("Invalid bridge claims");
    tokenExpiresAt = exp as number;
    claims = verified.payload;
  } catch {
    return c.json({ error: "Invalid Savia bridge context" }, 401);
  }

  // The header carries a short-lived host credential. Keep its verified claims
  // in Hono's context, but remove the credential before any route can inspect
  // or persist request headers (for example, workflow HTTP trigger outputs).
  const downstreamHeaders = new Headers(c.req.raw.headers);
  downstreamHeaders.delete("x-savia-flows-context");
  c.req.raw = new Request(c.req.raw, { headers: downstreamHeaders });

  const organizationIdFromUrl = c.req.param("organizationId");
  const routeOrganization = /^\/([^/]+)\//.exec(c.req.path)?.[1];
  const requestedOrganization =
    organizationIdFromUrl ??
    (routeOrganization?.startsWith("tenant:") ? routeOrganization : undefined);
  if (
    requestedOrganization &&
    requestedOrganization !== claims.organization?.id
  ) {
    return c.json(
      { error: "Organization does not match Savia bridge context" },
      403,
    );
  }
  if (!organizationIdFromUrl && claims.organization) {
    c.set("organizationId", claims.organization.id);
  } else if (organizationIdFromUrl) {
    c.set("organizationId", organizationIdFromUrl);
  }
  const payload: JWTTokenPayload = {
    sub: claims.sub,
    name: claims.name,
    ...(claims.email ? { email: claims.email } : {}),
    role:
      claims.platformAdmin ||
      ["agency_admin", "tenant_admin", "admin", "owner"].includes(
        claims.organization?.role ?? "",
      )
        ? "admin"
        : "member",
    developerMode: false,
    organization: claims.organization
      ? {
          id: claims.organization.id,
          name: claims.organization.name,
          role:
            claims.platformAdmin ||
            ["agency_admin", "tenant_admin", "admin"].includes(
              claims.organization.role,
            )
              ? "admin"
              : claims.organization.role === "owner"
                ? "owner"
                : "member",
        }
      : { id: "", name: "", role: "member" },
    provider: "savia",
  };
  c.set("jwtPayload", payload);
  c.set("saviaBridge", true);
  c.set("saviaBridgePlatformAdmin", claims.platformAdmin);
  c.set("saviaBridgeExpiresAt", tokenExpiresAt);

  if (claims.organization) {
    const db = createDatabase(c.env.DB);
    const email = claims.email?.trim() || null;
    const [emailOwner] = email
      ? await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, email))
          .limit(1)
      : [];
    const safeEmail = emailOwner && emailOwner.id !== claims.sub ? null : email;
    const role = claims.platformAdmin
      ? ("admin" as const)
      : claims.organization.role === "owner"
        ? ("owner" as const)
        : ["admin", "agency_admin", "tenant_admin"].includes(
              claims.organization.role,
            )
          ? ("admin" as const)
          : ("member" as const);
    const now = new Date();
    await db.batch([
      db
        .insert(organizations)
        .values({
          id: claims.organization.id,
          name: claims.organization.name,
          computeCredits: 0,
          creditsExhausted: true,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: organizations.id,
          set: { name: claims.organization.name, updatedAt: now },
        }),
      db
        .insert(users)
        .values({
          id: claims.sub,
          name: claims.name,
          email: safeEmail,
          organizationId: claims.organization.id,
          role: "user",
          developerMode: false,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: users.id,
          set: {
            name: claims.name,
            email: safeEmail,
            organizationId: claims.organization.id,
            role: "user",
            developerMode: false,
            updatedAt: now,
          },
        }),
      db
        .insert(memberships)
        .values({
          userId: claims.sub,
          organizationId: claims.organization.id,
          role,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [memberships.userId, memberships.organizationId],
          set: { role, updatedAt: now },
        }),
    ]);
  }
  if (c.req.path.startsWith("/oauth/")) {
    return c.json(
      {
        error: {
          code: "EXTERNAL_SERVICES_DISABLED",
          message:
            "External provider connections are disabled in local Savia Flows.",
        },
      },
      503,
    );
  }
  if (
    c.req.path.endsWith("/integrations/providers") &&
    ["GET", "HEAD"].includes(c.req.method)
  ) {
    return c.json({ providers: [] });
  }
  if (
    /\/(?:integrations|bots)(?:\/|$)/.test(c.req.path) &&
    !["GET", "HEAD"].includes(c.req.method)
  ) {
    return c.json(
      {
        error: {
          code: "EXTERNAL_SERVICES_DISABLED",
          message:
            "External provider connections are disabled in local Savia Flows.",
        },
      },
      503,
    );
  }
  await next();
};

export function isSaviaBridgeRequest(c: Context<ApiContext>): boolean {
  return c.get("saviaBridge") === true;
}

export function isSaviaBridgePlatformAdmin(c: Context<ApiContext>): boolean {
  return isSaviaBridgeRequest(c) && c.get("saviaBridgePlatformAdmin") === true;
}
