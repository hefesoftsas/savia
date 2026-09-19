import { describe, expect, it } from "vitest";
import {
  archiveSnapshot,
  cleanupLegacyObjects,
  type ArchiveBucket,
  type LegacyStore,
} from "../src/archive";

class MemoryBucket implements ArchiveBucket {
  readonly objects = new Map<string, Uint8Array>();

  async head(key: string) {
    const body = this.objects.get(key);
    return body ? { key, size: body.byteLength } : null;
  }

  async put(key: string, value: ArrayBuffer | Uint8Array | string) {
    const body =
      typeof value === "string"
        ? new TextEncoder().encode(value)
        : value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : value;
    this.objects.set(key, body);
    return { key, size: body.byteLength };
  }

  async list() {
    return {
      objects: [...this.objects].map(([key, body]) => ({
        key,
        size: body.byteLength,
      })),
    };
  }

  async get(key: string) {
    const body = this.objects.get(key);
    return body ? { arrayBuffer: async () => body.buffer.slice(0) } : null;
  }

  async delete(key: string) {
    this.objects.delete(key);
  }
}

function fakeStore(): LegacyStore {
  const rows = [{ id: "agency:1" }, { id: "agency:2" }];
  return {
    name: "core",
    async close() {},
    async listTables() {
      return ["agency"];
    },
    async selectPage(_table, { limit, start }) {
      return rows.slice(start, start + limit);
    },
  };
}

describe("legacy snapshot archive", () => {
  it("writes every Surreal page as canonical JSON Lines and records a digest", async () => {
    const archive = new MemoryBucket();

    const result = await archiveSnapshot({
      snapshotId: "snapshot-1",
      stores: [fakeStore()],
      archive,
      objectSources: [],
      kvSources: [],
      pageSize: 1,
    });

    expect(result.streams).toContainEqual(
      expect.objectContaining({
        sourceType: "surreal",
        sourceName: "core:agency",
        records: 2,
        destinationPrefix:
          "legacy-import/snapshot-1/surreal/core/agency.ndjson",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(
      new TextDecoder().decode(
        archive.objects.get(
          "legacy-import/snapshot-1/surreal/core/agency.ndjson",
        ),
      ),
    ).toBe('{"id":"agency:1"}\n{"id":"agency:2"}\n');
    expect(archive.objects.has("legacy-import/snapshot-1/manifest.json")).toBe(
      true,
    );
  });

  it("rejects a snapshot identifier that already has an immutable manifest", async () => {
    const archive = new MemoryBucket();
    await archive.put("legacy-import/snapshot-1/manifest.json", "present");

    await expect(
      archiveSnapshot({
        snapshotId: "snapshot-1",
        stores: [fakeStore()],
        archive,
        objectSources: [],
        kvSources: [],
      }),
    ).rejects.toThrow("snapshot already exists");
  });

  it("does not delete an object source until its manifest has been verified", async () => {
    const bucket = new MemoryBucket();
    await bucket.put("legacy.pdf", "document");

    await expect(
      cleanupLegacyObjects({
        verified: false,
        r2Sources: [{ name: "production", bucket }],
        kvSources: [],
      }),
    ).rejects.toThrow("verified manifest");
    expect(bucket.objects.has("legacy.pdf")).toBe(true);
  });
});
