export type PublicAuthUrls = {
  personalApiKeyDeploymentId?: string | null;
  authorizationUrl: string;
  tokenUrl: string;
};

export function publicAuthUrls(
  requestUrl: string,
  explicitOrigin?: string,
): PublicAuthUrls {
  const origin = new URL(explicitOrigin ?? requestUrl).origin;
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(
    new URL(requestUrl).hostname,
  );
  return {
    personalApiKeyDeploymentId: explicitOrigin || local ? origin : null,
    authorizationUrl: new URL("/api/auth/oauth2/authorize", origin).toString(),
    tokenUrl: new URL("/api/auth/oauth2/token", origin).toString(),
  };
}
