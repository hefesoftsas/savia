/**
 * Disposable, real SAML protocol smoke test against the official Keycloak image.
 * Requires Docker. All app data, users, passwords, ports, and container names are
 * generated for one run and removed when the process exits.
 */
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApplication } from "../src/application";
import { loadConfiguration } from "../src/config";
import { startHttpServer } from "../src/http-server";

const IMAGE =
  process.env.SAVIA_KEYCLOAK_IMAGE ?? "quay.io/keycloak/keycloak:26.7.4";
const KEYCLOAK_REALM = "savia-saml-smoke";
const keycloakAdmin = "savia-smoke-admin";
const keycloakAdminPassword = `KC-${randomUUID()}-Admin!`;
const tenantPassword = `Savia-${randomUUID()}-Tenant!`;
const bootstrapPassword = `Savia-${randomUUID()}-Bootstrap!`;
const suffix = randomUUID().slice(0, 8);
const directory = await mkdtemp(join(tmpdir(), "savia-saml-smoke-"));
const containerName = `savia-keycloak-${suffix}`;
const appContainerName = `savia-app-saml-${suffix}`;
const appImage = process.env.SAVIA_SAML_APP_IMAGE;
const container = spawn(
  "docker",
  [
    "run",
    "--rm",
    "--name",
    containerName,
    "-p",
    "127.0.0.1::8080",
    "-e",
    `KC_BOOTSTRAP_ADMIN_USERNAME=${keycloakAdmin}`,
    "-e",
    `KC_BOOTSTRAP_ADMIN_PASSWORD=${keycloakAdminPassword}`,
    "-e",
    "JAVA_OPTS_KC_HEAP=-XX:MaxRAMPercentage=65",
    IMAGE,
    "start-dev",
  ],
  { stdio: "ignore" },
);
let app: Awaited<ReturnType<typeof createApplication>> | undefined;
let http: Awaited<ReturnType<typeof startHttpServer>> | undefined;
let appContainer: ReturnType<typeof spawn> | undefined;
let containerStarted = false;

type CookieJar = Map<string, string>;
type Form = { action: string; fields: Record<string, string> };
let syntheticClientIndex = 0;
const syntheticClientIps = new WeakMap<CookieJar, string>();

function syntheticClientIp(): string {
  syntheticClientIndex += 1;
  return `198.51.100.${((syntheticClientIndex - 1) % 253) + 1}`;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => done());
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((done, fail) =>
    server.close((error) => (error ? fail(error) : done())),
  );
  return port;
}

async function docker(...args: string[]): Promise<string> {
  const result = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  result.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  result.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  const code = await new Promise<number>((done, fail) => {
    result.once("error", fail);
    result.once("close", (value) => done(value ?? 1));
  });
  assert.equal(code, 0, `docker ${args.join(" ")} failed: ${stderr}`);
  return stdout.trim();
}

async function waitFor<T>(
  label: string,
  action: () => Promise<T | null>,
): Promise<T> {
  const end = Date.now() + 180_000;
  let lastError: unknown;
  while (Date.now() < end) {
    try {
      const value = await action();
      if (value !== null) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`${label} did not become ready within 180 seconds`, {
    cause: lastError,
  });
}

function htmlDecode(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function firstForm(html: string, base: string): Form {
  const form = html.match(/<form\b([^>]*)>([\s\S]*?)<\/form>/i);
  assert.ok(form, `Expected an HTML form in response: ${html.slice(0, 300)}`);
  const attr = (source: string, name: string) => {
    const found = source.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"));
    return found ? htmlDecode(found[1]) : "";
  };
  const action = new URL(attr(form[1], "action") || base, base).toString();
  const fields: Record<string, string> = {};
  for (const input of form[2].matchAll(/<input\b([^>]*)>/gi)) {
    const name = attr(input[1], "name");
    if (name) fields[name] = attr(input[1], "value");
  }
  return { action, fields };
}

function cookieHeader(jar: CookieJar): string | undefined {
  return jar.size
    ? [...jar].map(([key, value]) => `${key}=${value}`).join("; ")
    : undefined;
}

function storeCookies(jar: CookieJar, response: Response) {
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";", 1)[0];
    const at = pair.indexOf("=");
    if (at > 0) jar.set(pair.slice(0, at), pair.slice(at + 1));
  }
}

