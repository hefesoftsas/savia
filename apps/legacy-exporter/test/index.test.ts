import { describe, expect, it } from "vitest";
import { createLegacyExporter } from "../src/index";
import type { ArchiveBucket, LegacyStore } from "../src/archive";

class MemoryBucket implements ArchiveBucket {
  readonly objects = new Map<string, Uint8Array>();

  async head(key: string) {
    const body = this.objects.get(key);
    return body ? { key, size: body.byteLength } : null;
  }

  async put(key: string, value: ArrayBuffer | Uint8Array | string) {
    const body =
      typeof value === "string" ? new TextEncoder().encode(value) : value;
    this.objects.set(
      key,
      body instanceof ArrayBuffer ? new Uint8Array(body) : body,
    );
    return { key, size: body.byteLength };
  }

  async list() {
    return { objects: [] };
  }

  async get() {
    return null;
  }

  async delete() {}
}

const store: LegacyStore = {
  name: "core",
  async close() {},
  async listTables() {
    return [];
  },
  async selectPage() {
    return [];
  },
};

describe("sealed legacy exporter", () => {
  it("hides the exporter from requests without the exact bearer", async () => {
    const worker = createLegacyExporter(
      { LEGACY_EXPORT_BEARER: "expected", ARCHIVE: new MemoryBucket() },
      { stores: () => [store], objectSources: [], kvSources: [] },
    );

    const response = await worker.fetch(
      new Request("https://savia.example.workers.dev/_internal/legacy-export", {
        method: "POST",
        headers: { authorization: "Bearer wrong" },
        body: JSON.stringify({ snapshotId: "snapshot-1" }),
      }),
    );

    expect(response.status).toBe(404);
  });

  it("returns status-only export evidence and refuses unverified cleanup", async () => {
    const worker = createLegacyExporter(
      { LEGACY_EXPORT_BEARER: "expected", ARCHIVE: new MemoryBucket() },
      { stores: () => [store], objectSources: [], kvSources: [] },
    );

    const exportResponse = await worker.fetch(
      new Request("https://savia.example.workers.dev/_internal/legacy-export", {
        method: "POST",
        headers: { authorization: "Bearer expected" },
        body: JSON.stringify({ snapshotId: "snapshot-1" }),
      }),
    );

    expect(exportResponse.status).toBe(201);
    expect(await exportResponse.json()).toEqual({
      snapshotId: "snapshot-1",
      streamCount: 0,
    });
    const cleanupResponse = await worker.fetch(
      new Request(
        "https://savia.example.workers.dev/_internal/legacy-cleanup",
        {
          method: "POST",
          headers: { authorization: "Bearer expected" },
          body: JSON.stringify({ snapshotId: "snapshot-1" }),
        },
      ),
    );
    expect(cleanupResponse.status).toBe(409);
    expect(
      await worker.fetch(new Request("https://savia.example.workers.dev/")),
    ).toMatchObject({
      status: 404,
    });
  });
});
