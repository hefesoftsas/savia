import { APIError } from "better-auth/api";
import { authNoticeBridgeAuthorized } from "./notification-events";
import { assertPasswordAllowed, type TenantSSOAdapter } from "./tenant-sso";
import { assertTenantAuthenticationActive } from "./tenant-auth-state";

export type SocialRegistrationAttempt = {
  attemptId: string;
  tenantId: number;
  provider: "google" | "microsoft";
  revision: string;
  returnOrigin: string;
  expiresAt: number;
};
export const REGISTRATION_PREFIX = "savia-social-registration:";
type Settings = {
  active: boolean;
  allowRegistration: boolean;
  googleEnabled: boolean;
  microsoftEnabled: boolean;
  revision: string;
};
const denied = () =>
  new APIError("FORBIDDEN", {
    message: "Federated registration is not available for this tenant",
  });

async function policy(
  adapter: TenantSSOAdapter,
  tenantId: number,
  provider: SocialRegistrationAttempt["provider"],
) {
  const settings = await adapter.findOne<Settings>({
    model: "tenantSocialSettings",
    where: [{ field: "tenantId", value: tenantId }],
  });
  if (
    !settings?.active ||
    settings.allowRegistration !== true ||
    !(provider === "google"
      ? settings.googleEnabled
      : settings.microsoftEnabled)
  )
    return null;
  await assertTenantAuthenticationActive(adapter, tenantId);
  await assertPasswordAllowed(adapter, {
    email: "",
    emailVerified: true,
    emailTenantId: tenantId,
    role: "user",
  });
  return settings;
}

export async function beginSocialRegistration(
  request: Request,
  provider: SocialRegistrationAttempt["provider"],
  environment: { SAVIA_INTERNAL_BRIDGE_KEY?: string },
  adapter: TenantSSOAdapter,
): Promise<SocialRegistrationAttempt | null> {
  if (
    !authNoticeBridgeAuthorized(environment.SAVIA_INTERNAL_BRIDGE_KEY, request)
  )
    return null;
  const tenantId = Number(request.headers.get("x-savia-social-tenant-id"));
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) return null;
  const settings = await policy(adapter, tenantId, provider);
  if (!settings) return null;
  const attempt: SocialRegistrationAttempt = {
    attemptId: crypto.randomUUID(),
    tenantId,
    provider,
    revision: settings.revision,
    returnOrigin: new URL(request.url).origin,
    expiresAt: Date.now() + 600_000,
  };
  await adapter.create({
    model: "verification",
    data: {
      identifier: REGISTRATION_PREFIX + attempt.attemptId,
      value: JSON.stringify(attempt),
      expiresAt: new Date(attempt.expiresAt),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  return attempt;
}

export async function readSocialRegistration(
  adapter: TenantSSOAdapter,
  state: {
    serverContext?: Record<string, unknown>;
    callbackURL?: string;
  } | null,
  provider: SocialRegistrationAttempt["provider"],
): Promise<SocialRegistrationAttempt | null> {
  const id = state?.serverContext?.socialAttemptId;
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) return null;
  const record = await adapter.findOne<{ value: string; expiresAt: Date }>({
    model: "verification",
    where: [{ field: "identifier", value: REGISTRATION_PREFIX + id }],
  });
  if (!record || new Date(record.expiresAt).getTime() <= Date.now())
    throw denied();
  const attempt = JSON.parse(record.value) as SocialRegistrationAttempt;
  if (attempt.attemptId !== id || attempt.provider !== provider) return null;
  if (
    !state?.callbackURL ||
    new URL(state.callbackURL).origin !== attempt.returnOrigin
  )
    throw denied();
  if (attempt.expiresAt <= Date.now()) throw denied();
  const settings = await policy(adapter, attempt.tenantId, provider);
  if (!settings || settings.revision !== attempt.revision) throw denied();
  return attempt;
}
