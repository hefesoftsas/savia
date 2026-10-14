import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  validateFlowsSnapshotManifest,
  verifyFlowsSnapshotPages,
} from "./flows-snapshot.mjs";

const content = "flows-do-page";
const sha256 = createHash("sha256").update(content).digest("hex");
const snapshot = {
  version: 2,
  coverage: {
    version: 2,
    kinds: [
      "database",
      "mailbox",
      "workflow-agent",
      "agent-runner",
      "email-agent-runner",
    ],
  },
  id: "snap-preview-001",
  createdAt: "2026-10-12T12:00:00.000Z",
  executionEnabled: false,
  complete: true,
  objects: [
    {
      kind: "database",
      name: "flows-db",
      pages: [{ key: "__savia_backups/snap-preview-001/0/0.json", sha256 }],
    },
    {
      kind: "mailbox",
      name: "mailbox-1",
      pages: [{ key: "__savia_backups/snap-preview-001/1/0.json", sha256 }],
    },
  ],
};

describe("Flows runtime snapshot manifest", () => {
  it("accepts complete paused snapshots and rejects incomplete or unsafe inventories", () => {
    assert.deepEqual(validateFlowsSnapshotManifest(snapshot), snapshot);
    assert.throws(
      () => validateFlowsSnapshotManifest({ ...snapshot, complete: false }),
      /complete with execution disabled/,
    );
    assert.throws(
      () =>
        validateFlowsSnapshotManifest({ ...snapshot, executionEnabled: true }),
      /complete with execution disabled/,
    );
    assert.throws(
      () =>
        validateFlowsSnapshotManifest({
          ...snapshot,
          objects: [
            {
              ...snapshot.objects[0],
              pages: [{ key: "../../outside", sha256 }],
            },
          ],
        }),
      /safe|traversal|outside __savia_backups/,
    );
  });

  it("rejects empty, skipped, reordered, or cross-snapshot page inventories", () => {
    assert.throws(
      () =>
        validateFlowsSnapshotManifest({
          ...snapshot,
          objects: [{ ...snapshot.objects[0], pages: [] }],
        }),
      /at least one page/,
    );
    for (const key of [
      "__savia_backups/snap-preview-001/0/1.json",
      "__savia_backups/snap-preview-002/0/0.json",
      "__savia_backups/snap-preview-001/1/0.json",
    ]) {
      assert.throws(
        () =>
          validateFlowsSnapshotManifest({
            ...snapshot,
            objects: [{ ...snapshot.objects[0], pages: [{ key, sha256 }] }],
          }),
        /expected page key/,
      );
    }
    assert.throws(
      () =>
        validateFlowsSnapshotManifest({
          ...snapshot,
          objects: [
            {
              ...snapshot.objects[0],
              pages: [
                { key: "__savia_backups/snap-preview-001/0/1.json", sha256 },
                { key: "__savia_backups/snap-preview-001/0/0.json", sha256 },
              ],
            },
          ],
        }),
      /expected page key/,
    );
  });

  it("requires each inventory page in the resources bucket and checks its digest", async () => {
    const sourceDir = await mkdtemp(join(tmpdir(), "flows-snapshot-"));
    const key = snapshot.objects[0].pages[0].key;
    await mkdir(dirname(join(sourceDir, ...key.split("/"))), {
      recursive: true,
    });
    await writeFile(join(sourceDir, ...key.split("/")), content);
    const mailboxKey = snapshot.objects[1].pages[0].key;
    await mkdir(dirname(join(sourceDir, ...mailboxKey.split("/"))), {
      recursive: true,
    });
    await writeFile(join(sourceDir, ...mailboxKey.split("/")), content);
    const sidecar = {
      [key]: { httpMetadata: {}, customMetadata: {} },
      [mailboxKey]: { httpMetadata: {}, customMetadata: {} },
    };
    assert.equal(
      (
        await verifyFlowsSnapshotPages(snapshot, {
          bucket: "savia-flows-resources-preview",
          sidecar,
          sourceDir,
        })
      ).id,
      snapshot.id,
    );
    await assert.rejects(
      verifyFlowsSnapshotPages(snapshot, {
        bucket: "savia-flows-resources-preview",
        sidecar: {},
        sourceDir,
      }),
      /missing from/,
    );
    await writeFile(join(sourceDir, ...key.split("/")), "corrupted");
    await assert.rejects(
      verifyFlowsSnapshotPages(snapshot, {
        bucket: "savia-flows-resources-preview",
        sidecar,
        sourceDir,
      }),
      /SHA-256 does not match/,
    );
  });
});
