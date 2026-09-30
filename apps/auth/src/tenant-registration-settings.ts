import {
  accountEmailAvailable,
  type AccountEmailDependencies,
  type AccountEmailEnvironment,
} from "./account-email";
import { authNoticeBridgeAuthorized } from "./notification-events";

export type TenantRegistrationSettings = {
  allowEmailRegistration: boolean;
  captchaMode: "inherit" | "tenant";
  siteKey: string;
  secretKey: string;
  revision: string;
};
const defaults: TenantRegistrationSettings = {
  allowEmailRegistration: false,
  captchaMode: "inherit",
  siteKey: "",
  secretKey: "",
  revision: "",
};
const table =
  "CREATE TABLE IF NOT EXISTS tenant_registration_settings (tenant_id INTEGER PRIMARY KEY, ciphertext TEXT NOT NULL, revision TEXT NOT NULL, updated_at TEXT NOT NULL)";
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (text: string) =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
async function key(env: AccountEmailEnvironment) {
  if (!env.BETTER_AUTH_SECRET?.trim())
    throw new Error("Registration settings encryption unavailable");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `savia:tenant-registration:v1:${env.BETTER_AUTH_SECRET.trim()}`,
    ),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
function aad(tenantId: number) {
  return new TextEncoder().encode(`tenant:${tenantId}`);
}
async function encrypt(
  env: AccountEmailEnvironment,
  tenantId: number,
  value: TenantRegistrationSettings,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(tenantId) },
    await key(env),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `${encode(iv)}.${encode(new Uint8Array(cipher))}`;
}
export async function readTenantRegistrationSettings(
  env: AccountEmailEnvironment,
  tenantId: number,
): Promise<TenantRegistrationSettings> {
  await env.AUTH_DB.exec(table);
  const row = await env.AUTH_DB.prepare(
    "SELECT ciphertext FROM tenant_registration_settings WHERE tenant_id=?",
  )
    .bind(tenantId)
    .first<{ ciphertext: string }>();
  if (!row) return { ...defaults };
  const parts = row.ciphertext.split(".");
  if (parts.length !== 2) throw new Error("Invalid registration settings");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decode(parts[0]), additionalData: aad(tenantId) },
    await key(env),
    decode(parts[1]),
  );
  const input = JSON.parse(
    new TextDecoder().decode(plain),
  ) as TenantRegistrationSettings;
  if (
    typeof input.allowEmailRegistration !== "boolean" ||
    !["inherit", "tenant"].includes(input.captchaMode) ||
    typeof input.secretKey !== "string" ||
    typeof input.siteKey !== "string" ||
    typeof input.revision !== "string"
  )
    throw new Error("Invalid registration settings");
  return input;
}
export async function tenantRegistrationSettingsResponse(
  request: Request,
  env: AccountEmailEnvironment,
  deps: AccountEmailDependencies,
): Promise<Response | null> {
  const match = new URL(request.url).pathname.match(
    /^\/_internal\/tenant-registration\/(\d+)(\/effective)?$/,
  );
  if (!match) return null;
  if (!authNoticeBridgeAuthorized(env.SAVIA_INTERNAL_BRIDGE_KEY, request))
    return json({ error: "Forbidden" }, 403);
  const tenantId = Number(match[1]);
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0)
    return json({ error: "Invalid tenant" }, 400);
  try {
    let settings = await readTenantRegistrationSettings(env, tenantId);
    const emailReady = await accountEmailAvailable(env, deps, tenantId).catch(
      () => false,
    );
    if (match[2] && request.method !== "GET")
      return json({ error: "Method not allowed" }, 405);
    if (request.method === "DELETE") {
      await env.AUTH_DB.prepare(
        "DELETE FROM tenant_registration_settings WHERE tenant_id=?",
      )
        .bind(tenantId)
        .run();
      settings = { ...defaults };
    } else if (request.method === "PUT") {
      const body = (await request.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      if (
        !body ||
        Object.keys(body).some(
          (k) =>
            ![
              "allowEmailRegistration",
              "captchaMode",
              "siteKey",
              "secretKey",
              "captchaReady",
            ].includes(k),
        ) ||
        typeof body.allowEmailRegistration !== "boolean" ||
        !["inherit", "tenant"].includes(String(body.captchaMode)) ||
        (body.siteKey !== undefined && typeof body.siteKey !== "string") ||
        (body.secretKey !== undefined &&
          body.secretKey !== null &&
          typeof body.secretKey !== "string")
      )
        return json({ error: "Invalid registration settings" }, 400);
      if (
        body.allowEmailRegistration &&
        (!emailReady || body.captchaReady !== true)
      )
        return json(
          {
            error:
              "Configure email delivery and CAPTCHA before enabling registration.",
          },
          400,
        );
      const next: TenantRegistrationSettings = {
        allowEmailRegistration: body.allowEmailRegistration,
        captchaMode: body.captchaMode as "inherit" | "tenant",
        siteKey:
          typeof body.siteKey === "string"
            ? body.siteKey.trim()
            : settings.siteKey,
        secretKey:
          body.secretKey === null
            ? ""
            : typeof body.secretKey === "string" && body.secretKey.trim()
              ? body.secretKey.trim()
              : settings.secretKey,
        revision: crypto.randomUUID(),
      };
      if (next.siteKey.length > 2048 || next.secretKey.length > 4096)
        return json({ error: "Invalid CAPTCHA credentials" }, 400);
      if (
        next.allowEmailRegistration &&
        next.captchaMode === "tenant" &&
        (!next.siteKey || !next.secretKey)
      )
        return json(
          {
            error:
              "Configure tenant CAPTCHA credentials before enabling registration.",
          },
          400,
        );
      await env.AUTH_DB.prepare(
        "INSERT INTO tenant_registration_settings(tenant_id,ciphertext,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET ciphertext=excluded.ciphertext,revision=excluded.revision,updated_at=excluded.updated_at",
      )
        .bind(
          tenantId,
          await encrypt(env, tenantId, next),
          next.revision,
          new Date().toISOString(),
        )
        .run();
      settings = next;
    } else if (request.method !== "GET")
      return json({ error: "Method not allowed" }, 405);
    const { secretKey, ...safe } = settings;
    return json({
      ...safe,
      secretConfigured: !!secretKey,
      emailReady,
      ...(match[2] ? { secretKey } : {}),
    });
  } catch {
    return json(
      {
        error:
          "Registration settings unavailable. Check server encryption and stored configuration.",
      },
      503,
    );
  }
}
