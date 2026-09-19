import { createHmac, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import WebSocket from "ws";
import { makeConfig } from "../../../packages/crm-shared/src/metadata";

// Run only against a disposable Docker fixture. No production/default origin.
const origin = process.env.SAVIA_DOCKER_TEST_ORIGIN;
const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;
const statePath = process.env.SAVIA_DOCKER_TEST_STATE_FILE;
type State = {
  origin: string;
  email: string;
  totpURI?: string;
  lastTotpStep?: number;
  fixture?: {
    tenantId: number;
    collection: string;
    recordId: string;
    syncCursor?: string;
    deletedRecordId?: string;
    history?: unknown[];
    fileId?: string;
    attachment?: string;
    publicFormId?: string;
    publicFormToken?: string;
    publicSubmissionId?: string;
    publicReceipt?: string;
  };
};
function stateFile() {
  if (!statePath) return undefined;
  const path = resolve(statePath);
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const subpath = relative(root, path);
  if (
    !subpath.startsWith(`..${sep}`) &&
    subpath !== ".." &&
    !subpath.startsWith(`infra${sep}secrets${sep}`)
  )
    throw new Error(
      "Keep SAVIA_DOCKER_TEST_STATE_FILE outside the repository or inside ignored infra/secrets/.",
    );
  if (existsSync(path) && lstatSync(path).isSymbolicLink())
    throw new Error("MFA state file must not be a symbolic link.");
  return path;
}
function saveState(path: string | undefined, state: State) {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(state), { mode: 0o600 });
  chmodSync(path, 0o600);
}
function totp(uri: string) {
  const url = new URL(uri),
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let value = 0,
    bits = 0;
  const bytes: number[] = [];
  for (const char of url.searchParams.get("secret")!.replace(/=+$/, "")) {
    const part = alphabet.indexOf(char);
    if (part < 0) throw new Error("Invalid TOTP enrollment secret");
    value = (value << 5) | part;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 255);
    }
  }
  const step = Math.floor(Date.now() / 30_000);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", Buffer.from(bytes))
    .update(counter)
    .digest();
  return {
    step,
    code: ((digest.readUInt32BE(digest.at(-1)! & 15) & 0x7fffffff) % 1_000_000)
      .toString()
      .padStart(6, "0"),
  };
}
function socketMessage(
  socket: WebSocket,
  matches: (value: unknown) => boolean,
) {
  return new Promise<any>((resolveMessage, reject) => {
    const timeout = setTimeout(
      () => finish(new Error("Timed out waiting for realtime message")),
      10_000,
    );
    const onError = (error: Error) => finish(error);
    const onClose = () =>
      finish(new Error("Realtime socket closed before its expected message"));
    const onMessage = (bytes: WebSocket.RawData) => {
      let value: unknown = bytes.toString();
      try {
        value = JSON.parse(value as string);
      } catch {
        /* ping uses a plain-text response */
      }
      if (matches(value)) finish(undefined, value);
    };
    const finish = (error?: Error, value?: unknown) => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("error", onError);
      socket.off("close", onClose);
      if (error) reject(error);
      else resolveMessage(value);
    };
    socket.on("message", onMessage);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}
async function rejectedUpgrade(url: string, cookie: string) {
  const socket = new WebSocket(url, {
    headers: { Cookie: cookie },
    handshakeTimeout: 10_000,
  });
  try {
    return await new Promise<number>((resolveStatus, reject) => {
      socket.once("unexpected-response", (request, response) => {
        resolveStatus(response.statusCode!);
        response.resume();
        request.destroy();
      });
      socket.once("open", () => resolveStatus(101));
      socket.on("error", reject);
    });
  } finally {
    socket.terminate();
  }
}

test.skipIf(!origin || !email || !password)(
  "Docker HTTP: real MFA, tenant CRUD/sync, S3 files, self-hosted CAPTCHA and one-use WebSockets",
  async () => {
    const baseOrigin = new URL(origin!).origin;
    const path = stateFile();
    const state: State =
      path && existsSync(path)
        ? JSON.parse(readFileSync(path, "utf8"))
        : { origin: baseOrigin, email: email! };
    if (state.origin !== baseOrigin || state.email !== email)
      throw new Error(
        "Saved MFA state belongs to a different fixture origin or account.",
      );
    const cookies = new Map<string, string>();
    const cookieHeader = () =>
      [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
    async function request(
      route: string,
      init: RequestInit = {},
      authenticated = true,
    ) {
      const headers = new Headers(init.headers);
      headers.set("origin", baseOrigin);
      if (authenticated && cookies.size) headers.set("cookie", cookieHeader());
      const response = await fetch(baseOrigin + route, {
        ...init,
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
      });
      if (authenticated)
        for (const header of response.headers.getSetCookie()) {
          const pair = header.split(";")[0],
            index = pair.indexOf("=");
          cookies.set(pair.slice(0, index), pair.slice(index + 1));
        }
      return response;
    }
    async function json(
      route: string,
      status = 200,
      method = "GET",
      body?: unknown,
      authenticated = true,
    ) {
      const response = await request(
        route,
        {
          method,
          ...(body === undefined
            ? {}
            : {
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
              }),
        },
        authenticated,
      );
      expect(
        response.status,
        `${method} ${route}: ${await response.clone().text()}`,
      ).toBe(status);
      return response.json() as Promise<any>;
    }
    let socket: WebSocket | undefined;
    try {
      expect(
        (await json("/health", 200, "GET", undefined, false)).database,
      ).toBe("ok");
      expect((await request("/v1/tenants", {}, false)).status).toBe(401);
      const mcpMetadata = await json(
        "/.well-known/oauth-protected-resource/mcp",
        200,
        "GET",
        undefined,
        false,
      );
      expect(mcpMetadata.resource).toBe(`${baseOrigin}/mcp`);
      const mcpChallenge = await request(
        "/mcp",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
        false,
      );
      expect(mcpChallenge.status).toBe(401);
      expect(mcpChallenge.headers.get("www-authenticate")).toContain(
        "oauth-protected-resource/mcp",
      );
      const internal = await request("/_internal/session", {}, false);
      expect(internal.headers.get("content-type")).toContain("text/html");
      expect(await internal.text()).toContain('<div id="root"></div>');
      const signIn = await json("/api/auth/sign-in/email", 200, "POST", {
        email,
        password,
      });
      if (signIn.twoFactorRedirect) {
        if (!state.totpURI)
          throw new Error(
            "This fixture already requires MFA. Provide its SAVIA_DOCKER_TEST_STATE_FILE or use a fresh Docker fixture.",
          );
        // A quick rerun must not reuse the OTP from the preceding test session.
        if (state.lastTotpStep === Math.floor(Date.now() / 30_000))
          await new Promise((resolveWait) =>
            setTimeout(resolveWait, 30_000 - (Date.now() % 30_000) + 200),
          );
      } else {
        expect((await request("/v1/tenants")).status).toBe(403);
        const enrolled = await json(
          "/api/auth/two-factor/enable",
          200,
          "POST",
          { password, method: "totp" },
        );
        state.totpURI = enrolled.totpURI;
        saveState(path, state);
      }
      const otp = totp(state.totpURI!);
      await json("/api/auth/two-factor/verify-totp", 200, "POST", {
        code: otp.code,
      });
      state.lastTotpStep = otp.step;
      saveState(path, state);

      if (state.fixture) {
        const previous = state.fixture;
        const previousBase = `/v1/dynamic-crm/${previous.tenantId}/api`;
        expect(
          (
            await json(
              `${previousBase}/records/${previous.collection}/${previous.recordId}`,
            )
          ).data.name,
        ).toBe("Docker updated");
        expect(
          (await json(`${previousBase}/local-sync/pull/${previous.collection}`))
            .documents,
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: previous.recordId,
              name: "Docker updated",
            }),
          ]),
        );
        if (previous.syncCursor) {
          const delta = await json(
            `${previousBase}/local-sync/pull/${previous.collection}?cursor=${encodeURIComponent(previous.syncCursor)}`,
          );
          expect(delta.documents).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                id: previous.recordId,
                name: "Docker updated",
              }),
            ]),
          );
          if (previous.deletedRecordId)
            expect(delta.documents).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  id: previous.deletedRecordId,
                  deleted_at: expect.any(String),
                }),
              ]),
            );
        }
        if (previous.history)
          expect(
            (
              await json(
                `${previousBase}/record-history/${previous.collection}/${previous.recordId}`,
              )
            ).data,
          ).toEqual(previous.history);
        if (previous.fileId) {
          const restoredFile = await request(
            `${previousBase}/file/${previous.fileId}/download`,
          );
          expect(restoredFile.status).toBe(200);
          expect(await restoredFile.text()).toBe(previous.attachment);
        }
        if (previous.publicFormToken)
          expect(
            (
              await json(
                `/api/public/forms/${previous.publicFormToken}`,
                200,
                "GET",
                undefined,
                false,
              )
            ).captchaProvider,
          ).toBe("altcha");
      }
      const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
      const tenant = (
        await json("/v1/tenants", 201, "POST", {
          name: `Docker smoke ${suffix}`,
          idSlug: `docker-smoke-${suffix}`,
          initialUser: {
            email: `docker-${suffix}@example.test`,
            firstName: "Docker",
            lastName: "Smoke",
            role: "tenant_admin",
            temporaryPassword: `Docker-${randomUUID()}-Aa1!`,
          },
        })
      ).data;
      expect(tenant.id).toBeGreaterThan(0);
      const base = `/v1/dynamic-crm/${tenant.id}/api`,
        collection = `docker_${suffix}`;
      await json(`${base}/objects`, 201, "POST", {
        name: collection,
        label: "Docker integration records",
        config: makeConfig({
          name: { type: "Textbox", label: "Name", required: true },
        }),
      });
      await json(`${base}/record-history-settings/${collection}`, 200, "PUT", {
        enabled: true,
        fields: ["name"],
        retentionDays: 90,
        expectedVersion: 1,
      });
      const record = (
        await json(`${base}/records/${collection}`, 201, "POST", {
          name: "Docker persisted",
        })
      ).data;
      state.fixture = { tenantId: tenant.id, collection, recordId: record.id };
      saveState(path, state);
      expect(
        (await json(`${base}/records/${collection}/${record.id}`)).data.name,
      ).toBe("Docker persisted");
      const pulled = await json(`${base}/local-sync/pull/${collection}`);
      state.fixture.syncCursor = pulled.cursor;
      saveState(path, state);
      expect(pulled.documents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: record.id, name: "Docker persisted" }),
        ]),
      );
      expect(
        (await request(`${base}/records/${collection}/${record.id}`, {}, false))
          .status,
      ).toBe(401);

      const ticket = (
        await json("/v1/realtime/ticket", 201, "POST", {
          tenantId: tenant.id,
          topics: ["records"],
        })
      ).data;
      const url = new URL("/v1/realtime/subscribe", baseOrigin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("room", ticket.room);
      url.searchParams.set("ticket", ticket.ticket);
      socket = new WebSocket(url, {
        headers: { Cookie: cookieHeader(), Origin: baseOrigin },
        handshakeTimeout: 10_000,
      });
      expect(
        await socketMessage(
          socket,
          (message: any) => message?.type === "connected",
        ),
      ).toMatchObject({ v: 1, topic: "records", type: "connected" });
      const pong = socketMessage(socket, (message) => message === "pong");
      socket.send("ping");
      expect(await pong).toBe("pong");
      const change = socketMessage(
        socket,
        (message: any) =>
          message?.collection === collection && message?.type === "updated",
      );
      const [, notification] = await Promise.all([
        json(`${base}/records/${collection}/${record.id}`, 200, "PATCH", {
          name: "Docker updated",
          _version: record._version,
        }),
        change,
      ]);
      expect(notification).toMatchObject({
        topic: "records",
        type: "updated",
        collection,
        id: record.id,
      });
      expect(JSON.stringify(notification)).not.toContain("Docker updated");
      expect(await rejectedUpgrade(url.toString(), cookieHeader())).toBe(401);

      const attachment = `Docker S3 bytes ${suffix}\n`;
      const form = new FormData();
      form.append(
        "file",
        new File([attachment], "docker-smoke.txt", { type: "text/plain" }),
      );
      const upload = await request(`${base}/files/${collection}/${record.id}`, {
        method: "POST",
        body: form,
      });
      expect(upload.status, await upload.clone().text()).toBe(201);
      const file = ((await upload.json()) as any).data;
      const download = await request(`${base}/file/${file.id}/download`);
      expect(download.status).toBe(200);
      expect(await download.text()).toBe(attachment);
      expect(
        (await request(`${base}/file/${file.id}/download`, {}, false)).status,
      ).toBe(401);
      state.fixture.fileId = file.id;
      state.fixture.attachment = attachment;
      saveState(path, state);

      const published = (
        await json("/v1/public-forms", 201, "POST", {
          domainId: `tenant:${tenant.id}`,
          objectName: collection,
          kind: "record",
        })
      ).data;
      const publicPath = `/api/public/forms/${published.token}`;
      const definition = await json(publicPath, 200, "GET", undefined, false);
      expect(definition.captchaProvider).toBe("altcha");
      expect(definition.siteKey).toBeUndefined();
      const challenge = await json(
        `${publicPath}/challenge`,
        200,
        "GET",
        undefined,
        false,
      );
      expect(challenge.parameters.data.formId).toBe(published.id);
      // Resolve the already-installed API dependency; this is the same algorithm used by the bundled widget.
      const apiRequire = createRequire(
        new URL("../../api/package.json", import.meta.url),
      );
      const { solveChallenge } = apiRequire("altcha-lib");
      const { deriveKey } = apiRequire("altcha-lib/algorithms/pbkdf2");
      const solution = await solveChallenge({ challenge, deriveKey });
      expect(solution).not.toBeNull();
      const submissionId = randomUUID();
      const payload = {
        submissionId,
        token: btoa(JSON.stringify({ challenge, solution })),
        values: { name: `Public Docker ${suffix}` },
      };
      const receipt = await json(publicPath, 200, "POST", payload, false);
      expect(receipt).toMatchObject({
        ok: true,
        reference: expect.any(String),
      });
      expect(await json(publicPath, 200, "POST", payload, false)).toEqual(
        receipt,
      );
      await json(
        publicPath,
        429,
        "POST",
        { ...payload, submissionId: randomUUID() },
        false,
      );
      expect((await request(`${publicPath}/records`, {}, false)).status).toBe(
        404,
      );
      const synced = await json(`${base}/local-sync/pull/${collection}`);
      expect(synced.documents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: `Public Docker ${suffix}` }),
        ]),
      );
      state.fixture.publicFormId = published.id;
      state.fixture.publicFormToken = published.token;
      state.fixture.publicSubmissionId = submissionId;
      state.fixture.publicReceipt = receipt.reference;
      const removed = (
        await json(`${base}/records/${collection}`, 201, "POST", {
          name: "Docker tombstone",
        })
      ).data;
      await json(
        `${base}/records/${collection}/${removed.id}?version=${removed._version}`,
        200,
        "DELETE",
      );
      state.fixture.deletedRecordId = removed.id;
      state.fixture.history = (
        await json(`${base}/record-history/${collection}/${record.id}`)
      ).data;
      expect(state.fixture.history!.length).toBeGreaterThan(0);
      saveState(path, state);
      // Leave the fixture IDs in the private state file for an external container restart check.
    } finally {
      socket?.terminate();
    }
  },
  120_000,
);

test.skipIf(!origin)(
  "renders authentication pages in the native Docker runtime",
  async () => {
    for (const path of [
      "/api/auth/login",
      "/api/auth/mfa-enroll",
      "/api/auth/consent",
    ]) {
      const response = await fetch(new URL(path, origin));
      expect(response.status, path).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(await response.text()).toContain("<form");
    }
  },
);
