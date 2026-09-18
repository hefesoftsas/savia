import type { UserIdentity } from "ra-core";
import { isOfflineError } from "../offline/offline-error";
import type { AuthPermissions, AuthSession } from "./auth-session";

export type BrowserNavigation = {
  currentUrl(): string;
  redirect(url: string): void;
};

export type BetterAuthOAuthSettings = {
  apiUrl: string;
  fetcher?: typeof fetch;
  navigation?: BrowserNavigation;
};

type OAuthTokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  token_type?: unknown;
};

type IdentityResponse = {
  data?: {
    id?: unknown;
    attributes?: {
      displayName?: unknown;
      email?: unknown;
      globalRoles?: unknown;
    };
    relationships?: {
      memberships?: unknown;
    };
  };
};

type BetterAuthSessionResponse = {
  user?: {
    image?: unknown;
  } | null;
};

type SaviaIdentity = {
  id: string;
  attributes: {
    displayName: string;
    email?: unknown;
    globalRoles?: unknown;
  };
  relationships?: {
    memberships?: unknown;
  };
};

function requestUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl.replace(/\/$/, "")}/`).toString();
}

function defaultNavigation(): BrowserNavigation {
  return {
    currentUrl: () => window.location.href,
    redirect: (url) => window.location.assign(url),
  };
}

async function responseMessage(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => undefined)) as {
    error?: { message?: unknown };
  } | undefined;
  return typeof payload?.error?.message === "string"
    ? payload.error.message
    : response.statusText || "No fue posible completar el inicio de sesión.";
}

function readToken(payload: OAuthTokenResponse): {
  accessToken: string;
  expiresAt: number;
  scopes: Set<string>;
} {
  if (
    typeof payload.access_token !== "string" ||
    payload.access_token.length === 0 ||
    (payload.token_type !== undefined && payload.token_type !== "Bearer")
  ) {
    throw new Error("Better Auth no devolvió un token de acceso válido.");
  }
  return {
    accessToken: payload.access_token,
    expiresAt:
      typeof payload.expires_in === "number" &&
      Number.isFinite(payload.expires_in) &&
      payload.expires_in > 0
        ? Date.now() + payload.expires_in * 1_000
        : Number.POSITIVE_INFINITY,
    scopes:
      typeof payload.scope === "string"
        ? new Set(payload.scope.split(/\s+/).filter(Boolean))
        : new Set(),
  };
}

export class BetterAuthOAuthSession implements AuthSession {
  private accessToken: string | null = null;

  private accessTokenExpiresAt = 0;

  private scopes = new Set<string>();

  private callbackPromise: Promise<void> | null = null;

  private refreshPromise: Promise<void> | null = null;

  private refreshAllowed = true;

  private identityPromise: Promise<SaviaIdentity> | null = null;

  /**
   * Last fully-resolved permissions, memory-only (never persisted: tokens
   * and credentials stay out of browser storage). Returned when the network
   * drops so cached reads and navigation keep working offline.
   */
  private lastKnownPermissions: AuthPermissions | undefined;

  private readonly fetcher: typeof fetch;

  private readonly navigation: BrowserNavigation;

  constructor(private readonly settings: BetterAuthOAuthSettings) {
    this.fetcher =
      settings.fetcher ?? ((input, init) => globalThis.fetch(input, init));
    this.navigation = settings.navigation ?? defaultNavigation();
  }

  getAuthorizeUrl(): string {
    return requestUrl(this.settings.apiUrl, "/api/auth/admin/authorize");
  }

  async login(): Promise<void> {
    this.navigation.redirect(this.getAuthorizeUrl());
  }

  async logout(): Promise<string> {
    await this.clearSession();
    try {
      await this.fetcher(
        requestUrl(this.settings.apiUrl, "/api/auth/admin/logout"),
        {
          method: "POST",
          credentials: "include",
          headers: { Accept: "application/json" },
        },
      );
    } catch {
      // Ignored to guarantee the user is redirected even if the network or endpoint fails
    }
    return this.getAuthorizeUrl();
  }

  async clearSession(): Promise<void> {
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
    this.scopes.clear();
    this.callbackPromise = null;
    this.identityPromise = null;
    this.lastKnownPermissions = undefined;
    this.refreshAllowed = false;
  }

  async handleCallback(): Promise<void> {
    if (!this.callbackPromise) {
      this.callbackPromise = this.exchangeCallback().catch(
        (exception: unknown) => {
          this.callbackPromise = null;
          throw exception;
        },
      );
    }
    await this.callbackPromise;
  }

  async getAccessToken(): Promise<string | null> {
    if (
      (!this.accessToken || Date.now() >= this.accessTokenExpiresAt - 30_000) &&
      this.refreshAllowed
    ) {
      await this.refreshAccessToken();
    }
    return this.accessToken;
  }

  async getIdentity(): Promise<UserIdentity> {
    const accessToken = await this.requireAccessToken();
    const identity = await this.saviaIdentity(accessToken);
    const avatar = await this.sessionAvatar();
    return {
      id: identity.id,
      fullName: identity.attributes.displayName,
      ...(typeof identity.attributes.email === "string"
        ? { email: identity.attributes.email }
        : {}),
      ...(avatar ? { avatar } : {}),
    };
  }

  async getPermissions(): Promise<AuthPermissions> {
    let signedIn = false;
    try {
      signedIn = Boolean(await this.getAccessToken());
    } catch (exception) {
      // A dropped network must not hide every resource: fall back to the
      // last known permissions so cached reads stay visible offline.
      if (isOfflineError(exception) && this.lastKnownPermissions) {
        return this.lastKnownPermissions;
      }
      throw exception;
    }
    const canWrite = signedIn && this.scopes.has("savia.api.write");
    let identity: SaviaIdentity | undefined;
    if (signedIn && this.accessToken) {
      try {
        identity = await this.saviaIdentity(this.accessToken);
      } catch (exception) {
        if (isOfflineError(exception) && this.lastKnownPermissions) {
          return this.lastKnownPermissions;
        }
        identity = undefined;
      }
    }
    let canManageIdentity = false;
    if (canWrite && identity) {
      canManageIdentity = Array.isArray(identity.attributes?.globalRoles)
        ? identity.attributes.globalRoles.includes("platform_admin")
        : false;
    }
    const permissions = {
      canReadDocuments: signedIn && this.scopes.has("savia.api.read"),
      canExecuteCommands: canWrite,
      canManageIdentity,
      memberships: identity ? activeMemberships(identity) : [],
    };
    if (identity) this.lastKnownPermissions = permissions;
    return permissions;
  }

  async checkSession(): Promise<void> {
    await this.requireAccessToken();
  }

  private async exchangeCallback(): Promise<void> {
    const callback = new URL(this.navigation.currentUrl());
    const code = callback.searchParams.get("code");
    const state = callback.searchParams.get("state");
    if (!code || !state) {
      throw new Error(
        "La respuesta de Better Auth no contiene código y estado.",
      );
    }
    const response = await this.fetcher(
      requestUrl(this.settings.apiUrl, "/api/auth/admin/callback"),
      {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code, state }),
      },
    );
    if (!response.ok) throw new Error(await responseMessage(response));
    this.applyToken(readToken((await response.json()) as OAuthTokenResponse));
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshPromise) {
      this.refreshPromise = (async () => {
        let response: Response;
        try {
          response = await this.fetcher(
            requestUrl(this.settings.apiUrl, "/api/auth/admin/refresh"),
            {
              method: "POST",
              credentials: "include",
              headers: { Accept: "application/json" },
            },
          );
        } catch (exception) {
          // The network dropped mid-refresh: keep the stale token instead
          // of wiping the session. Reads keep serving the persisted cache
          // and checkSession still resolves, so the app never "logs out"
          // just because the network did.
          if (isOfflineError(exception)) return;
          throw exception;
        }
        if (!response.ok) {
          this.accessToken = null;
          this.accessTokenExpiresAt = 0;
          this.scopes.clear();
          this.refreshAllowed = false;
          throw new Error(await responseMessage(response));
        }
        this.applyToken(
          readToken((await response.json()) as OAuthTokenResponse),
        );
      })().finally(() => {
        this.refreshPromise = null;
      });
    }
    await this.refreshPromise;
  }

  private applyToken(token: {
    accessToken: string;
    expiresAt: number;
    scopes: Set<string>;
  }): void {
    if (this.accessToken !== token.accessToken) this.identityPromise = null;
    this.accessToken = token.accessToken;
    this.accessTokenExpiresAt = token.expiresAt;
    this.scopes = token.scopes;
    this.refreshAllowed = true;
  }

  private async requireAccessToken(): Promise<string> {
    const token = await this.getAccessToken();
    if (!token) throw new Error("Authentication is required");
    return token;
  }

  private async sessionAvatar(): Promise<string | undefined> {
    try {
      const response = await this.fetcher(
        requestUrl(this.settings.apiUrl, "/api/auth/get-session"),
        {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
        },
      );
      if (!response.ok) return undefined;
      const payload = (await response.json()) as BetterAuthSessionResponse;
      return typeof payload.user?.image === "string" &&
        payload.user.image.length > 0
        ? payload.user.image
        : undefined;
    } catch {
      return undefined;
    }
  }

  private async saviaIdentity(accessToken: string): Promise<SaviaIdentity> {
    if (!this.identityPromise) {
      this.identityPromise = (async () => {
        const response = await this.fetcher(
          requestUrl(this.settings.apiUrl, "/v1/identity/me"),
          {
            method: "GET",
            credentials: "include",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
          },
        );
        if (!response.ok) throw new Error(await responseMessage(response));
        const identity = ((await response.json()) as IdentityResponse).data;
        if (
          !identity ||
          typeof identity.id !== "string" ||
          typeof identity.attributes?.displayName !== "string"
        ) {
          throw new Error("Savia devolvió una identidad inválida.");
        }
        return {
          id: identity.id,
          attributes: {
            displayName: identity.attributes.displayName,
            email: identity.attributes.email,
            globalRoles: identity.attributes.globalRoles,
          },
          relationships: identity.relationships,
        };
      })().catch((exception: unknown) => {
        this.identityPromise = null;
        throw exception;
      });
    }
    return this.identityPromise;
  }
}

function activeMemberships(identity: SaviaIdentity) {
  const memberships = identity.relationships?.memberships;
  if (!Array.isArray(memberships)) return [];
  return memberships.flatMap((membership) => {
    if (!membership || typeof membership !== "object") return [];
    const candidate = membership as {
      role?: unknown;
      attributes?: { isActive?: unknown };
      relationships?: { agency?: { id?: unknown }; tenant?: { id?: unknown } };
    };
    const agencyId = Number(candidate.relationships?.tenant?.id ?? candidate.relationships?.agency?.id);
    if (
      candidate.attributes?.isActive !== true ||
      typeof candidate.role !== "string" ||
      !Number.isSafeInteger(agencyId) ||
      agencyId < 1
    ) {
      return [];
    }
    return [{ agencyId, tenantId: agencyId, role: candidate.role }];
  });
}