async function request(
  url: string,
  init: RequestInit = {},
  jar?: CookieJar,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (jar) {
    let clientIp = syntheticClientIps.get(jar);
    if (!clientIp) {
      clientIp = syntheticClientIp();
      syntheticClientIps.set(jar, clientIp);
    }
    headers.set("x-forwarded-for", clientIp);
  }
  if (jar && cookieHeader(jar)) headers.set("cookie", cookieHeader(jar)!);
  const response = await fetch(url, { ...init, headers, redirect: "manual" });
  if (jar) storeCookies(jar, response);
  return response;
}

async function postJson(
  url: string,
  body: unknown,
  jar?: CookieJar,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  return request(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: appOrigin,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    },
    jar,
  );
}

function totp(uri: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let value = 0;
  let bits = 0;
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

const port = await freePort();
const appOrigin = `http://127.0.0.1:${port}`;

async function appCall(
  path: string,
  data?: unknown,
  jar?: CookieJar,
  method = "POST",
): Promise<Response> {
  return request(
    new URL(path, appOrigin).toString(),
    {
      ...(data === undefined ? {} : { method }),
      headers:
        data === undefined
          ? { origin: appOrigin }
          : { origin: appOrigin, "content-type": "application/json" },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    },
    jar,
  );
}

async function keycloakAdminToken(origin: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: "admin-cli",
    username: keycloakAdmin,
    password: keycloakAdminPassword,
  });
  const response = await fetch(
    `${origin}/realms/master/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  assert.equal(response.status, 200, await response.clone().text());
  return ((await response.json()) as { access_token: string }).access_token;
}

async function samlAttempt(
  settings: { providerId: string; acsUrl: string },
  username: string,
  password: string,
  keycloakOrigin: string,
  callbackURL = `${appOrigin}/api/auth/sso-complete`,
  tamperAssertion = false,
  existingCookies?: CookieJar,
): Promise<{
  session: unknown;
  assertion: string;
  relayState: string;
  acsResponse: Response;
  appCookies: CookieJar;
}> {
  const appCookies = existingCookies ?? new Map<string, string>();
  let login: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    login = await postJson(
      `${appOrigin}/api/auth/sign-in/sso`,
      {
        providerId: settings.providerId,
        callbackURL,
      },
      appCookies,
    );
    if (login.status !== 429 || attempt === 2) break;
    const retryAfter = Number(login.headers.get("retry-after"));
    const waitSeconds = Math.min(
      65,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 1,
    );
    console.warn(
      `SSO initiation was rate limited; retrying the same synthetic client in ${waitSeconds}s (${attempt + 1}/2).`,
    );
    await new Promise((done) => setTimeout(done, waitSeconds * 1000));
  }
  assert.ok(login);
  assert.ok(
    [200, 201, 302].includes(login.status),
    `SSO start failed: ${login.status} ${await login.clone().text()}`,
  );
  let loginData: Record<string, unknown> = {};
  if (login.status !== 302)
    loginData = await login
      .clone()
      .json()
      .catch(() => ({}));
  const startUrl =
    login.headers.get("location") ??
    String(loginData.url ?? loginData.redirect ?? "");
  assert.ok(
    startUrl,
    `SSO start did not return a redirect URL: ${JSON.stringify(loginData)}`,
  );

  const kcCookies: CookieJar = new Map();
  let response = await request(startUrl, {}, kcCookies);
  let page = await response.text();
  if (!/name=["'](?:username|SAMLResponse)["']/i.test(page)) {
    const target = response.headers.get("location");
    assert.ok(
      target,
      `Keycloak did not show a login form: ${page.slice(0, 400)}`,
    );
    response = await request(
      new URL(target, startUrl).toString(),
      {},
      kcCookies,
    );
    page = await response.text();
  }
  const loginForm = firstForm(page, response.url || startUrl);
  const loginFields = { ...loginForm.fields, username, password };
  response = await request(
    loginForm.action,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(loginFields),
    },
    kcCookies,
  );
  page = await response.text();
  for (
    let hop = 0;
    hop < 8 && !/name=["']SAMLResponse["']/i.test(page);
    hop++
  ) {
    const redirect = response.headers.get("location");
    if (!redirect) break;
    const next = new URL(redirect, response.url || keycloakOrigin).toString();
    response = await request(next, {}, kcCookies);
    page = await response.text();
  }
  assert.match(
    page,
    /name=["']SAMLResponse["']/i,
    `Keycloak did not produce a SAML form: ${page.slice(0, 500)}`,
  );
  const assertionForm = firstForm(page, response.url || keycloakOrigin);
  let assertion = assertionForm.fields.SAMLResponse;
  const relayState = assertionForm.fields.RelayState ?? "";
  assert.ok(assertion, "Keycloak's SAML POST must include SAMLResponse");
  if (tamperAssertion) {
    const xml = Buffer.from(assertion, "base64").toString("utf8");
    const signature = xml.match(
      /(<(?:[\w.-]+:)?SignatureValue[^>]*>)([^<]+)(<\/(?:[\w.-]+:)?SignatureValue>)/i,
    );
    assert.ok(signature, "Keycloak assertion should contain its XML signature");
    const replacement = signature[2][0] === "A" ? "B" : "A";
    assertion = Buffer.from(
      xml.replace(
        signature[0],
        `${signature[1]}${replacement}${signature[2].slice(1)}${signature[3]}`,
      ),
    ).toString("base64");
  }
  const acsResponse = await request(
    settings.acsUrl,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: keycloakOrigin,
      },
      body: new URLSearchParams({
        SAMLResponse: assertion,
        ...(relayState ? { RelayState: relayState } : {}),
      }),
    },
    appCookies,
  );
  const sessionResponse = await request(
    `${appOrigin}/api/auth/get-session`,
    {},
    appCookies,
  );
  const session = sessionResponse.ok ? await sessionResponse.json() : null;
  return { session, assertion, relayState, acsResponse, appCookies };
}

function redirectFrom(
  response: Response,
  base = appOrigin,
): string | undefined {
  const location = response.headers.get("location");
  return location ? new URL(location, base).toString() : undefined;
}

function signedOAuthQuery(search: string): string {
  const source = new URLSearchParams(search);
  const signedNames = new Set(source.getAll("ba_param"));
  const result = new URLSearchParams();
  for (const [key, value] of source.entries()) {
    if (key === "sig" || key === "ba_param" || signedNames.has(key))
      result.append(key, value);
  }
  return result.toString();
}

async function finishTenantMfa(
  cookies: CookieJar,
  totpURI: string,
  oauthQuery?: string,
): Promise<unknown> {
  const response = await appCall(
    "/api/auth/two-factor/verify-totp",
    {
      code: totp(totpURI),
      ...(oauthQuery ? { oauth_query: oauthQuery } : {}),
    },
    cookies,
  );
  assert.equal(
    response.status,
    200,
    `${await response.clone().text()} (challenge cookies: ${[...cookies.keys()].filter((key) => key.includes("two_factor")).join(",") || "none"})`,
  );
  const session = await appCall("/api/auth/get-session", undefined, cookies);
  assert.equal(session.status, 200);
  return session.json();
}

async function oauthSamlFlow(
  settings: { providerId: string; acsUrl: string },
  email: string,
  password: string,
  totpURI: string,
  keycloakOrigin: string,
): Promise<void> {
  const redirectUri = "https://client.example/callback";
  const verifier = randomUUID().replace(/-/g, "").padEnd(64, "v");
  const challengeBytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const challenge = Buffer.from(challengeBytes).toString("base64url");
  const registration = await postJson(`${appOrigin}/api/auth/oauth2/register`, {
    client_name: "Disposable SAML OAuth client",
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "openid profile email savia.api.read",
  });
  assert.equal(registration.status, 201, await registration.clone().text());
  const { client_id: clientId } = (await registration.json()) as {
    client_id: string;
  };
  assert.ok(clientId);
  const authorization = new URLSearchParams({
    client_id: clientId,
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile email savia.api.read",
    state: `saml-oauth-${randomUUID()}`,
  });
  const appCookies: CookieJar = new Map();
  const authorize = await request(
    `${appOrigin}/api/auth/oauth2/authorize?${authorization}`,
    {},
    appCookies,
  );
  assert.ok(
    [200, 302].includes(authorize.status),
    await authorize.clone().text(),
  );
  const authorizePayload =
    authorize.status === 200
      ? ((await authorize.clone().json()) as {
          redirect?: boolean;
          url?: string;
        })
      : undefined;
  const loginDestination =
    authorize.headers.get("location") ?? authorizePayload?.url;
  assert.ok(
    loginDestination,
    `OAuth authorize returned no login URL: ${await authorize.clone().text()}`,
  );
  const loginURL = new URL(loginDestination, appOrigin);
  assert.equal(loginURL.pathname, "/api/auth/login");
  const callback = new URL("/api/auth/sso-complete", appOrigin);
  callback.search = loginURL.search;
  const flow = await samlAttempt(
    settings,
    email,
    password,
    keycloakOrigin,
    callback.toString(),
    false,
    appCookies,
  );
  assert.equal(
    flow.session,
    null,
    "SAML-only flow must not return a usable session before the MFA challenge",
  );
  const mfaURL = new URL(redirectFrom(flow.acsResponse) ?? "", appOrigin);
  assert.equal(mfaURL.pathname, "/api/auth/login");
  assert.equal(mfaURL.searchParams.get("mode"), "sso-mfa");
  const oauthQuery =
    signedOAuthQuery(mfaURL.search) || signedOAuthQuery(loginURL.search);
  const session = (await finishTenantMfa(
    flow.appCookies,
    totpURI,
    oauthQuery,
  )) as { user?: { email?: string } } | null;
  assert.equal(session?.user?.email, email);
  const mfaPage = await request(mfaURL.toString(), {}, flow.appCookies);
  assert.equal(mfaPage.status, 200);
  assert.match(await mfaPage.text(), /data-oauth-two-factor/);
  const continuation = await postJson(
    `${appOrigin}/api/auth/oauth2/continue`,
    {
      postLogin: true,
      oauth_query: oauthQuery,
    },
    flow.appCookies,
  );
  assert.equal(continuation.status, 200, await continuation.clone().text());
  const continued = (await continuation.json()) as Record<string, unknown>;
  let destination = String(continued.url ?? continued.redirect_uri ?? "");
  assert.ok(
    destination,
    `OAuth continuation had no destination: ${JSON.stringify(continued)}`,
  );
  let callbackResult = new URL(destination, appOrigin);
  if (callbackResult.pathname === "/api/auth/consent") {
    const consent = await postJson(
      `${appOrigin}/api/auth/oauth2/consent`,
      {
        accept: true,
        oauth_query: callbackResult.search.slice(1),
      },
      flow.appCookies,
    );
    assert.equal(consent.status, 200, await consent.clone().text());
    const accepted = (await consent.json()) as Record<string, unknown>;
    destination = String(accepted.url ?? accepted.redirect_uri ?? "");
    assert.ok(
      destination,
      `OAuth consent had no redirect: ${JSON.stringify(accepted)}`,
    );
    callbackResult = new URL(destination, appOrigin);
  }
  assert.equal(callbackResult.origin, new URL(redirectUri).origin);
  assert.equal(callbackResult.pathname, new URL(redirectUri).pathname);
  assert.equal(
    callbackResult.searchParams.get("state"),
    authorization.get("state"),
  );
  const code = callbackResult.searchParams.get("code");
  assert.ok(
    code,
    `OAuth callback had no authorization code: ${callbackResult}`,
  );
  const tokens = await request(`${appOrigin}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  assert.equal(tokens.status, 200, await tokens.clone().text());
  const tokenPayload = (await tokens.json()) as {
    access_token?: string;
    token_type?: string;
  };
  assert.ok(tokenPayload.access_token);
  assert.equal(tokenPayload.token_type?.toLowerCase(), "bearer");
}

