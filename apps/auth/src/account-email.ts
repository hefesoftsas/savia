import type { SMTPEmail, SMTPSettings } from "./smtp";
import { deliverSmtpEmail } from "./smtp";

export type AccountEmailEnvironment = {
  AUTH_DB: D1Database;
  BETTER_AUTH_SECRET?: string;
  SAVIA_INTERNAL_BRIDGE_KEY?: string;
  SAVIA_SMTP_HOST?: string;
  SAVIA_SMTP_PORT?: string;
  SAVIA_SMTP_USERNAME?: string;
  SAVIA_SMTP_PASSWORD?: string;
  SAVIA_SMTP_FROM?: string;
  SAVIA_SMTP_SECURITY?: "tls" | "starttls" | "plain";
  SAVIA_SMTP_ALLOW_INSECURE?: string;
};

export type TenantSMTPSettings = SMTPSettings & {
  security: "tls" | "starttls";
};

export type AccountEmailDependencies = {
  sendTransactionalEmail?: (email: SMTPEmail) => Promise<void>;
  deliverEmail?: (settings: SMTPSettings, email: SMTPEmail) => Promise<void>;
};

type StoredSettings = {
  tenant_id: number;
  ciphertext: string;
};

const CREATE_TABLE =
  "CREATE TABLE IF NOT EXISTS tenant_email_settings (tenant_id INTEGER PRIMARY KEY, ciphertext TEXT NOT NULL, updated_at TEXT NOT NULL)";

function validAddress(value: string): boolean {
  return (
    /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value) && !/[\r\n]/.test(value)
  );
}

function validHost(host: string): boolean {
  const value = host.trim().toLowerCase();
  if (!value || value.length > 253 || /[\s/@?#\\]/.test(value)) return false;
  if (
    value === "localhost" ||
    value.endsWith(".localhost") ||
    value.endsWith(".local") ||
    value.endsWith(".internal")
  )
    return false;
  if (value.includes(":")) return false;
  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4 && (/^[0-9.]+$/.test(value) || /^0x[0-9a-f]+$/i.test(value)))
    return false;
  if (!ipv4 && !value.includes(".")) return false;
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    const [a, b] = octets;
    if (octets.some((part) => part < 0 || part > 255)) return false;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
  }
  return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value);
}

export function parseTenantSMTPSettings(value: unknown): TenantSMTPSettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid email settings");
  const input = value as Record<string, unknown>;
  const host = typeof input.host === "string" ? input.host.trim() : "";
  const port = Number(input.port);
  const from = typeof input.from === "string" ? input.from.trim() : "";
  const username =
    typeof input.username === "string" ? input.username.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const security = input.security;
  if (!validHost(host))
    throw new Error("SMTP host must be a public hostname or address");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("SMTP port must be between 1 and 65535");
  if (!validAddress(from))
    throw new Error("Enter a valid sender email address");
  if ((username.length === 0) !== (password.length === 0))
    throw new Error("SMTP username and password must be set together");
  if (
    username.length > 255 ||
    /[\r\n]/.test(username) ||
    password.length > 4096 ||
    /[\r\n]/.test(password)
  )
    throw new Error("Invalid SMTP credentials");
  if (security !== "tls" && security !== "starttls")
    throw new Error("Choose TLS or STARTTLS");
  return { host, port, username, password, from, security };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function arrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(value.byteLength);
  new Uint8Array(copy).set(value);
  return copy;
}

