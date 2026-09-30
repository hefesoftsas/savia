import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";

const writeToken = "registry-test-publisher";
const readOnlyToken = "registry-test-reader";
const otherNamespaceToken = "registry-test-other";
type RegistryTestEnv = {
  PLUGIN_REGISTRY: R2Bucket;
  REGISTRY_CREDENTIALS: string;
};
const registryEnv = env as unknown as RegistryTestEnv;
let requestEnv: RegistryTestEnv;

function body(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

async function zip(entries: Record<string, string>): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const filename = encoder.encode(name);
    const data = encoder.encode(value);
    const localHeader = new Uint8Array(30 + filename.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(26, filename.length, true);
    localHeader.set(filename, 30);
    local.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + filename.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, filename.length, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(filename, 46);
    central.push(centralHeader);
    offset += localHeader.length + data.length;
  }
  const centralSize = central.reduce((size, part) => size + part.length, 0);
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, Object.keys(entries).length, true);
  view.setUint16(10, Object.keys(entries).length, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, offset, true);
  const parts = [...local, ...central, end];
  const result = new Uint8Array(
    parts.reduce((size, part) => size + part.length, 0),
  );
  let cursor = 0;
  for (const part of parts) {
    result.set(part, cursor);
    cursor += part.length;
  }
  return result;
}

function archive(version = "1.0.0", pluginCode = "export default {}; ") {
  return zip({
    "savia-extension.json": JSON.stringify({
      format: "savia.extension",
      formatVersion: 1,
      id: "custom.sample",
      version,
      label: "Sample plugin",
      description: "Registry test plugin",
      requires: [],
      apiVersion: 1,
    }),
    "dist/plugin.js": pluginCode,
  });
}

function request(path: string, token = writeToken, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  return worker.fetch(
    new Request(`https://registry.test${path}`, { ...init, headers }),
    requestEnv,
  );
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", body(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashToken(token: string) {
  return sha256(new TextEncoder().encode(token));
}

beforeEach(async () => {
  const listed = await registryEnv.PLUGIN_REGISTRY.list({ prefix: "" });
  if (listed.objects.length)
    await registryEnv.PLUGIN_REGISTRY.delete(
      listed.objects.map((object) => object.key),
    );
  requestEnv = {
    PLUGIN_REGISTRY: registryEnv.PLUGIN_REGISTRY,
    REGISTRY_CREDENTIALS: JSON.stringify([
      {
        tokenSha256: await hashToken(writeToken),
        namespace: "team-one",
        permissions: ["read", "publish"],
      },
      {
        tokenSha256: await hashToken(readOnlyToken),
        namespace: "team-one",
        permissions: ["read"],
      },
      {
        tokenSha256: await hashToken(otherNamespaceToken),
        namespace: "team-two",
        permissions: ["read", "publish"],
      },
    ]),
  };
});

