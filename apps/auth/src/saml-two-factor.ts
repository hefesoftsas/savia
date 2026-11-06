import { recordSAMLChallenge, samlSessionProof } from "./tenant-sso";
import { createAuthMiddleware } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";
import { recordSocialChallenge, socialSessionProof } from "./social-sign-in";

/** Extend Better Auth's local MFA enforcement to SAML and social OAuth callbacks. */
export function samlAwareTwoFactor() {
  const plugin = twoFactor({
    issuer: "Savia",
    twoFactorCookieMaxAge: 300,
    accountLockout: { maxFailedAttempts: 5, durationSeconds: 900 },
  });
  return {
    ...plugin,
    hooks: {
      ...plugin.hooks,
      after: plugin.hooks.after.map((hook) => ({
        ...hook,
        handler: createAuthMiddleware(async (context) => {
          const proof = samlSessionProof(context.context);
          const socialProof = socialSessionProof(context.context);
          const socialCallback =
            context.path?.startsWith("/callback/") === true;
          // Better Call returns an envelope with returnHeaders; the plugin declaration exposes only its JSON body.
          const result = (await hook.handler({
            ...context,
            returnHeaders: true,
          })) as unknown as {
            headers: Headers;
            response?: {
              twoFactorRedirect: boolean;
              twoFactorMethods: string[];
            };
          };
          result.headers.forEach((value, name) => {
            if (name.toLowerCase() !== "set-cookie")
              context.responseHeaders.set(name, value);
          });
          for (const cookie of result.headers.getSetCookie())
            context.responseHeaders.append("set-cookie", cookie);
          if (
            (socialCallback ||
              /^\/sso\/saml2\/sp\/acs\/[^/]+$/.test(context.path ?? "")) &&
            result.response?.twoFactorRedirect
          ) {
            const name = context.context.createAuthCookie("two_factor").name;
            const cookie = result.headers
              .getSetCookie()
              .find((value) => value.startsWith(name + "="));
            const signed = cookie
              ? decodeURIComponent(cookie.slice(name.length + 1).split(";")[0]!)
              : "";
            const challenge = signed.split(".")[0]!;
            if (!challenge.startsWith("2fa-"))
              throw new Error("Missing SAML MFA challenge");
            try {
              if (socialCallback) {
                if (!socialProof)
                  throw new Error("Missing social authentication proof");
                await recordSocialChallenge(
                  context.context.adapter,
                  challenge,
                  socialProof,
                );
              } else {
                if (!proof)
                  throw new Error("Missing SAML authentication proof");
                await recordSAMLChallenge(
                  context.context.adapter,
                  challenge,
                  proof,
                );
              }
            } catch (error) {
              await context.context.internalAdapter.deleteVerificationByIdentifier(
                challenge,
              );
              throw error;
            }
          }
          return result.response;
        }),
        matcher: (context: Parameters<typeof hook.matcher>[0]) =>
          hook.matcher(context) ||
          context.path?.startsWith("/callback/") === true ||
          /^\/sso\/saml2\/sp\/acs\/[^/]+$/.test(context.path ?? ""),
      })),
    },
  };
}

/** Browser provider callbacks must turn the JSON MFA challenge into a page redirect. */
export async function samlMFAResponse(
  request: Request,
  response: Response,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (
    !path.startsWith("/api/auth/sso/saml2/sp/acs/") &&
    !/^\/api\/auth\/callback\/(google|microsoft)$/.test(path)
  )
    return response;
  const result = (await response
    .clone()
    .json()
    .catch(() => null)) as { twoFactorRedirect?: boolean } | null;
  if (!result?.twoFactorRedirect) return response;
  const destination = new URL("/api/auth/login", request.url);
  const continuation = response.headers.get("location");
  if (continuation)
    destination.search = new URL(continuation, request.url).search;
  destination.searchParams.set("mode", "sso-mfa");
  const headers = new Headers(response.headers);
  headers.set("location", destination.href);
  headers.delete("content-type");
  headers.delete("content-length");
  headers.set("cache-control", "no-store");
  return new Response(null, { status: 302, headers });
}