async function encryptionKey(
  environment: AccountEmailEnvironment,
): Promise<CryptoKey> {
  const secret = environment.BETTER_AUTH_SECRET?.trim();
  if (!secret) throw new Error("Email settings encryption is unavailable");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`savia:tenant-email:v1:${secret}`),
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encrypt(
  environment: AccountEmailEnvironment,
  tenantId: number,
  settings: TenantSMTPSettings,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(settings));
  const cipher = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: arrayBuffer(iv),
      additionalData: arrayBuffer(
        new TextEncoder().encode(`tenant:${tenantId}`),
      ),
    },
    await encryptionKey(environment),
    arrayBuffer(data),
  );
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(cipher))}`;
}

async function decrypt(
  environment: AccountEmailEnvironment,
  tenantId: number,
  ciphertext: string,
): Promise<TenantSMTPSettings> {
  const [ivText, cipherText, extra] = ciphertext.split(".");
  if (!ivText || !cipherText || extra !== undefined)
    throw new Error("Stored email settings are invalid");
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: arrayBuffer(base64ToBytes(ivText)),
      additionalData: arrayBuffer(
        new TextEncoder().encode(`tenant:${tenantId}`),
      ),
    },
    await encryptionKey(environment),
    arrayBuffer(base64ToBytes(cipherText)),
  );
  return parseTenantSMTPSettings(
    JSON.parse(new TextDecoder().decode(plaintext)),
  );
}

async function readSettings(
  environment: AccountEmailEnvironment,
  tenantId: number,
): Promise<TenantSMTPSettings | undefined> {
  const row = await environment.AUTH_DB.prepare(
    "SELECT tenant_id,ciphertext FROM tenant_email_settings WHERE tenant_id=?",
  )
    .bind(tenantId)
    .first<StoredSettings>();
  return row ? decrypt(environment, tenantId, row.ciphertext) : undefined;
}

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function redacted(settings: TenantSMTPSettings | undefined): unknown {
  if (!settings) return { configured: false };
  return {
    configured: true,
    host: settings.host,
    port: settings.port,
    username: settings.username,
    from: settings.from,
    security: settings.security,
    passwordConfigured: !!settings.password,
  };
}

function bridgeAuthorized(
  request: Request,
  environment: AccountEmailEnvironment,
): boolean {
  const configured = environment.SAVIA_INTERNAL_BRIDGE_KEY?.trim();
  const provided = request.headers.get("x-savia-bridge-key")?.trim();
  return !!configured && !!provided && configured === provided;
}

async function saveSettings(
  environment: AccountEmailEnvironment,
  tenantId: number,
  input: unknown,
): Promise<TenantSMTPSettings> {
  await environment.AUTH_DB.exec(CREATE_TABLE);
  const current = await readSettings(environment, tenantId);
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid email settings");
  const body = input as Record<string, unknown>;
  const next = { ...body };
  if (body.password === null) next.password = "";
  else if (typeof body.password !== "string" || body.password.length === 0)
    next.password = current?.password ?? "";
  const parsed = parseTenantSMTPSettings(next);
  const ciphertext = await encrypt(environment, tenantId, parsed);
  await environment.AUTH_DB.prepare(
    "INSERT INTO tenant_email_settings(tenant_id,ciphertext,updated_at) VALUES(?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET ciphertext=excluded.ciphertext,updated_at=excluded.updated_at",
  )
    .bind(tenantId, ciphertext, new Date().toISOString())
    .run();
  return parsed;
}

function envSettings(
  environment: AccountEmailEnvironment,
): SMTPSettings | undefined {
  if (!environment.SAVIA_SMTP_HOST) return undefined;
  const port = Number(environment.SAVIA_SMTP_PORT ?? "465");
  const host = environment.SAVIA_SMTP_HOST.trim();
  const from = environment.SAVIA_SMTP_FROM?.trim() ?? "";
  const username = environment.SAVIA_SMTP_USERNAME?.trim() ?? "";
  const password = environment.SAVIA_SMTP_PASSWORD ?? "";
  const localDevelopment = environment.SAVIA_SMTP_ALLOW_INSECURE === "true";
  const localHost = ["localhost", "127.0.0.1", "::1", "mailpit"].includes(
    host.toLowerCase(),
  );
  if (
    (!validHost(host) && !(localDevelopment && localHost)) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !validAddress(from)
  )
    throw new Error("SAVIA_SMTP configuration is invalid");
  const security = environment.SAVIA_SMTP_SECURITY ?? "tls";
  if (security !== "tls" && security !== "starttls" && security !== "plain")
    throw new Error("SAVIA_SMTP_SECURITY must be tls, starttls, or plain");
  const allowInsecure = localDevelopment;
  if (security === "plain" && !allowInsecure)
    throw new Error("Unencrypted SMTP is only allowed for local development");
  return { host, port, username, password, from, security, allowInsecure };
}

export async function sendAccountEmail(
  environment: AccountEmailEnvironment,
  dependencies: AccountEmailDependencies,
  email: SMTPEmail,
  tenantId?: number,
): Promise<void> {
  if (
    tenantId !== undefined &&
    Number.isSafeInteger(tenantId) &&
    tenantId > 0
  ) {
    await environment.AUTH_DB.exec(CREATE_TABLE);
    const settings = await readSettings(environment, tenantId);
    if (settings && dependencies.deliverEmail)
      return dependencies.deliverEmail(settings, email);
    if (settings) return deliverSmtpEmail(settings, email);
  }
  const global = envSettings(environment);
  if (global && dependencies.deliverEmail)
    return dependencies.deliverEmail(global, email);
  if (dependencies.sendTransactionalEmail)
    return dependencies.sendTransactionalEmail(email);
  if (global) return deliverSmtpEmail(global, email);
  throw new Error("Transactional email is not configured");
}

/**
 * Reports whether the same delivery paths used by sendAccountEmail are
 * available. Tenant settings are checked only when a trusted tenant ID was
 * supplied by the API shell; public callers must never choose this ID.
 */
export async function accountEmailAvailable(
  environment: AccountEmailEnvironment,
  dependencies: AccountEmailDependencies,
  tenantId?: number,
): Promise<boolean> {
  if (
    tenantId !== undefined &&
    Number.isSafeInteger(tenantId) &&
    tenantId > 0
  ) {
    try {
      await environment.AUTH_DB.exec(CREATE_TABLE);
      if (await readSettings(environment, tenantId)) return true;
    } catch {
      // A corrupt or unreadable tenant configuration cannot deliver mail.
      return false;
    }
  }

  let global: SMTPSettings | undefined;
  try {
    global = envSettings(environment);
  } catch {
    // Invalid global SMTP settings make sendAccountEmail fail before its
    // injected fallback can run, so they do not count as available.
    return false;
  }
  return !!global || !!dependencies.sendTransactionalEmail;
}

export function trustedAccountEmailTenantId(
  request: Request,
  environment: AccountEmailEnvironment,
): number | undefined {
  if (!bridgeAuthorized(request, environment)) return undefined;
  const raw = request.headers.get("x-savia-tenant-email-id");
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const tenantId = Number(raw);
  return Number.isSafeInteger(tenantId) && tenantId > 0 ? tenantId : undefined;
}

export async function accountEmailSettingsResponse(
  request: Request,
  environment: AccountEmailEnvironment,
  dependencies: AccountEmailDependencies,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const match = url.pathname.match(
    /^\/_internal\/tenant-email\/(\d+)(?:\/(test|send))?$/,
  );
  if (!match) return undefined;
  if (!bridgeAuthorized(request, environment))
    return jsonResponse({ error: "Forbidden" }, 403);
  const tenantId = Number(match[1]);
  if (!Number.isSafeInteger(tenantId) || tenantId < 1)
    return jsonResponse({ error: "Invalid tenant" }, 400);
  const testRoute = match[2] === "test";
  const sendRoute = match[2] === "send";
  if (request.method === "POST" && sendRoute) {
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > 20 * 1024)
      return jsonResponse({ error: "Email request is too large" }, 413);
    let raw: string;
    try {
      raw = await request.text();
    } catch {
      return jsonResponse({ error: "Invalid email request" }, 400);
    }
    if (new TextEncoder().encode(raw).byteLength > 20 * 1024)
      return jsonResponse({ error: "Email request is too large" }, 413);
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return jsonResponse({ error: "Invalid email request" }, 400);
    }
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      Object.keys(payload).sort().join(",") !== "subject,text,to"
    )
      return jsonResponse({ error: "Invalid email request" }, 400);
    const email = payload as Record<string, unknown>;
    if (
      typeof email.to !== "string" ||
      !validAddress(email.to) ||
      typeof email.subject !== "string" ||
      email.subject.length < 1 ||
      email.subject.length > 200 ||
      /[\r\n]/.test(email.subject) ||
      typeof email.text !== "string" ||
      email.text.length < 1 ||
      email.text.length > 16000 ||
      email.text.includes("\0")
    )
      return jsonResponse({ error: "Invalid email request" }, 400);
    try {
      await sendAccountEmail(
        environment,
        dependencies,
        { to: email.to, subject: email.subject, text: email.text },
        tenantId,
      );
      return jsonResponse({ sent: true });
    } catch {
      return jsonResponse({ error: "Email delivery is unavailable" }, 503);
    }
  }
  try {
    await environment.AUTH_DB.exec(CREATE_TABLE);
    if (request.method === "GET" && !testRoute)
      return jsonResponse(redacted(await readSettings(environment, tenantId)));
    if (request.method === "PUT" && !testRoute) {
      const updated = await saveSettings(
        environment,
        tenantId,
        await request.json(),
      );
      return jsonResponse(redacted(updated));
    }
    if (request.method === "DELETE" && !testRoute) {
      await environment.AUTH_DB.prepare(
        "DELETE FROM tenant_email_settings WHERE tenant_id=?",
      )
        .bind(tenantId)
        .run();
      return jsonResponse({ configured: false });
    }
    if (request.method === "POST" && testRoute) {
      const payload = (await request.json()) as { actorEmail?: unknown };
      if (
        typeof payload?.actorEmail !== "string" ||
        !validAddress(payload.actorEmail)
      )
        return jsonResponse(
          { error: "Authenticated actor email is required" },
          400,
        );
      await sendAccountEmail(
        environment,
        dependencies,
        {
          to: payload.actorEmail,
          subject: "Savia email settings test",
          text: "This message confirms that tenant email delivery is configured.",
        },
        tenantId,
      );
      return jsonResponse({ sent: true });
    }
    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Email settings request failed",
      },
      400,
    );
  }
}
