import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { makeConfig } from "../../../packages/crm-shared/src/metadata";
import { createApplication } from "../src/application";
import { loadConfiguration } from "../src/config";

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

it("enforces real administrator authentication and persists CRUD plus local-sync data across restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "savia-application-"));
  const origin = "http://localhost:8080";
  const email = "bootstrap@example.test",
    password = "Application-Smoke-Password-123!";
  const config = loadConfiguration({
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
  let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  const cookies = new Map<string, string>();
  const base = "/v1/data-domains/platform/api";
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
    app = await createApplication(config, {});
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
    const object = "restart_contacts";
    await json(base + "/objects", 201, "POST", {
      name: object,
      label: "Restart contacts",
      config: makeConfig({
        name: { type: "Textbox", label: "Name", required: true },
      }),
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
    await app.close();
    app = undefined;
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
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
