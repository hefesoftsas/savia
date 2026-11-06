import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AuthService } from "../auth/better-auth";
import { actorFromContext } from "../auth/middleware";

const maxAvatarBytes = 2 * 1024 * 1024;
const avatarTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const versionPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BetterAuthSession = {
  user: {
    id: string;
    image: string | null;
  } | null;
};

class AccountAvatarError extends Error {
  constructor(
    readonly status: 400 | 401 | 404 | 502 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function errorResponse(error: AccountAvatarError): Response {
  return Response.json(
    { error: { code: error.code, message: error.message } },
    { status: error.status },
  );
}

function objectKey(userId: string, version: string): string {
  return `avatars/${encodeURIComponent(userId)}/${version}`;
}

function versionFromImage(image: string | null): string | undefined {
  if (!image) return undefined;
  try {
    const url = new URL(image);
    const version = url.searchParams.get("v");
    return url.pathname === "/v1/account/avatar" &&
      version &&
      versionPattern.test(version)
      ? version
      : undefined;
  } catch {
    return undefined;
  }
}

function avatarUrl(requestUrl: string, version: string): string {
  const url = new URL("/v1/account/avatar", requestUrl);
  url.searchParams.set("v", version);
  return url.toString();
}

function fileFrom(value: unknown): File | undefined {
  if (!value || typeof value !== "object" || !("arrayBuffer" in value)) {
    return undefined;
  }
  return value as File;
}

async function activeSession(
  service: AuthService,
  request: Request,
): Promise<BetterAuthSession["user"]> {
  const headers = new Headers({ accept: "application/json" });
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  const response = await service.fetch(
    new Request("https://savia-auth.internal/api/auth/get-session", {
      headers,
    }),
  );
  if (!response.ok) {
    throw new AccountAvatarError(
      503,
      "AUTHENTICATION_UNAVAILABLE",
      "No fue posible consultar tu sesión.",
    );
  }
  const payload = (await response.json().catch(() => undefined)) as
    BetterAuthSession | undefined;
  const user = payload?.user;
  if (!user || typeof user.id !== "string") {
    throw new AccountAvatarError(
      401,
      "AUTHENTICATION_REQUIRED",
      "Debes iniciar sesión para gestionar tu avatar.",
    );
  }
  return {
    id: user.id,
    image: typeof user.image === "string" ? user.image : null,
  };
}

async function updateAvatar(
  service: AuthService,
  request: Request,
  image: string | null,
): Promise<void> {
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json",
  });
  // Preserve the browser's origin so Better Auth can validate cookie-based writes.
  for (const name of ["origin", "referer", "sec-fetch-site"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  const response = await service.fetch(
    new Request("https://savia-auth.internal/api/auth/update-user", {
      method: "POST",
      headers,
      body: JSON.stringify({ image }),
    }),
  );
  if (!response.ok) {
    throw new AccountAvatarError(
      502,
      "AVATAR_UPDATE_FAILED",
      "No fue posible guardar el avatar de tu cuenta.",
    );
  }
}

function dependencies(
  documents: R2Bucket | undefined,
  authService: AuthService | undefined,
): { documents: R2Bucket; authService: AuthService } {
  if (!documents || !authService) {
    throw new AccountAvatarError(
      503,
      "AVATAR_UNAVAILABLE",
      "La carga de avatares no está disponible en este momento.",
    );
  }
  return { documents, authService };
}

async function sessionForRequest(
  request: Request,
  service: AuthService,
  subject: string,
): Promise<NonNullable<BetterAuthSession["user"]>> {
  const session = await activeSession(service, request);
  if (!session || session.id !== subject) {
    throw new AccountAvatarError(
      401,
      "AUTHENTICATION_REQUIRED",
      "Tu sesión ya no corresponde a esta cuenta.",
    );
  }
  return session;
}

export function registerAccountAvatarRoutes(
  app: OpenAPIHono,
  documents: R2Bucket | undefined,
  authService: AuthService | undefined,
): void {
  app.get("/v1/account/avatar", async (context) => {
    try {
      const { documents: bucket, authService: service } = dependencies(
        documents,
        authService,
      );
      const actor = actorFromContext(context);
      const session = await sessionForRequest(
        context.req.raw,
        service,
        actor.principal.subject,
      );
      const version = versionFromImage(session.image);
      if (!version) {
        throw new AccountAvatarError(
          404,
          "AVATAR_NOT_FOUND",
          "No tienes un avatar guardado.",
        );
      }
      const object = await bucket.get(objectKey(session.id, version));
      if (!object) {
        throw new AccountAvatarError(
          404,
          "AVATAR_NOT_FOUND",
          "No tienes un avatar guardado.",
        );
      }
      const headers = new Headers({
        "cache-control": "private, no-store",
        "content-length": String(object.size),
        "content-type":
          object.httpMetadata?.contentType ?? "application/octet-stream",
        "x-content-type-options": "nosniff",
      });
      return new Response(object.body, { headers });
    } catch (error) {
      if (error instanceof AccountAvatarError) return errorResponse(error);
      throw error;
    }
  });

  app.put("/v1/account/avatar", async (context) => {
    try {
      const { documents: bucket, authService: service } = dependencies(
        documents,
        authService,
      );
      const actor = actorFromContext(context);
      const session = await sessionForRequest(
        context.req.raw,
        service,
        actor.principal.subject,
      );
      const form = await context.req.formData().catch(() => undefined);
      const file = fileFrom(form?.get("file") ?? null);
      if (
        !file ||
        !avatarTypes.has(file.type) ||
        file.size < 1 ||
        file.size > maxAvatarBytes
      ) {
        throw new AccountAvatarError(
          400,
          "INVALID_AVATAR",
          "Usa una imagen JPG, PNG o WebP de hasta 2 MB.",
        );
      }

      const version = crypto.randomUUID();
      const key = objectKey(session.id, version);
      await bucket.put(key, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type },
      });
      try {
        await updateAvatar(
          service,
          context.req.raw,
          avatarUrl(context.req.url, version),
        );
      } catch (error) {
        await bucket.delete(key);
        throw error;
      }

      const previousVersion = versionFromImage(session.image);
      if (previousVersion && previousVersion !== version) {
        try {
          await bucket.delete(objectKey(session.id, previousVersion));
        } catch (error) {
          console.error("Unable to delete replaced account avatar", error);
        }
      }
      return context.body(null, 204);
    } catch (error) {
      if (error instanceof AccountAvatarError) return errorResponse(error);
      throw error;
    }
  });

  app.delete("/v1/account/avatar", async (context) => {
    try {
      const { documents: bucket, authService: service } = dependencies(
        documents,
        authService,
      );
      const actor = actorFromContext(context);
      const session = await sessionForRequest(
        context.req.raw,
        service,
        actor.principal.subject,
      );
      const previousVersion = versionFromImage(session.image);
      await updateAvatar(service, context.req.raw, null);
      if (previousVersion) {
        try {
          await bucket.delete(objectKey(session.id, previousVersion));
        } catch (error) {
          console.error("Unable to delete removed account avatar", error);
        }
      }
      return context.body(null, 204);
    } catch (error) {
      if (error instanceof AccountAvatarError) return errorResponse(error);
      throw error;
    }
  });
}
