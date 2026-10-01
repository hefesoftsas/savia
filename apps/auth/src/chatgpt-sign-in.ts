import {
  genericOAuth,
  type GenericOAuthConfig,
} from "better-auth/plugins/generic-oauth";
import { decodeJwt } from "jose";

export const CHATGPT_ISSUER = "https://auth.openai.com";
export type ChatGPTEnvironment = {
  SAVIA_CHATGPT_CLIENT_ID?: string;
  SAVIA_CHATGPT_CLIENT_SECRET?: string;
  SAVIA_CHATGPT_TOKEN_AUTH_METHOD?: string;
};

/** Only a registered website client can enable this provider. */
export function chatgptOAuthConfiguration(
  environment: ChatGPTEnvironment,
): GenericOAuthConfig<"chatgpt"> | null {
  const clientId = environment.SAVIA_CHATGPT_CLIENT_ID?.trim();
  const clientSecret = environment.SAVIA_CHATGPT_CLIENT_SECRET?.trim();
  const method = environment.SAVIA_CHATGPT_TOKEN_AUTH_METHOD?.trim() || "none";
  if (!clientId && !clientSecret && method === "none") return null;
  if (!clientId || !/^oaiapp_[A-Za-z0-9_-]+$/.test(clientId))
    throw new Error(
      "ChatGPT sign-in requires an approved website OAuth client ID",
    );
  if (
    !["none", "client_secret_post", "client_secret_basic"].includes(method) ||
    (method === "none" ? !!clientSecret : !clientSecret)
  )
    throw new Error(
      "Configure ChatGPT's registered token authentication method and matching credentials",
    );
  return {
    providerId: "chatgpt",
    name: "ChatGPT",
    clientId,
    ...(clientSecret ? { clientSecret } : {}),
    tokenEndpointAuth: {
      method: method as "none" | "client_secret_post" | "client_secret_basic",
    },
    discoveryUrl: `${CHATGPT_ISSUER}/.well-known/openid-configuration`,
    authorizationUrl: `${CHATGPT_ISSUER}/api/accounts/authorize`,
    tokenUrl: `${CHATGPT_ISSUER}/api/accounts/oauth/token`,
    requireIdTokenVerification: true,
    scopes: ["openid", "profile", "email"],
    pkce: true,
    disableProviderLogout: true,
    disableSignUp: false,
    accountSubject: ({ profile }) => {
      if (typeof profile.id !== "string" || !/^[a-f0-9]{64}$/.test(profile.id))
        throw new Error("Invalid ChatGPT identity");
      return profile.id;
    },
    async getUserInfo(tokens) {
      // The generic provider verifies signature, audience, expiry and nonce first.
      // The Savia proof wrapper also requires both ID token and expected nonce.
      if (!tokens.idToken) throw new Error("ChatGPT ID token required");
      return chatgptIdentity(decodeJwt(tokens.idToken), clientId);
    },
  };
}

export async function chatgptIdentity(
  profile: Record<string, unknown>,
  clientId: string,
) {
  const now = Math.floor(Date.now() / 1000);
  if (
    typeof profile.iat !== "number" ||
    !Number.isFinite(profile.iat) ||
    profile.iat > now + 60 ||
    typeof profile.exp !== "number" ||
    !Number.isFinite(profile.exp) ||
    profile.exp <= now ||
    profile.iss !== CHATGPT_ISSUER ||
    typeof profile.sub !== "string" ||
    !profile.sub.trim() ||
    profile.sub.length > 512 ||
    typeof profile.email !== "string" ||
    profile.email.length > 254 ||
    !/^\S+@\S+\.\S+$/.test(profile.email) ||
    /[\r\n<>]/.test(profile.email)
  )
    throw new Error("Invalid ChatGPT identity");
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify([CHATGPT_ISSUER, clientId, profile.sub]),
      ),
    ),
  );
  return {
    id: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    ),
    sub: profile.sub,
    iss: CHATGPT_ISSUER,
    clientId,
    email: profile.email.trim().toLowerCase(),
    emailVerified: profile.email_verified === true,
    name:
      typeof profile.name === "string" && profile.name.trim()
        ? profile.name.slice(0, 200)
        : profile.email.split("@")[0],
    image: undefined,
  };
}

export function chatgptOAuthPlugins(environment: ChatGPTEnvironment) {
  const configuration = chatgptOAuthConfiguration(environment);
  return configuration ? [genericOAuth({ config: [configuration] })] : [];
}
