import { postgresTestUrl, withPostgresFixture } from "./postgres-fixture";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { makeConfig } from "../../../packages/studio-shared/src/metadata";
import { createApplication } from "../src/application";
import { loadConfiguration } from "../src/config";
import { openSqliteDatabase } from "../src/sqlite";

/** Standard RFC 6238 authenticator, using the secret actually issued by enrollment. */
function totp(uri: string) {
  const url = new URL(uri);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let buffer = 0,
    bits = 0;
  const bytes: number[] = [];
  for (const character of url.searchParams.get("secret")!.replace(/=+$/, "")) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error("Invalid TOTP secret");
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(
    BigInt(
      Math.floor(
        Date.now() / 1000 / Number(url.searchParams.get("period") ?? 30),
      ),
    ),
  );
  const hash = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = hash.at(-1)! & 15;
  return ((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, "0");
}

async function applicationScenario(postgresUrl?: string, qdrantUrl?: string) {
  const directory = mkdtempSync(join(tmpdir(), "savia-application-"));
  const origin = "http://localhost:8080";
  const email = "bootstrap@example.test",
    password = "Application-Smoke-Password-123!";
  const config = loadConfiguration({
    ...(postgresUrl
      ? { SAVIA_DATABASE_DRIVER: "postgres", SAVIA_POSTGRES_URL: postgresUrl }
      : {}),
    SAVIA_PUBLIC_ORIGIN: origin,
    SAVIA_DATA_DIR: directory,
    SAVIA_AUTH_SECRET: "integration-auth-secret-".repeat(3),
    SAVIA_ENCRYPTION_KEY: "integration-encryption-secret-".repeat(3),
    SAVIA_CAPTCHA_SECRET: "integration-captcha-secret-".repeat(3),
    SAVIA_BOOTSTRAP_EMAIL: email,
    SAVIA_BOOTSTRAP_PASSWORD: password,
    S3_ENDPOINT: "http://127.0.0.1:1",
    S3_PUBLIC_ENDPOINT: "http://127.0.0.1:1",
    S3_ACCESS_KEY_ID: "test-access",
    S3_SECRET_ACCESS_KEY: "integration-storage-secret",
  });
  let pauseEmbeddings = false;
  let startedPausedEmbedding!: () => void;
  const pausedEmbeddingStarted = new Promise<void>((resolve) => {
    startedPausedEmbedding = resolve;
  });
  const embeddings = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const { input } = JSON.parse(Buffer.concat(chunks).toString());
    if (pauseEmbeddings) {
      startedPausedEmbedding();
      return;
    }
    outgoing.setHeader("content-type", "application/json");
    outgoing.end(
      JSON.stringify({ embeddings: input.map(() => Array(1024).fill(0.5)) }),
    );
  });
  const collection = `savia-app-test-${crypto.randomUUID()}`;
  let searchEnvironment: Record<string, string> = {};
  if (qdrantUrl) {
    await new Promise<void>((resolve) =>
      embeddings.listen(0, "127.0.0.1", resolve),
    );
    const address = embeddings.address() as { port: number };
    searchEnvironment = {
      SAVIA_PAGES_SEARCH_ENABLED: "true",
      SAVIA_PAGES_OLLAMA_URL: `http://127.0.0.1:${address.port}`,
      SAVIA_PAGES_QDRANT_URL: qdrantUrl,
      SAVIA_PAGES_QDRANT_COLLECTION: collection,
    };
  }
  let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  const cookies = new Map<string, string>();
  const base = "/v1/studio/0/api";
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    authenticated = true,
  ) {
    const headers = new Headers({ origin });
    if (body !== undefined) headers.set("content-type", "application/json");
    if (authenticated && cookies.size)
      headers.set(
        "cookie",
        [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      );
    const response = await app!.fetch(
      new Request(origin + path, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    );
    if (authenticated)
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(";")[0],
          separator = pair.indexOf("=");
        cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
    return response;
  }
  async function json(
    path: string,
    status = 200,
    method = "GET",
    body?: unknown,
  ) {
    const response = await request(path, method, body);
    expect(response.status, await response.clone().text()).toBe(status);
    return response.json() as Promise<any>;
  }
  try {
    app = await createApplication(config, {
      NANGO_GITHUB_INTEGRATION_ID: "github-test",
      NANGO_SLACK_INTEGRATION_ID: "slack-test",
      NANGO_MICROSOFT_TEAMS_INTEGRATION_ID: "teams-test",
      NANGO_BASE_URL: "https://nango.test",
      NANGO_API_KEY: "fixture-key",
      NANGO_SALESFORCE_INTEGRATION_ID: "salesforce-test",
      NANGO_ZOHO_INTEGRATION_ID: "zoho-test",
      NANGO_PIPEDRIVE_INTEGRATION_ID: "pipedrive-test",
      ...searchEnvironment,
    });
    expect(
      (await request(base + "/objects", "GET", undefined, false)).status,
    ).toBe(401);
    expect(
      (await request("/_internal/session", "GET", undefined, false)).status,
    ).toBe(404);
    await json("/api/auth/sign-in/email", 200, "POST", { email, password });
    expect(cookies.has("savia.session_token")).toBe(true);
    // Bootstrap sign-in never bypasses required administrator MFA enrollment.
    expect((await request(base + "/objects")).status).toBe(403);
    const enrollment = await json("/api/auth/two-factor/enable", 200, "POST", {
      password,
      method: "totp",
    });
    await json("/api/auth/two-factor/verify-totp", 200, "POST", {
      code: totp(enrollment.totpURI),
    });
    if (qdrantUrl) {
      // Seed the existing tenant gates; the feature must never grant them itself.
      const database = openSqliteDatabase(join(directory, "core.sqlite"));
      try {
        await database
          .prepare(
            "INSERT INTO tenant_pages_search_settings(tenant_id,allowed,enabled,updated_at) VALUES(0,1,1,'2026-10-03')",
          )
          .run();
      } finally {
        database.close();
      }
      const page = await json("/v1/pages", 201, "POST", {
        title: "Automatic local indexing",
      });
      await expect
        .poll(async () => (await json("/v1/pages/search/status")).data.indexed)
        .toBe(1);
      const found = await json("/v1/pages/search?q=automatic");
      expect(found.data.map((hit: { id: string }) => hit.id)).toEqual([
        page.data.id,
      ]);
    }
    const providers = await json("/v1/personal-integrations/providers");
    expect(providers.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "github",
          attributes: expect.objectContaining({ availability: "enabled" }),
        }),
      ]),
    );
    for (const id of ["slack", "microsoft_teams"]) {
      expect(providers.data).toContainEqual(
        expect.objectContaining({
          id,
          attributes: expect.objectContaining({ availability: "enabled" }),
        }),
      );
    }
    const crmProviders = await json("/v1/crm/providers");
    for (const id of ["salesforce", "zoho", "pipedrive"]) {
      expect(crmProviders.data).toContainEqual(
        expect.objectContaining({
          id,
          attributes: expect.objectContaining({ availability: "enabled" }),
        }),
      );
    }
    const users = await json("/v1/identity/users");
    expect(users.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attributes: expect.objectContaining({ email }),
        }),
      ]),
    );
    const object = "restart_contacts";
    await json(base + "/objects", 201, "POST", {
      name: object,
      label: "Restart contacts",
      config: makeConfig({
        name: { type: "Textbox", label: "Name", required: true },
      }),
    });
    if (postgresUrl)
      await json(`${base}/records/${object}`, 422, "POST", {
        name: "invalid\u0000value",
      });
    const created = await json(`${base}/records/${object}`, 201, "POST", {
      name: "Before restart",
    });
    const id = created.data.id;
    await json(`${base}/records/${object}/${id}`, 200, "PATCH", {
      name: "Persisted update",
      _version: created.data._version,
    });
    const manifest = await json(base + "/local-sync/manifest");
    expect(manifest.principalId).toBeTruthy();
    expect(manifest.collections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: object, capability: "read-write" }),
      ]),
    );
    const pulled = await json(`${base}/local-sync/pull/${object}`);
    expect(pulled.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id, name: "Persisted update", _version: 2 }),
      ]),
    );
    expect(
      (
        await request(
          `${base}/local-sync/pull/${object}`,
          "GET",
          undefined,
          false,
        )
      ).status,
    ).toBe(401);
    if (qdrantUrl) {
      pauseEmbeddings = true;
      await json("/v1/pages", 201, "POST", {
        title: "Cancel indexing at shutdown",
      });
      await pausedEmbeddingStarted;
    }
    await app.close();
    app = undefined;
    if (qdrantUrl) {
      const database = openSqliteDatabase(join(directory, "core.sqlite"));
      try {
        expect(
          await database
            .prepare(
              "SELECT count(*) AS n FROM tenant_page_search_index_leases",
            )
            .first("n"),
        ).toBe(0);
      } finally {
        database.close();
      }
    }
    app = await createApplication(config, {});
    const restored = await json(`${base}/records/${object}/${id}`);
    expect(restored.data).toMatchObject({
      id,
      name: "Persisted update",
      _version: 2,
    });
    expect((await json(base + "/local-sync/manifest")).principalId).toBe(
      manifest.principalId,
    );
    const afterRestart = await json(`${base}/local-sync/pull/${object}`);
    expect(afterRestart.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id, name: "Persisted update", _version: 2 }),
      ]),
    );
    await json(`${base}/records/${object}/${id}?version=2`, 200, "DELETE");
    expect((await request(`${base}/records/${object}/${id}`)).status).toBe(404);
    const deleted = await json(`${base}/local-sync/pull/${object}`);
    expect(deleted.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id,
          _version: 3,
          deleted_at: expect.any(String),
        }),
      ]),
    );
  } finally {
    await app?.close();
    if (qdrantUrl) {
      await new Promise<void>((resolve, reject) =>
        embeddings.close((error) => (error ? reject(error) : resolve())),
      );
      await fetch(`${qdrantUrl}/collections/${collection}`, {
        method: "DELETE",
      });
    }
    rmSync(directory, { recursive: true, force: true });
  }
}
it(
  "enforces real administrator authentication and persists CRUD plus local-sync data across restart",
  () => applicationScenario(),
  30000,
);
it.skipIf(!postgresTestUrl)(
  "PostgreSQL: enforces real administrator authentication and persists CRUD plus local-sync data across restart",
  () => withPostgresFixture(async (_db, url) => applicationScenario(url)),
  60000,
);
it.skipIf(!process.env.SAVIA_TEST_QDRANT_URL)(
  "automatically indexes saved Pages through the authenticated Node runtime and live Qdrant",
  () => applicationScenario(undefined, process.env.SAVIA_TEST_QDRANT_URL),
  30000,
);
