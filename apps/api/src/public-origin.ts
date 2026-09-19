export type PublicAuthUrls = {
  authorizationUrl: string;
  tokenUrl: string;
};

export function publicAuthUrls(
  requestUrl: string,
  explicitOrigin?: string,
): PublicAuthUrls {
  const origin = new URL(explicitOrigin ?? requestUrl).origin;
  return {
    authorizationUrl: new URL("/api/auth/oauth2/authorize", origin).toString(),
    tokenUrl: new URL("/api/auth/oauth2/token", origin).toString(),
  };
}
