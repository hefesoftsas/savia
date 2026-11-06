import type { AuthService } from "./better-auth";
import {
  createOAuthResourceAuthenticator,
  serviceBoundOAuthAccessTokenVerifier,
  type OAuthResourceAuthenticator,
} from "./oauth-resource";
type AuthServiceBinding = {
  AUTH?: AuthService;
  SAVIA_API_RESOURCE?: string;
  SAVIA_OAUTH_ISSUER?: string;
};
export function oauthResourceAuthenticator(
  environment: AuthServiceBinding,
): OAuthResourceAuthenticator | undefined {
  if (!environment.SAVIA_OAUTH_ISSUER || !environment.SAVIA_API_RESOURCE) {
    return undefined;
  }
  return createOAuthResourceAuthenticator({
    issuer: environment.SAVIA_OAUTH_ISSUER,
    resource: environment.SAVIA_API_RESOURCE,
    verifyAccessToken: environment.AUTH
      ? serviceBoundOAuthAccessTokenVerifier(environment.AUTH)
      : undefined,
  });
}
