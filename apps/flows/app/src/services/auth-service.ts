import { AuthProvider, JWTTokenPayload } from "@savia/flows-types";
import { mutate } from "swr";
import { AUTH_USER_KEY } from "@/components/auth-context";
import { makeRequest } from "./utils";

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** Auth is a read-only view of the Savia host session. */
export const authService = {
  async checkAuth(): Promise<boolean> {
    try {
      return Boolean(
        (await makeRequest<{ ok: boolean }>("/auth/protected")).ok,
      );
    } catch {
      return false;
    }
  },
  async getCurrentUser(): Promise<JWTTokenPayload | null> {
    try {
      const response = await makeRequest<{ user: JWTTokenPayload }>(
        "/auth/user",
      );
      if (!response?.user?.sub || !response.user.name)
        throw new AuthError("Invalid Savia session response.");
      return response.user;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      return null;
    }
  },
  async refreshToken(): Promise<{
    success: boolean;
    user?: JWTTokenPayload;
    error?: string;
  }> {
    return { success: false, error: "Session renewal is managed by Savia." };
  },
  async loginWithProvider(
    _provider: AuthProvider,
    _returnTo?: string,
  ): Promise<void> {
    throw new AuthError("Sign in to Savia in the parent workspace.");
  },
  async logout(): Promise<void> {
    await mutate(AUTH_USER_KEY, null, { revalidate: false });
  },
  async logoutAllSessions(): Promise<void> {
    await mutate(AUTH_USER_KEY, null, { revalidate: false });
  },
} as const;
