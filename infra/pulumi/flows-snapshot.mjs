import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { assertSafeR2Key } from "./naming.mjs";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export const FLOWS_SNAPSHOT_COVERAGE = Object.freeze({
  version: 3,
  kinds: [
    "database",
    "mailbox",
    "workflow-agent",
    "agent-runner",
    "email-agent-runner",
  ],
  storage: {
    database: ["sqlite"],
    mailbox: ["sqlite"],
    "workflow-agent": ["sqlite", "kv"],
    "agent-runner": ["sqlite"],
    "email-agent-runner": ["kv"],
  },
});

export function hasCompleteFlowsCoverage(coverage) {
  const expected = FLOWS_SNAPSHOT_COVERAGE;
  return (
    isRecord(coverage) &&
    coverage.version === expected.version &&
    JSON.stringify(coverage.kinds) === JSON.stringify(expected.kinds) &&
    isRecord(coverage.storage) &&
    JSON.stringify(Object.keys(coverage.storage).sort()) ===
      JSON.stringify(Object.keys(expected.storage).sort()) &&
    Object.entries(expected.storage).every(
      ([kind, stores]) =>
        JSON.stringify(coverage.storage[kind]) === JSON.stringify(stores),
    )
  );
}

export function validateFlowsSnapshotManifest(snapshot) {
  if (!isRecord(snapshot) || snapshot.version !== 3) {
    throw new Error("Unsupported Flows runtime snapshot manifest version");
  }
  if (
    typeof snapshot.id !== "string" ||
    !/^[A-Za-z0-9._-]+$/.test(snapshot.id)
  ) {
    throw new Error("Flows runtime snapshot manifest has an invalid id");
  }
  if (
    typeof snapshot.createdAt !== "string" ||
    !Number.isFinite(Date.parse(snapshot.createdAt))
  ) {
    throw new Error("Flows runtime snapshot manifest has an invalid createdAt");
  }
  if (snapshot.executionEnabled !== false || snapshot.complete !== true) {
    throw new Error(
      "Flows runtime snapshot must be complete with execution disabled",
    );
  }
  if (!Array.isArray(snapshot.objects)) {
    throw new Error(
      "Flows runtime snapshot manifest is missing its objects list",
    );
  }
  const expectedKinds = FLOWS_SNAPSHOT_COVERAGE.kinds;
  if (!hasCompleteFlowsCoverage(snapshot.coverage)) {
    throw new Error(
      "Flows runtime snapshot does not confirm complete persistence coverage",
    );
  }
  const seen = new Set();
  const objects = snapshot.objects.map((object, targetIndex) => {
    if (
      !isRecord(object) ||
      ![
        "database",
        "mailbox",
        "workflow-agent",
        "agent-runner",
        "email-agent-runner",
      ].includes(object.kind)
    ) {
      throw new Error("Flows runtime snapshot contains an invalid object kind");
    }
    if (typeof object.name !== "string" || object.name.trim() === "") {
      throw new Error("Flows runtime snapshot contains an invalid object name");
    }
    if (!Array.isArray(object.pages)) {
      throw new Error(
        `Flows runtime snapshot pages are missing for ${object.name}`,
      );
    }
    if (object.pages.length === 0) {
      throw new Error(
        `Flows runtime snapshot must include at least one page for ${object.name}`,
      );
    }
    const pages = object.pages.map((page, pageIndex) => {
      if (!isRecord(page) || typeof page.key !== "string") {
        throw new Error(
          `Flows runtime snapshot contains an invalid page for ${object.name}`,
        );
      }
      assertSafeR2Key(page.key);
      if (!/^__savia_backups\//.test(page.key)) {
        throw new Error(
          `Flows runtime snapshot page is outside __savia_backups/: ${page.key}`,
        );
      }
      const expectedKey = `__savia_backups/${snapshot.id}/${targetIndex}/${pageIndex}.json`;
      if (page.key !== expectedKey) {
        throw new Error(
          `Flows runtime snapshot has an unexpected page key for ${object.name}; expected page key ${expectedKey}`,
        );
      }
      if (
        typeof page.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(page.sha256)
      ) {
        throw new Error(
          `Flows runtime snapshot page has an invalid SHA-256: ${page.key}`,
        );
      }
      if (seen.has(page.key))
        throw new Error(`Flows runtime snapshot repeats page ${page.key}`);
      seen.add(page.key);
      return { key: page.key, sha256: page.sha256 };
    });
    return { kind: object.kind, name: object.name, pages };
  });
  return {
    version: 3,
    coverage: FLOWS_SNAPSHOT_COVERAGE,
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    executionEnabled: false,
    complete: true,
    objects,
  };
}

export async function verifyFlowsSnapshotPages(
  snapshot,
  { bucket, sidecar, sourceDir },
) {
  const normalized = validateFlowsSnapshotManifest(snapshot);
  if (typeof bucket !== "string" || bucket.trim() === "") {
    throw new Error(
      "Flows snapshot verification requires its resources bucket",
    );
  }
  for (const object of normalized.objects) {
    for (const page of object.pages) {
      if (!Object.hasOwn(sidecar, page.key)) {
        throw new Error(
          `Flows snapshot page ${page.key} is missing from ${bucket}`,
        );
      }
      const path = join(sourceDir, ...page.key.split("/"));
      const info = await lstat(path);
      if (!info.isFile())
        throw new Error(
          `Flows snapshot page is not a regular file: ${page.key}`,
        );
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      if (hash.digest("hex") !== page.sha256) {
        throw new Error(
          `Flows snapshot page SHA-256 does not match: ${page.key}`,
        );
      }
    }
  }
  return normalized;
}
