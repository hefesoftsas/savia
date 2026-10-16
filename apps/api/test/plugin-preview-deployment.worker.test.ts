import { describe, expect, it } from "vitest";
import worker from "../../../scripts/plugin-preview-deployment/worker";

const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "example.plugin",
  version: "2.0.0",
  label: "Example",
  description: "Example plugin",
  requires: [],
  apiVersion: 1,
};
const oldManifest = { ...manifest, version: "1.0.0" };
const storeJson = { format: "savia.store", formatVersion: 1, actions: [] };
const normalizedStoreJson = {
  ...storeJson,
  connectors: [],
  collections: [],
  monitors: [],
  bundles: [],
  widgets: [],
  screens: [],
};

class FakeD1 {
  tenants: string[];
  installations: Map<string, any>;
  artifacts: Map<string, any>;

  constructor(input: {
    tenants: string[];
    installations: Record<string, unknown>;
    artifacts: Record<string, unknown>;
  }) {
    this.tenants = input.tenants;
    this.installations = new Map(Object.entries(input.installations));
    this.artifacts = new Map(Object.entries(input.artifacts));
  }

  prepare(sql: string) {
    const db = this;
    let bindings: unknown[] = [];
    return {
      bind(...values: unknown[]) {
        bindings = values;
        return this;
      },
      async all() {
        if (sql.includes("FROM tenants"))
          return { results: db.tenants.map((scope) => ({ scope })) };
        throw new Error(`Unexpected all query: ${sql}`);
      },
      async first() {
        if (sql.includes("FROM studio_extension_installations"))
          return db.installations.get(`${bindings[0]}|${bindings[1]}`) ?? null;
        if (sql.includes("FROM plugin_store_artifacts"))
          return (
            db.artifacts.get(`${bindings[0]}|${bindings[1]}|${bindings[2]}`) ??
            null
          );
        throw new Error(`Unexpected first query: ${sql}`);
      },
    };
  }
}

function fixture(
  options: {
    tenant?: string;
    version?: string;
    enabled?: number;
    installedManifest?: unknown;
    artifactManifest?: unknown;
    storeJson?: unknown;
    digest?: string;
  } = {},
) {
  const tenant = options.tenant ?? "tenant:1";
  const version = options.version ?? "1.0.0";
  const entry = "export function render() { return '✓'; }";
  const artifact = {
    manifest: JSON.stringify(options.artifactManifest ?? oldManifest),
    entry_js: entry,
    store_json: JSON.stringify(options.storeJson ?? normalizedStoreJson),
    sha256: options.digest ?? "b".repeat(64),
  };
  return new FakeD1({
    tenants: [tenant],
    installations: {
      [`${tenant}|example.plugin`]: {
        version,
        enabled: options.enabled ?? 1,
        manifest: JSON.stringify(options.installedManifest ?? oldManifest),
      },
    },
    artifacts: { [`${tenant}|example.plugin|${version}`]: artifact },
  });
}

function plan(override: Record<string, unknown> = {}) {
  return {
    plugins: [
      {
        id: "example.plugin",
        previousVersion: "1.0.0",
        version: "2.0.0",
        manifest,
        storeJson,
        sha256: "a".repeat(64),
        ...override,
      },
    ],
  };
}

