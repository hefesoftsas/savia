/** Disposable real-SMTP check. Start Mailpit with `pnpm dev:mail` first. */
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createApplication } from "../src/application";
import { loadConfiguration } from "../src/config";
import { startHttpServer } from "../src/http-server";

const origin = "http://127.0.0.1:8796";
const mailOrigin = "http://127.0.0.1:8025";
const directory = await mkdtemp(join(tmpdir(), "savia-email-smoke-"));
const suffix = randomUUID().slice(0, 8);
const email = `email-smoke-${suffix}@example.test`;
const password = "Local-Email-Smoke-Only-123!";
const env = {
  SAVIA_PUBLIC_ORIGIN: origin,
  PORT: "8796",
  HOST: "127.0.0.1",
  SAVIA_DATA_DIR: directory,
  SAVIA_ADMIN_DIR: resolve("../admin/dist"),
  SAVIA_AUTH_SECRET: "disposable-email-auth-secret-".repeat(3),
  SAVIA_ENCRYPTION_KEY: "disposable-email-encryption-".repeat(3),
  SAVIA_CAPTCHA_SECRET: "disposable-email-captcha-".repeat(3),
  SAVIA_BOOTSTRAP_EMAIL: `email-admin-${suffix}@example.test`,
  SAVIA_BOOTSTRAP_PASSWORD: password,
  SAVIA_SMTP_HOST: "127.0.0.1",
  SAVIA_SMTP_PORT: "1025",
  SAVIA_SMTP_FROM: "no-reply@savia.test",
  SAVIA_SMTP_SECURITY: "plain",
  SAVIA_SMTP_ALLOW_INSECURE: "true",
  S3_ENDPOINT: "http://127.0.0.1:8333",
  S3_PUBLIC_ENDPOINT: "http://127.0.0.1:8333",
  S3_ACCESS_KEY_ID: "email-smoke",
  S3_SECRET_ACCESS_KEY: "disposable-email-smoke-key",
};

function totp(uri: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let value = 0,
    bits = 0;
  const bytes: number[] = [];
  for (const character of new URL(uri).searchParams
    .get("secret")!
    .replace(/=+$/, "")) {
    value = (value << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 255);
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes))
    .update(counter)
    .digest();
  return ((digest.readUInt32BE(digest.at(-1)! & 15) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, "0");
}

