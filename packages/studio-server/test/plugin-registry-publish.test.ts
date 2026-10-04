import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readdirSync, readFileSync } from "node:fs";
import { migrationStatements } from "./migration-statements";
import { createStudioApp } from "../src/index";

let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;

function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ -1) >>> 0;
}

function zip(files: Array<{ name: string; text: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.text);
    const checksum = crc32(data);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint32(14, checksum, true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, name.length, true);
    local.push(new Uint8Array(header.buffer), name, data);
    const directory = new DataView(new ArrayBuffer(46));
    directory.setUint32(0, 0x02014b50, true);
    directory.setUint16(4, 20, true);
    directory.setUint16(6, 20, true);
    directory.setUint32(16, checksum, true);
    directory.setUint32(20, data.length, true);
    directory.setUint32(24, data.length, true);
    directory.setUint16(28, name.length, true);
    directory.setUint32(42, offset, true);
    central.push(new Uint8Array(directory.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const directoryBytes = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, directoryBytes, true);
  end.setUint32(16, offset, true);
  const output = new Uint8Array(offset + directoryBytes + 22);
  let cursor = 0;
  for (const part of [...local, ...central, new Uint8Array(end.buffer)]) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output;
}

const artifact = zip([
  {
    name: "savia-extension.json",
    text: JSON.stringify({
      format: "savia.extension",
      formatVersion: 1,
      id: "custom.demo",
      version: "1.0.0",
      label: "Demo",
      description: "Demo plugin",
      requires: [],
      apiVersion: 1,
    }),
  },
  {
    name: "dist/plugin.js",
    text: 'export function render(el, savia) { el.textContent = "demo"; }',
  },
]);

function app(options: {
  pluginRegistry?: { url: string; token: string; publishToken?: string };
  canManageExtension?: () => boolean;
}) {
  return createStudioApp("registry-publisher", {
    seedObjects: [],
    principalId: "registry-user",
    ...options,
  });
}

function publishRequest(studio: ReturnType<typeof app>, bytes = artifact) {
  const form = new FormData();
  form.set(
    "file",
    new File([bytes as BlobPart], "demo.zip", { type: "application/zip" }),
  );
  return studio.request(
    "http://localhost/api/plugin-store/registry/publish",
    { method: "POST", body: form },
    platform.env,
  );
}

beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  for (const file of readdirSync("migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort())
    for (const sql of migrationStatements(
      readFileSync(`migrations/${file}`, "utf8"),
    ))
      await platform.env.DB.prepare(sql).run();
});

afterAll(async () => {
  await platform?.dispose();
});

describe("plugin registry publishing", () => {
  it("shows publishing only when an explicit publisher credential exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: [], cursor: null })),
    );
    try {
      const response = await app({
        pluginRegistry: {
          url: "https://registry.example",
          token: "r".repeat(32),
        },
        canManageExtension: () => true,
      }).request(
        "http://localhost/api/plugin-store/registry",
        {},
        platform.env,
      );
      expect(await response.json()).toMatchObject({
        configured: true,
        canPublish: false,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("forwards validated upload bytes unchanged to the fixed immutable release URL", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(
          "https://registry.example/v1/plugins/custom.demo/1.0.0",
        );
        expect(init?.method).toBe("PUT");
        expect(new Headers(init?.headers).get("authorization")).toBe(
          `Bearer ${"p".repeat(32)}`,
        );
        expect(new Headers(init?.headers).get("content-type")).toBe(
          "application/zip",
        );
        expect(new Uint8Array(init?.body as ArrayBuffer)).toEqual(artifact);
        return Response.json(
          {
            data: {
              id: "custom.demo",
              version: "1.0.0",
              label: "Demo",
              sha256: "a".repeat(64),
              sizeBytes: artifact.length,
              createdAt: "2026-10-04T00:00:00.000Z",
            },
            deduped: false,
          },
          { status: 201 },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const response = await publishRequest(
        app({
          pluginRegistry: {
            url: "https://registry.example",
            token: "r".repeat(32),
            publishToken: "p".repeat(32),
          },
          canManageExtension: () => true,
        }),
      );
      expect(response.status).toBe(201);
      const responseBody = await response.json();
      expect(responseBody).toMatchObject({
        data: { id: "custom.demo", version: "1.0.0" },
      });
      expect(JSON.stringify(responseBody)).not.toContain("p".repeat(32));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps read-only tenants unable to publish and reports immutable version conflicts", async () => {
    const forbidden = await publishRequest(
      app({
        pluginRegistry: {
          url: "https://registry.example",
          token: "r".repeat(32),
          publishToken: "p".repeat(32),
        },
        canManageExtension: () => false,
      }),
    );
    expect(forbidden.status).toBe(403);

    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: { code: "IMMUTABLE_VERSION", message: "conflict" } },
        { status: 409 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const conflict = await publishRequest(
        app({
          pluginRegistry: {
            url: "https://registry.example",
            token: "r".repeat(32),
            publishToken: "p".repeat(32),
          },
          canManageExtension: () => true,
        }),
      );
      expect(conflict.status).toBe(409);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects malformed uploads and reports an unconfigured publisher", async () => {
    const noPublisher = await publishRequest(
      app({
        pluginRegistry: {
          url: "https://registry.example",
          token: "r".repeat(32),
        },
        canManageExtension: () => true,
      }),
    );
    expect(noPublisher.status).toBe(503);
    const invalid = await publishRequest(
      app({
        pluginRegistry: {
          url: "https://registry.example",
          token: "r".repeat(32),
          publishToken: "p".repeat(32),
        },
        canManageExtension: () => true,
      }),
      new Uint8Array([1, 2, 3]),
    );
    expect(invalid.status).toBe(422);
  });
});