async function preflight(db: FakeD1, body = plan()) {
  return worker.fetch(
    new Request("https://publisher.internal/preflight", {
      method: "POST",
      headers: {
        authorization: "Bearer test-session",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    { DB: db as unknown as D1Database, DEPLOYMENT_SESSION: "test-session" },
  );
}

describe("private preview plugin deployment worker", () => {
  it("requires the private session bearer on every endpoint", async () => {
    const response = await worker.fetch(
      new Request("https://publisher.internal/tenants"),
      {
        DB: fixture() as unknown as D1Database,
        DEPLOYMENT_SESSION: "test-session",
      },
    );
    expect(response.status).toBe(401);
  });

  it("preflights tenants and captures rollback artifacts only for enabled installations", async () => {
    const db = fixture({ tenant: "tenant:12" });
    const entry = "export function render() { return '✓'; }";
    db.tenants.push("tenant:0", "tenant:13", "tenant:14");
    db.installations.set("tenant:13|example.plugin", {
      version: "2.0.0",
      enabled: 1,
      manifest: JSON.stringify(manifest),
    });
    db.artifacts.set("tenant:13|example.plugin|2.0.0", {
      manifest: JSON.stringify(manifest),
      entry_js: entry,
      store_json: JSON.stringify(storeJson),
      sha256: "a".repeat(64),
    });
    db.installations.set("tenant:14|example.plugin", {
      version: "1.0.0",
      enabled: 0,
      manifest: JSON.stringify(oldManifest),
    });
    db.artifacts.set("tenant:14|example.plugin|1.0.0", {
      manifest: JSON.stringify(oldManifest),
      entry_js: entry,
      store_json: JSON.stringify(normalizedStoreJson),
      sha256: "b".repeat(64),
    });
    db.tenants.sort();
    const response = await preflight(db);
    const payload = (await response.json()) as any;
    expect(response.status).toBe(200);
    expect(
      payload.checkpoint.plugins[0].tenants.map((item: any) => item.status),
    ).toEqual(["skip-missing", "update", "skip", "skip-disabled"]);
    const snapshot = payload.checkpoint.plugins[0].tenants[1].previousArtifact;
    expect(snapshot).toMatchObject({
      version: "1.0.0",
      storeJson: JSON.stringify(normalizedStoreJson),
      sha256: "b".repeat(64),
    });
    const binary = atob(snapshot.entryJsBase64);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    expect(new TextDecoder().decode(bytes)).toBe(entry);
  });

  it.each([
    ["changed current version", fixture({ version: "1.5.0" })],
    [
      "manifest API change",
      fixture({ artifactManifest: { ...oldManifest, apiVersion: 2 } }),
    ],
    [
      "store metadata change",
      fixture({
        storeJson: { ...normalizedStoreJson, actions: [{ id: "new" }] },
      }),
    ],
  ])("rejects %s before publication", async (_case, db) => {
    const response = await preflight(db as FakeD1);
    expect(response.status).toBe(409);
    expect(((await response.json()) as any).error).toBeTruthy();
  });

  it("treats only the exact version, digest, and metadata as idempotent", async () => {
    const exact = fixture({
      version: "2.0.0",
      installedManifest: manifest,
      artifactManifest: manifest,
      storeJson: storeJson,
      digest: "a".repeat(64),
    });
    const response = await preflight(exact);
    expect(response.status).toBe(200);
    expect(
      ((await response.json()) as any).checkpoint.plugins[0].tenants[0].status,
    ).toBe("skip");

    const wrongDigest = fixture({
      version: "2.0.0",
      installedManifest: manifest,
      artifactManifest: manifest,
      digest: "c".repeat(64),
    });
    expect((await preflight(wrongDigest)).status).toBe(409);
  });

  it.each([
    ["version", fixture({ version: "2.1.0" })],
    ["disabled state", fixture({ version: "2.0.0", enabled: 0 })],
  ])("does not roll back after a concurrent %s change", async (_case, db) => {
    const plugin = plan().plugins[0];
    const checkpoint = checkpointFor(plugin);
    const response = await rollback(db as FakeD1, checkpoint);
    const payload = (await response.json()) as any;
    expect(response.status).toBe(200);
    expect(payload.restored).toEqual([]);
    expect(payload.skipped).toHaveLength(1);
  });

  it("treats an update target not reached before failure as already restored", async () => {
    const db = fixture();
    const response = await rollback(db, checkpointFor(plan().plugins[0]));
    const payload = (await response.json()) as any;
    expect(response.status).toBe(200);
    expect(payload.unchanged).toEqual([
      { tenant: "tenant:1", id: "example.plugin", version: "1.0.0" },
    ]);
    expect(payload.skipped).toEqual([]);
  });
});

function checkpointFor(
  plugin: (typeof plan extends (...args: any[]) => infer R
    ? R
    : never)["plugins"][number],
) {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    plugins: [
      {
        id: plugin.id,
        version: plugin.version,
        previousVersion: plugin.previousVersion,
        sha256: plugin.sha256,
        tenants: [
          {
            tenant: "tenant:1",
            status: "update",
            previousInstallation: {
              version: "1.0.0",
              enabled: 1,
              manifest: JSON.stringify(oldManifest),
            },
            previousArtifact: {
              version: "1.0.0",
              manifest: JSON.stringify(oldManifest),
              entryJsBase64: "",
              storeJson: JSON.stringify(normalizedStoreJson),
              sha256: "b".repeat(64),
            },
          },
        ],
      },
    ],
  };
}

async function rollback(db: FakeD1, checkpoint: unknown) {
  return worker.fetch(
    new Request("https://publisher.internal/rollback", {
      method: "POST",
      headers: {
        authorization: "Bearer test-session",
        "content-type": "application/json",
      },
      body: JSON.stringify({ checkpoint }),
    }),
    { DB: db as unknown as D1Database, DEPLOYMENT_SESSION: "test-session" },
  );
}
