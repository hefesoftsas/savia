import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const database = option("--database", "sqlite");
if (!["sqlite", "postgres"].includes(database))
  throw new Error("--database must be sqlite or postgres");
const email = option("--email");
if (!email || !/^[^\s@=]+@[^\s@=]+\.[^\s@=]+$/.test(email))
  throw new Error("Use --email admin@example.com");
const origin = new URL(option("--origin", "http://localhost:8080"));
if (
  !["http:", "https:"].includes(origin.protocol) ||
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash
)
  throw new Error("--origin must be an HTTP(S) origin");
const storage = new URL(option("--storage-origin", "http://localhost:8333"));
if (
  !["http:", "https:"].includes(storage.protocol) ||
  storage.username ||
  storage.password ||
  storage.pathname !== "/" ||
  storage.search ||
  storage.hash
)
  throw new Error("--storage-origin must be an HTTP(S) origin");
const path = resolve(option("--output", "infra/secrets/self-hosted.env"));
const secret = () => randomBytes(32).toString("hex");
const postgresPassword = database === "postgres" ? secret() : undefined;
const values = {
  SAVIA_DATABASE_DRIVER: database,
  ...(postgresPassword
    ? {
        POSTGRES_PASSWORD: postgresPassword,
        SAVIA_POSTGRES_URL: `postgresql://savia:${postgresPassword}@postgres:5432/savia`,
        SAVIA_POSTGRES_POOL_SIZE: "5",
      }
    : {}),
  SAVIA_PUBLIC_ORIGIN: origin.origin,
  SAVIA_AUTH_SECRET: secret(),
  SAVIA_ENCRYPTION_KEY: secret(),
  SAVIA_CAPTCHA_SECRET: secret(),
  SAVIA_BOOTSTRAP_EMAIL: email,
  SAVIA_BOOTSTRAP_PASSWORD: randomBytes(24).toString("base64url"),
  S3_PUBLIC_ENDPOINT: storage.origin,
  S3_BUCKET: "savia-documents",
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY_ID: "savia-" + randomBytes(10).toString("hex"),
  S3_SECRET_ACCESS_KEY: secret(),
};
await mkdir(dirname(path), { recursive: true, mode: 0o700 });
await writeFile(
  path,
  Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n",
  { flag: "wx", mode: 0o600 },
);
console.log(
  `Created ${path}. Read SAVIA_BOOTSTRAP_PASSWORD there for the first login. Keep this file with your backups; never commit it.`,
);