describe("private plugin registry", () => {
  it("requires a valid bearer token for every route", async () => {
    const response = await worker.fetch(
      new Request("https://registry.test/v1/plugins"),
      requestEnv,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("denies publication to read-only credentials", async () => {
    const response = await request("/v1/plugins", readOnlyToken, {
      method: "PUT",
      headers: { "content-type": "application/zip" },
      body: body(await archive()),
    });
    expect(response.status).toBe(403);
  });

  it("fails closed when the configured credential hashes are ambiguous", async () => {
    const duplicateEnv = {
      ...requestEnv,
      REGISTRY_CREDENTIALS: JSON.stringify([
        {
          tokenSha256: await hashToken(writeToken),
          namespace: "team-one",
          permissions: ["read", "publish"],
        },
        {
          tokenSha256: await hashToken(writeToken),
          namespace: "team-two",
          permissions: ["read", "publish"],
        },
      ]),
    };
    const response = await worker.fetch(
      new Request("https://registry.test/v1/plugins", {
        headers: { authorization: `Bearer ${writeToken}` },
      }),
      duplicateEnv,
    );
    expect(response.status).toBe(503);
  });

  it("publishes, lists, and downloads the original ZIP with its raw digest", async () => {
    const original = await archive();
    const published = await request(
      "/v1/plugins/custom.sample/1.0.0",
      writeToken,
      {
        method: "PUT",
        headers: { "content-type": "application/zip" },
        body: body(original),
      },
    );
    expect(published.status).toBe(201);
    const publication = await published.json<any>();
    expect(publication.data).toMatchObject({
      id: "custom.sample",
      version: "1.0.0",
      label: "Sample plugin",
      sha256: await sha256(original),
      sizeBytes: original.length,
    });
    expect(publication.deduped).toBe(false);

    const listing = await request("/v1/plugins", writeToken);
    expect(await listing.json()).toMatchObject({
      data: [publication.data],
      cursor: null,
    });

    const downloaded = await request(
      "/v1/plugins/custom.sample/1.0.0",
      readOnlyToken,
    );
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("x-plugin-sha256")).toBe(
      await sha256(original),
    );
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(original);
  });

  it("deduplicates repacked semantic content while preserving original bytes", async () => {
    const original = await archive();
    await request("/v1/plugins/custom.sample/1.0.0", writeToken, {
      method: "PUT",
      headers: { "content-type": "application/zip" },
      body: body(original),
    });
    const repack = await zip({
      "dist/plugin.js": "export default {}; ",
      "savia-extension.json": JSON.stringify({
        apiVersion: 1,
        requires: [],
        description: "Registry test plugin",
        label: "Sample plugin",
        version: "1.0.0",
        id: "custom.sample",
        formatVersion: 1,
        format: "savia.extension",
      }),
    });
    const retry = await request("/v1/plugins/custom.sample/1.0.0", writeToken, {
      method: "PUT",
      headers: { "content-type": "application/zip" },
      body: body(repack),
    });
    expect(retry.status).toBe(200);
    expect(await retry.json<any>()).toMatchObject({
      data: { sha256: await sha256(original), sizeBytes: original.length },
      deduped: true,
    });
    const downloaded = await request(
      "/v1/plugins/custom.sample/1.0.0",
      readOnlyToken,
    );
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(original);
  });

  it("creates an immutable version once when identical publishes race", async () => {
    const original = await archive();
    const publish = () =>
      request("/v1/plugins/custom.sample/1.0.0", writeToken, {
        method: "PUT",
        headers: { "content-type": "application/zip" },
        body: body(original),
      });
    const responses = await Promise.all([publish(), publish()]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 201,
    ]);
    const downloaded = await request(
      "/v1/plugins/custom.sample/1.0.0",
      readOnlyToken,
    );
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(original);
  });

  it("rejects changed semantic content under an existing version", async () => {
    await request("/v1/plugins/custom.sample/1.0.0", writeToken, {
      method: "PUT",
      headers: { "content-type": "application/zip" },
      body: body(await archive()),
    });
    const changed = await request(
      "/v1/plugins/custom.sample/1.0.0",
      writeToken,
      {
        method: "PUT",
        headers: { "content-type": "application/zip" },
        body: body(await archive("1.0.0", "export default { changed: true };")),
      },
    );
    expect(changed.status).toBe(409);
  });

  it("rejects a path that disagrees with the manifest and malformed ZIPs", async () => {
    const mismatch = await request(
      "/v1/plugins/other.plugin/1.0.0",
      writeToken,
      {
        method: "PUT",
        headers: { "content-type": "application/zip" },
        body: body(await archive()),
      },
    );
    expect(mismatch.status).toBe(400);
    const malformed = await request(
      "/v1/plugins/custom.sample/1.0.0",
      writeToken,
      {
        method: "PUT",
        headers: { "content-type": "application/zip" },
        body: body(new Uint8Array([0x50, 0x4b])),
      },
    );
    expect(malformed.status).toBe(400);
  });

  it("bounds streamed request bodies at the ZIP limit", async () => {
    const tooLarge = new Uint8Array(6 * 1024 * 1024 + 1);
    tooLarge[0] = 0x50;
    tooLarge[1] = 0x4b;
    const response = await request(
      "/v1/plugins/custom.sample/1.0.0",
      writeToken,
      {
        method: "PUT",
        headers: { "content-type": "application/zip" },
        body: body(tooLarge),
      },
    );
    expect(response.status).toBe(413);
  });

  it("limits pages to 100 releases and resumes with an opaque cursor", async () => {
    const createdAt = "2026-09-30T00:00:00.000Z";
    for (let index = 0; index < 101; index++) {
      const id = `custom.page-${String(index).padStart(3, "0")}`;
      await requestEnv.PLUGIN_REGISTRY.put(
        `team-one/${id}/1.0.0.zip`,
        new Uint8Array([0x50, 0x4b]),
        {
          customMetadata: {
            id,
            version: "1.0.0",
            label: "Page item",
            sha256: "a".repeat(64),
            semanticSha256: "b".repeat(64),
            sizeBytes: "2",
            createdAt,
            publisherTokenSha256: "c".repeat(64),
          },
        },
      );
    }
    const first = await request("/v1/plugins");
    const page1 = await first.json<any>();
    expect(page1.data).toHaveLength(100);
    expect(page1.cursor).toEqual(expect.any(String));
    expect(page1.cursor).not.toContain("team-one/");
    const page2Response = await request(
      `/v1/plugins?cursor=${encodeURIComponent(page1.cursor)}`,
    );
    const page2 = await page2Response.json<any>();
    expect(page2.data).toHaveLength(1);
    expect(page2.cursor).toBeNull();
    expect(
      new Set([...page1.data, ...page2.data].map((release: any) => release.id))
        .size,
    ).toBe(101);
  });

  it("rejects cursors that are too long or belong to another namespace", async () => {
    const tooLong = await request(`/v1/plugins?cursor=${"a".repeat(2049)}`);
    expect(tooLong.status).toBe(400);
    const foreignCursor = btoa("team-two\0opaque-cursor").replace(/=/g, "");
    const foreign = await request(
      `/v1/plugins?cursor=${encodeURIComponent(foreignCursor)}`,
    );
    expect(foreign.status).toBe(400);
  });

  it("keeps namespaces isolated", async () => {
    await request("/v1/plugins/custom.sample/1.0.0", writeToken, {
      method: "PUT",
      headers: { "content-type": "application/zip" },
      body: body(await archive()),
    });
    expect(
      (
        await request("/v1/plugins", otherNamespaceToken).then((response) =>
          response.json<any>(),
        )
      ).data,
    ).toEqual([]);
    expect(
      (await request("/v1/plugins/custom.sample/1.0.0", otherNamespaceToken))
        .status,
    ).toBe(404);
  });
});
