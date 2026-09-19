import { resolve } from "node:path";
import { isIP } from "node:net";
export function loadConfiguration(
  env: Record<string, string | undefined> = process.env,
) {
  const required = (key: string, length = 1) => {
    const value = env[key]?.trim();
    if (!value || value.length < length)
      throw new Error(`${key} must contain at least ${length} characters`);
    return value;
  };
  const publicOrigin = required("SAVIA_PUBLIC_ORIGIN");
  const origin = new URL(publicOrigin);
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error(
      "SAVIA_PUBLIC_ORIGIN must be an HTTP(S) origin without credentials or a path",
    );
  const storageOrigin = (key: string) => {
    const url = new URL(required(key));
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error(`${key} must be an HTTP(S) origin`);
    return url.origin;
  };
  const s3Endpoint = storageOrigin("S3_ENDPOINT");
  const s3PublicEndpoint = storageOrigin("S3_PUBLIC_ENDPOINT");
  if (
    origin.protocol === "https:" &&
    new URL(s3PublicEndpoint).protocol !== "https:"
  )
    throw new Error(
      "S3_PUBLIC_ENDPOINT must use HTTPS with an HTTPS public origin",
    );
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT");
  const trustedProxyAddresses = (env.SAVIA_TRUSTED_PROXY_ADDRESSES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (trustedProxyAddresses.some((value) => !isIP(value)))
    throw new Error(
      "SAVIA_TRUSTED_PROXY_ADDRESSES must contain exact IP addresses",
    );
  if (
    Boolean(env.SAVIA_BOOTSTRAP_EMAIL) !== Boolean(env.SAVIA_BOOTSTRAP_PASSWORD)
  )
    throw new Error("Bootstrap email and password must be configured together");
  if (env.SAVIA_BOOTSTRAP_PASSWORD && env.SAVIA_BOOTSTRAP_PASSWORD.length < 12)
    throw new Error("Bootstrap password must contain at least 12 characters");
  return {
    trustedProxyAddresses,
    publicOrigin: origin.origin,
    canonicalHost: origin.hostname,
    port,
    host: env.HOST ?? "0.0.0.0",
    dataDirectory: resolve(env.SAVIA_DATA_DIR ?? "./data"),
    adminDirectory: resolve(env.SAVIA_ADMIN_DIR ?? "../admin/dist"),
    authSecret: required("SAVIA_AUTH_SECRET", 32),
    encryptionKey: required("SAVIA_ENCRYPTION_KEY", 32),
    captchaSecret: required("SAVIA_CAPTCHA_SECRET", 32),
    bootstrapEmail: env.SAVIA_BOOTSTRAP_EMAIL,
    bootstrapPassword: env.SAVIA_BOOTSTRAP_PASSWORD,
    s3: {
      endpoint: s3Endpoint,
      publicEndpoint: s3PublicEndpoint,
      bucket: env.S3_BUCKET ?? "savia-documents",
      region: env.S3_REGION ?? "us-east-1",
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY", 16),
      forcePathStyle: true,
    },
  };
}
export type Configuration = ReturnType<typeof loadConfiguration>;