try {
  const kcPort = await waitFor("Keycloak's published port", async () => {
    if (container.exitCode !== null)
      throw new Error("Keycloak container exited during startup");
    const mapped = await docker("port", containerName, "8080/tcp").catch(
      () => "",
    );
    const match = mapped.match(/127\.0\.0\.1:(\d+)/);
    return match ? Number(match[1]) : null;
  });
  containerStarted = true;
  const keycloakOrigin = `http://127.0.0.1:${kcPort}`;
  await waitFor("Keycloak readiness", async () => {
    const response = await fetch(`${keycloakOrigin}/realms/master`);
    return response.ok ? true : null;
  });

  const env: Record<string, string> = {
    SAVIA_PUBLIC_ORIGIN: appOrigin,
    PORT: appImage ? "8080" : String(port),
    HOST: appImage ? "0.0.0.0" : "127.0.0.1",
    SAVIA_DATA_DIR: appImage ? "/data" : directory,
    SAVIA_ADMIN_DIR: appImage ? "/srv/apps/admin/dist" : directory,
    SAVIA_AUTH_SECRET: `disposable-saml-auth-secret-${randomUUID()}`.padEnd(
      48,
      "x",
    ),
    SAVIA_ENCRYPTION_KEY:
      `disposable-saml-encryption-key-${randomUUID()}`.padEnd(48, "x"),
    SAVIA_CAPTCHA_SECRET:
      `disposable-saml-captcha-secret-${randomUUID()}`.padEnd(48, "x"),
    SAVIA_BOOTSTRAP_EMAIL: `saml-platform-${suffix}@example.test`,
    SAVIA_BOOTSTRAP_PASSWORD: bootstrapPassword,
    SAVIA_SSO_ALLOW_LOCAL_IDP: "true",
    S3_ENDPOINT: "http://127.0.0.1:8333",
    S3_PUBLIC_ENDPOINT: "http://127.0.0.1:8333",
    S3_ACCESS_KEY_ID: "saml-smoke",
    S3_SECRET_ACCESS_KEY: `disposable-saml-storage-${randomUUID()}`,
  };
  if (appImage) {
    const bridgeGateway = await docker(
      "network",
      "inspect",
      "bridge",
      "--format",
      "{{(index .IPAM.Config 0).Gateway}}",
    );
    assert.match(bridgeGateway, /^\d{1,3}(?:\.\d{1,3}){3}$/);
    env.SAVIA_TRUSTED_PROXY_ADDRESSES = bridgeGateway;
    const args = [
      "run",
      "--rm",
      "--name",
      appContainerName,
      "-p",
      `127.0.0.1:${port}:8080`,
      ...Object.entries(env).flatMap(([key, value]) => [
        "-e",
        `${key}=${value}`,
      ]),
      appImage,
    ];
    appContainer = spawn("docker", args, { stdio: "ignore" });
    await waitFor("Savia container image", async () => {
      if (appContainer?.exitCode !== null)
        throw new Error(
          `Savia image container exited with code ${appContainer?.exitCode}`,
        );
      const response = await fetch(`${appOrigin}/api/auth/get-session`);
      return response.status < 500 ? true : null;
    });
  } else {
    const config = loadConfiguration(env);
    app = await createApplication(config, env);
    http = await startHttpServer({
      ...config,
      fetchApi: app.fetch,
      realtime: app.realtime,
    });
  }

  const adminCookies: CookieJar = new Map();
  const adminLogin = await appCall(
    "/api/auth/sign-in/email",
    {
      email: env.SAVIA_BOOTSTRAP_EMAIL,
      password: bootstrapPassword,
    },
    adminCookies,
  );
  assert.equal(adminLogin.status, 200, await adminLogin.clone().text());
  const enroll = await appCall(
    "/api/auth/two-factor/enable",
    { password: bootstrapPassword, method: "totp" },
    adminCookies,
  );
  assert.equal(enroll.status, 200, await enroll.clone().text());
  const totpURI = ((await enroll.json()) as { totpURI: string }).totpURI;
  const verified = await appCall(
    "/api/auth/two-factor/verify-totp",
    { code: totp(totpURI) },
    adminCookies,
  );
  assert.equal(verified.status, 200, await verified.clone().text());

  const tenantEmail = `saml-operator-${suffix}@example.test`;
  const tenantResponse = await appCall(
    "/v1/tenants",
    {
      name: "Disposable SAML integration tenant",
      idSlug: `saml-${suffix}`,
      initialUser: {
        email: tenantEmail,
        firstName: "SAML",
        lastName: "Operator",
        role: "operator",
        temporaryPassword: tenantPassword,
        emailVerified: true,
      },
    },
    adminCookies,
  );
  assert.equal(tenantResponse.status, 201, await tenantResponse.clone().text());
  const tenantPayload = (await tenantResponse.json()) as Record<string, any>;
  const tenantId =
    tenantPayload.id ?? tenantPayload.tenant?.id ?? tenantPayload.data?.id;
  assert.ok(
    tenantId,
    `Could not find tenant id: ${JSON.stringify(tenantPayload)}`,
  );

  const otherEmail = `saml-other-tenant-${suffix}@example.test`;
  const otherResponse = await appCall(
    "/v1/tenants",
    {
      name: "Disposable SAML cross-tenant fixture",
      idSlug: `saml-x-${suffix}`,
      initialUser: {
        email: otherEmail,
        firstName: "Other",
        lastName: "Tenant",
        role: "operator",
        temporaryPassword: tenantPassword,
        emailVerified: true,
      },
    },
    adminCookies,
  );
  assert.equal(otherResponse.status, 201, await otherResponse.clone().text());

  const metadataResponse = await fetch(
    `${keycloakOrigin}/realms/${KEYCLOAK_REALM}/protocol/saml/descriptor`,
  );
  if (metadataResponse.status === 404) {
    const token = await keycloakAdminToken(keycloakOrigin);
    const created = await fetch(`${keycloakOrigin}/admin/realms`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        realm: KEYCLOAK_REALM,
        enabled: true,
        sslRequired: "none",
        registrationAllowed: false,
      }),
    });
    assert.equal(created.status, 201, await created.clone().text());
  } else {
    assert.equal(metadataResponse.status, 200);
  }
  const publishedMetadata = await (
    await fetch(
      `${keycloakOrigin}/realms/${KEYCLOAK_REALM}/protocol/saml/descriptor`,
    )
  ).text();
  assert.match(publishedMetadata, /EntityDescriptor/);
  // Keycloak's realm descriptor advertises signed AuthnRequests generically,
  // even though the SAML client is configured to accept unsigned requests.
  // Better Auth currently sends unsigned AuthnRequests, so align this IdP
  // capability flag with the actual disposable client policy while retaining
  // Keycloak's generated endpoints and signing certificate unchanged.
  assert.match(publishedMetadata, /WantAuthnRequestsSigned=["']true["']/i);
  const metadata = publishedMetadata.replace(
    /WantAuthnRequestsSigned=(["'])true\1/i,
    'WantAuthnRequestsSigned="false"',
  );
  assert.notEqual(
    metadata,
    publishedMetadata,
    "Expected to adapt Keycloak's generic signed-request metadata flag",
  );
  const token = await keycloakAdminToken(keycloakOrigin);
  const createUser = async (email: string, name: string) => {
    const created = await fetch(
      `${keycloakOrigin}/admin/realms/${KEYCLOAK_REALM}/users`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          username: email,
          email,
          firstName: name,
          lastName: "Fixture",
          enabled: true,
          emailVerified: true,
        }),
      },
    );
    assert.equal(created.status, 201, await created.clone().text());
    const usersResponse = await fetch(
      `${keycloakOrigin}/admin/realms/${KEYCLOAK_REALM}/users?username=${encodeURIComponent(email)}&exact=true`,
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );
    assert.equal(usersResponse.status, 200);
    const [user] = (await usersResponse.json()) as Array<{ id: string }>;
    assert.ok(user?.id, `Keycloak did not create fixture user ${email}`);
    const credentialResponse = await fetch(
      `${keycloakOrigin}/admin/realms/${KEYCLOAK_REALM}/users/${user.id}/reset-password`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: "password",
          value: tenantPassword,
          temporary: false,
        }),
      },
    );
    assert.equal(credentialResponse.status, 204);
  };
  const unknownEmail = `saml-unknown-${suffix}@example.test`;
  await Promise.all([
    createUser(tenantEmail, "SAML Operator"),
    createUser(otherEmail, "Other Tenant"),
    createUser(unknownEmail, "Unknown"),
  ]);

  const settingsResponse = await appCall(
    `/v1/tenants/${tenantId}/sso-settings`,
    {
      displayName: "Disposable Keycloak",
      domain: "example.test",
      idpMetadata: metadata,
      enabled: true,
      ssoOnly: false,
    },
    adminCookies,
    "PUT",
  );
  assert.equal(
    settingsResponse.status,
    200,
    await settingsResponse.clone().text(),
  );
  const settingsPayload = (await settingsResponse.json()) as Record<
    string,
    any
  >;
  const settings =
    settingsPayload.settings ?? settingsPayload.data ?? settingsPayload;
  assert.ok(
    settings.providerId && settings.entityId && settings.acsUrl,
    JSON.stringify(settings),
  );

  const clientResponse = await fetch(
    `${keycloakOrigin}/admin/realms/${KEYCLOAK_REALM}/clients`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        clientId: settings.entityId,
        protocol: "saml",
        enabled: true,
        redirectUris: [settings.acsUrl],
        attributes: {
          saml_name_id_format: "email",
          saml_name_id_format_force: "true",
          "saml.assertion.signature": "true",
          "saml.client.signature": "false",
          "saml.server.signature": "true",
          "saml.force.post.binding": "true",
          saml_signature_algorithm: "RSA_SHA256",
        },
        protocolMappers: [
          {
            name: "email",
            protocol: "saml",
            protocolMapper: "saml-user-property-mapper",
            consentRequired: false,
            config: {
              "user.attribute": "email",
              "friendly.name": "email",
              "attribute.name": "email",
              "attribute.nameformat": "Basic",
            },
          },
        ],
      }),
    },
  );
  assert.equal(clientResponse.status, 201, await clientResponse.clone().text());

  const tenantCookies: CookieJar = new Map();
  const tenantLogin = await appCall(
    "/api/auth/sign-in/email",
    { email: tenantEmail, password: tenantPassword },
    tenantCookies,
  );
  assert.equal(tenantLogin.status, 200, await tenantLogin.clone().text());
  const tenantMfaEnrollment = await appCall(
    "/api/auth/two-factor/enable",
    { password: tenantPassword, method: "totp" },
    tenantCookies,
  );
  assert.equal(
    tenantMfaEnrollment.status,
    200,
    await tenantMfaEnrollment.clone().text(),
  );
  const tenantTotpURI = (
    (await tenantMfaEnrollment.json()) as { totpURI: string }
  ).totpURI;
  const tenantMfaVerified = await appCall(
    "/api/auth/two-factor/verify-totp",
    { code: totp(tenantTotpURI) },
    tenantCookies,
  );
  assert.equal(
    tenantMfaVerified.status,
    200,
    await tenantMfaVerified.clone().text(),
  );

  const success = await samlAttempt(
    settings,
    tenantEmail,
    tenantPassword,
    keycloakOrigin,
  );
  assert.equal(
    success.session,
    null,
    "SAML sign-in must not create a usable session before MFA",
  );
  assert.match(redirectFrom(success.acsResponse) ?? "", /mode=sso-mfa/);
  const successfulSession = (await finishTenantMfa(
    success.appCookies,
    tenantTotpURI,
  )) as { user?: { email?: string; twoFactorEnabled?: boolean } } | null;
  assert.equal(
    successfulSession?.user?.email,
    tenantEmail,
    `SAML sign-in did not create the expected post-MFA session: ${JSON.stringify(successfulSession)}`,
  );
  assert.equal(successfulSession?.user?.twoFactorEnabled, true);
  const replay = await request(
    settings.acsUrl,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: keycloakOrigin,
      },
      body: new URLSearchParams({
        SAMLResponse: success.assertion,
        ...(success.relayState ? { RelayState: success.relayState } : {}),
      }),
    },
    success.appCookies,
  );
  assert.ok(
    replay.status >= 400 || replay.status === 302,
    `Replayed SAML response unexpectedly succeeded with ${replay.status}`,
  );
  const tampered = await samlAttempt(
    settings,
    tenantEmail,
    tenantPassword,
    keycloakOrigin,
    `${appOrigin}/api/auth/sso-complete`,
    true,
  );
  assert.equal(
    tampered.session,
    null,
    "A tampered assertion must never create a session",
  );
  assert.notEqual(
    tampered.acsResponse.headers.get("location")?.includes("mode=sso-mfa"),
    true,
    "Tampered assertions must fail before MFA",
  );
  const unknown = await samlAttempt(
    settings,
    unknownEmail,
    tenantPassword,
    keycloakOrigin,
  );
  assert.equal(
    unknown.session,
    null,
    `Unknown SAML user was unexpectedly authenticated: ${JSON.stringify(unknown.session)}`,
  );
  const crossTenant = await samlAttempt(
    settings,
    otherEmail,
    tenantPassword,
    keycloakOrigin,
  );
  assert.equal(
    crossTenant.session,
    null,
    `Cross-tenant SAML user was unexpectedly authenticated: ${JSON.stringify(crossTenant.session)}`,
  );
  await oauthSamlFlow(
    settings,
    tenantEmail,
    tenantPassword,
    tenantTotpURI,
    keycloakOrigin,
  );

  const pendingSaml = await samlAttempt(
    settings,
    tenantEmail,
    tenantPassword,
    keycloakOrigin,
  );
  assert.equal(pendingSaml.session, null);
  assert.match(redirectFrom(pendingSaml.acsResponse) ?? "", /mode=sso-mfa/);
  const disableConnection = await appCall(
    `/v1/tenants/${tenantId}/sso-settings`,
    {
      displayName: "Disposable Keycloak",
      domain: "example.test",
      idpMetadata: metadata,
      enabled: false,
      ssoOnly: false,
    },
    adminCookies,
    "PUT",
  );
  assert.equal(
    disableConnection.status,
    200,
    await disableConnection.clone().text(),
  );
  const revokedMfa = await appCall(
    "/api/auth/two-factor/verify-totp",
    { code: totp(tenantTotpURI) },
    pendingSaml.appCookies,
  );
  assert.notEqual(
    revokedMfa.status,
    200,
    "Disabling the provider must invalidate its pending SAML MFA challenge",
  );
  const revokedSession = await appCall(
    "/api/auth/get-session",
    undefined,
    pendingSaml.appCookies,
  );
  assert.equal(
    await revokedSession.json(),
    null,
    "A disabled SAML provider must not issue a session from a pending challenge",
  );
  const reenableConnection = await appCall(
    `/v1/tenants/${tenantId}/sso-settings`,
    {
      displayName: "Disposable Keycloak",
      domain: "example.test",
      idpMetadata: metadata,
      enabled: true,
      ssoOnly: false,
    },
    adminCookies,
    "PUT",
  );
  assert.equal(
    reenableConnection.status,
    200,
    await reenableConnection.clone().text(),
  );

  const pendingPasswordCookies: CookieJar = new Map();
  const pendingPassword = await appCall(
    "/api/auth/sign-in/email",
    {
      email: tenantEmail,
      password: tenantPassword,
    },
    pendingPasswordCookies,
  );
  assert.equal(
    pendingPassword.status,
    200,
    await pendingPassword.clone().text(),
  );
  assert.equal(
    ((await pendingPassword.json()) as { twoFactorRedirect?: boolean })
      .twoFactorRedirect,
    true,
  );

  const ssoOnlyResponse = await appCall(
    `/v1/tenants/${tenantId}/sso-settings`,
    {
      displayName: "Disposable Keycloak",
      domain: "example.test",
      idpMetadata: metadata,
      enabled: true,
      ssoOnly: true,
    },
    adminCookies,
    "PUT",
  );
  assert.equal(
    ssoOnlyResponse.status,
    200,
    await ssoOnlyResponse.clone().text(),
  );
  const revokedPasswordMfa = await appCall(
    "/api/auth/two-factor/verify-totp",
    { code: totp(tenantTotpURI) },
    pendingPasswordCookies,
  );
  assert.notEqual(
    revokedPasswordMfa.status,
    200,
    "Enabling SSO-only must invalidate a pending password MFA challenge",
  );
  const revokedPasswordSession = await appCall(
    "/api/auth/get-session",
    undefined,
    pendingPasswordCookies,
  );
  assert.equal(
    await revokedPasswordSession.json(),
    null,
    "A pending password MFA challenge must not issue a session after SSO-only is enabled",
  );
  const blockedPassword = await appCall("/api/auth/sign-in/email", {
    email: tenantEmail,
    password: tenantPassword,
  });
  assert.equal(
    blockedPassword.status,
    403,
    `SSO-only tenant password sign-in should be blocked; got ${blockedPassword.status}`,
  );
  const platformRecovery = await appCall("/api/auth/sign-in/email", {
    email: env.SAVIA_BOOTSTRAP_EMAIL,
    password: bootstrapPassword,
  });
  assert.equal(
    platformRecovery.status,
    200,
    "Platform admin local recovery must remain available",
  );

  console.log(
    "PASS: real Keycloak SAML assertion, bound MFA challenge and OAuth authorize/continue/token flow, tamper/replay and unknown/cross-tenant denial, pending SAML/password challenge revocation, SSO-only password block, and platform admin recovery.",
  );
  console.log(`Disposable Keycloak image: ${IMAGE}`);
} finally {
  await http?.close();
  await app?.close();
  if (appContainer) {
    if (appContainer.exitCode === null)
      await docker("rm", "--force", appContainerName).catch(() => undefined);
    await new Promise<void>((done) => {
      if (appContainer?.exitCode !== null) return done();
      appContainer?.once("exit", () => done());
      appContainer?.kill("SIGTERM");
      setTimeout(done, 3_000).unref();
    });
  }
  if (containerStarted || container.exitCode === null) {
    await docker("rm", "--force", containerName).catch(() => undefined);
  }
  await new Promise<void>((done) => {
    if (container.exitCode !== null) return done();
    container.once("exit", () => done());
    container.kill("SIGTERM");
    setTimeout(done, 3_000).unref();
  });
  await rm(directory, { recursive: true, force: true });
}
