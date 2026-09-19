import type { Context, MiddlewareHandler } from "hono";
import type { Authenticator } from "./types";
import { AuthenticationError, type AppActor } from "./types";

export function authenticationErrorResponse(
  error: AuthenticationError,
): Response {
  const status =
    error.code === "AUTHENTICATION_UNAVAILABLE"
      ? 503
      : error.code === "AUTHORIZATION_FORBIDDEN" ||
          error.code === "INSUFFICIENT_SCOPE" ||
          error.code === "MFA_ENROLLMENT_REQUIRED"
        ? 403
        : 401;
  return Response.json(
    { error: { code: error.code, message: error.message } },
    { status },
  );
}

export function authenticationMiddleware(
  d1: D1Database,
  authenticator: Authenticator,
): MiddlewareHandler {
  return async (context, next) => {
    try {
      const actor = await authenticator.authenticate(context.req.raw, d1);
      (context as Context & { set(key: "actor", value: AppActor): void }).set(
        "actor",
        actor,
      );
      await next();
    } catch (exception) {
      if (exception instanceof AuthenticationError)
        return authenticationErrorResponse(exception);
      throw exception;
    }
  };
}

export function actorFromContext(context: Context): AppActor {
  const actor = (context as Context & { get(key: "actor"): AppActor }).get(
    "actor",
  );
  if (!actor) throw new Error("Authentication middleware did not set an actor");
  return actor;
}

export function requirePlatformAdministrator(actor: AppActor): void {
  if (actor.globalRoles.includes("platform_admin")) return;
  throw new AuthenticationError(
    "AUTHORIZATION_FORBIDDEN",
    "A platform administrator role is required",
  );
}