async function messageLink(
  recipient: string,
  contains: string,
): Promise<string> {
  const until = Date.now() + 15_000;
  do {
    const response = await fetch(`${mailOrigin}/api/v1/messages`);
    assert.equal(response.status, 200, "Mailpit must be running locally");
    const payload = (await response.json()) as {
      messages: Array<{ ID: string; To: Array<{ Address: string }> }>;
    };
    for (const message of payload.messages ?? []) {
      if (!message.To.some((to) => to.Address === recipient)) continue;
      const body = (await (
        await fetch(`${mailOrigin}/api/v1/message/${message.ID}`)
      ).json()) as { Text: string };
      const link = body.Text.split(/\s+/).find(
        (part) => part.startsWith(origin) && part.includes(contains),
      );
      if (link) return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  } while (Date.now() < until);
  throw new Error(`Mailpit did not capture the expected ${contains} email`);
}

let app: Awaited<ReturnType<typeof createApplication>> | undefined;
let http: Awaited<ReturnType<typeof startHttpServer>> | undefined;
try {
  assert.equal((await fetch(`${mailOrigin}/api/v1/messages`)).status, 200);
  const config = loadConfiguration(env);
  app = await createApplication(config, env);
  http = await startHttpServer({
    ...config,
    fetchApi: app.fetch,
    realtime: app.realtime,
  });
  const cookies = new Map<string, string>();
  const call = async (path: string, data?: unknown, authenticated = false) => {
    const response = await fetch(new URL(path, origin), {
      method: data === undefined ? "GET" : "POST",
      redirect: "manual",
      headers: {
        origin,
        ...(data === undefined ? {} : { "content-type": "application/json" }),
        ...(authenticated
          ? { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") }
          : {}),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    if (authenticated)
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(";")[0],
          separator = pair.indexOf("=");
        cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
    return response;
  };
  const recoveryPage = await call("/api/auth/forgot-password");
  assert.equal(
    recoveryPage.status,
    200,
    "The recovery entry point must be reachable",
  );
  assert.match(await recoveryPage.text(), /request-password-reset/);
  const invalidVerification = await call(
    "/api/auth/email-verified?error=token_expired",
  );
  assert.equal(invalidVerification.status, 200);
  assert.doesNotMatch(
    await invalidVerification.text(),
    /Tu correo está confirmado/,
  );
  const login = await call(
    "/api/auth/sign-in/email",
    { email: env.SAVIA_BOOTSTRAP_EMAIL, password },
    true,
  );
  assert.equal(login.status, 200, await login.clone().text());
  const enroll = await call(
    "/api/auth/two-factor/enable",
    { password, method: "totp" },
    true,
  );
  assert.equal(enroll.status, 200, await enroll.clone().text());
  const { totpURI } = (await enroll.json()) as { totpURI: string };
  const verifiedMfa = await call(
    "/api/auth/two-factor/verify-totp",
    { code: totp(totpURI) },
    true,
  );
  assert.equal(verifiedMfa.status, 200, await verifiedMfa.clone().text());
  const tenant = await call(
    "/v1/tenants",
    {
      name: "Disposable email test",
      idSlug: `email-${suffix}`,
      initialUser: {
        email,
        firstName: "Email",
        lastName: "Test",
        role: "tenant_admin",
        temporaryPassword: password,
      },
    },
    true,
  );
  assert.equal(tenant.status, 201, await tenant.clone().text());
  const blocked = await call("/api/auth/sign-in/email", { email, password });
  assert.equal(blocked.status, 403, "Unverified user must not sign in");
  const verification = await messageLink(email, "/verify-email?");
  const verificationResponse = await call(verification);
  assert.equal(
    verificationResponse.status,
    302,
    await verificationResponse.clone().text(),
  );
  const signedIn = await call("/api/auth/sign-in/email", { email, password });
  assert.equal(signedIn.status, 200, await signedIn.clone().text());
  const oldCookie = signedIn.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const resetRequest = await call("/api/auth/request-password-reset", {
    email,
    redirectTo: `${origin}/auth/reset-password`,
  });
  const unknownRequest = await call("/api/auth/request-password-reset", {
    email: `unknown-${suffix}@example.test`,
    redirectTo: `${origin}/auth/reset-password`,
  });
  assert.equal(resetRequest.status, 200);
  assert.deepEqual(
    await resetRequest.json(),
    await unknownRequest.json(),
    "Public recovery must not reveal account existence",
  );
  const resetLink = await messageLink(email, "/reset-password/");
  const redirect = await call(resetLink);
  assert.equal(redirect.status, 302);
  const token = new URL(
    redirect.headers.get("location")!,
    origin,
  ).searchParams.get("token");
  assert.ok(token);
  const replacement = "New-Local-Smoke-Password-456!";
  const changed = await call("/api/auth/reset-password", {
    token,
    newPassword: replacement,
  });
  assert.equal(changed.status, 200, await changed.clone().text());
  assert.equal(
    (
      await call("/api/auth/reset-password", {
        token,
        newPassword: replacement,
      })
    ).status,
    400,
    "Reset token is single-use",
  );
  assert.equal(
    (await call("/api/auth/sign-in/email", { email, password })).status,
    401,
  );
  assert.equal(
    (await call("/api/auth/sign-in/email", { email, password: replacement }))
      .status,
    200,
  );
  const revoked = await fetch(`${origin}/api/auth/get-session`, {
    headers: { cookie: oldCookie },
  });
  assert.equal(
    await revoked.json(),
    null,
    "Password reset revokes prior sessions",
  );
  console.log(
    "PASS: SMTP delivery, verification gate, email link, password reset, token replay, generic recovery and session revocation.",
  );
  if (process.argv.includes("--serve")) {
    console.log(`Disposable UI fixture: ${origin}/api/auth/forgot-password`);
    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  }
} finally {
  await http?.close();
  await app?.close();
  await rm(directory, { recursive: true, force: true });
}
