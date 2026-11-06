import type { SnapshotManifest, StreamManifest } from "./types";

const encoder = new TextEncoder();

export type ArchiveObject = {
  key: string;
  size: number;
};

export type ArchiveBucket = {
  head(key: string): Promise<ArchiveObject | null>;
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | string,
  ): Promise<ArchiveObject>;
  list(options?: { cursor?: string }): Promise<{
    objects: ArchiveObject[];
    truncated?: boolean;
    cursor?: string;
  }>;
  get(key: string): Promise<{
    arrayBuffer(): Promise<ArrayBufferLike>;
  } | null>;
  delete(key: string): Promise<void>;
};

export type LegacyStore = {
  name: string;
  listTables(): Promise<string[]>;
  selectPage(
    table: string,
    paging: { limit: number; start: number },
  ): Promise<unknown[]>;
  close(): Promise<void>;
};

export type ObjectSource = {
  name: string;
  bucket: ArchiveBucket;
};

export type KvSource = {
  name: string;
  namespace: {
    list(options?: { cursor?: string }): Promise<{
      keys: { name: string }[];
      list_complete?: boolean;
      cursor?: string;
    }>;
    getWithMetadata(
      key: string,
      type: "arrayBuffer",
    ): Promise<{ value: ArrayBufferLike; metadata: unknown } | null>;
    delete(key: string): Promise<void>;
  };
};

export type ArchiveInput = {
  snapshotId: string;
  createdAt?: string;
  stores: LegacyStore[];
  archive: ArchiveBucket;
  objectSources: ObjectSource[];
  kvSources: KvSource[];
  pageSize?: number;
};

export type CleanupInput = {
  verified: boolean;
  r2Sources: ObjectSource[];
  kvSources: KvSource[];
};

export type CleanupReport = {
  r2ObjectsDeleted: number;
  kvKeysDeleted: number;
};

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("record contains non-finite number");
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((entry) => canonicalValue(entry));
  if (value instanceof Date) return value.toJSON();
  if (value instanceof ArrayBuffer) return Array.from(new Uint8Array(value));
  if (ArrayBuffer.isView(value))
    return Array.from(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    );
  if (value && typeof value === "object") {
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.toJSON === "function")
      return canonicalValue(candidate.toJSON());
    return Object.fromEntries(
      Object.entries(candidate)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalValue(entry)]),
    );
  }
  throw new TypeError("record contains an unsupported value");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

async function sha256(parts: Uint8Array[]): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    concat(parts) as unknown as BufferSource,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function snapshotPrefix(snapshotId: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(snapshotId))
    throw new TypeError("snapshotId must be a safe immutable identifier");
  return `legacy-import/${snapshotId}`;
}

function sourcePart(value: string): string {
  return encodeURIComponent(value);
}

async function archiveSurrealStore(
  store: LegacyStore,
  archive: ArchiveBucket,
  prefix: string,
  pageSize: number,
): Promise<StreamManifest[]> {
  const streams: StreamManifest[] = [];
  for (const table of [...(await store.listTables())].sort()) {
    const parts: Uint8Array[] = [];
    let records = 0;
    let start = 0;
    for (;;) {
      const page = await store.selectPage(table, { limit: pageSize, start });
      const ordered = [...page].sort((left, right) =>
        canonicalJson(left).localeCompare(canonicalJson(right)),
      );
      for (const record of ordered)
        parts.push(encoder.encode(`${canonicalJson(record)}\n`));
      records += ordered.length;
      if (page.length < pageSize) break;
      start += page.length;
    }
    const destinationPrefix = `${prefix}/surreal/${sourcePart(store.name)}/${sourcePart(table)}.ndjson`;
    const body = concat(parts);
    await archive.put(destinationPrefix, body);
    streams.push({
      sourceType: "surreal",
      sourceName: `${store.name}:${table}`,
      destinationPrefix,
      records,
      bytes: body.byteLength,
      sha256: await sha256([body]),
    });
  }
  return streams;
}

async function archiveObjectSource(
  source: ObjectSource,
  archive: ArchiveBucket,
  prefix: string,
): Promise<StreamManifest> {
  const destinationPrefix = `${prefix}/r2/${sourcePart(source.name)}`;
  const digestParts: Uint8Array[] = [];
  let records = 0;
  let bytes = 0;
  let cursor: string | undefined;
  do {
    const page = await source.bucket.list({ cursor });
    for (const object of [...page.objects].sort((left, right) =>
      left.key.localeCompare(right.key),
    )) {
      const body = await source.bucket.get(object.key);
      if (!body)
        throw new Error(`legacy R2 object disappeared: ${source.name}`);
      const value = new Uint8Array(await body.arrayBuffer());
      await archive.put(
        `${destinationPrefix}/${sourcePart(object.key)}`,
        value,
      );
      digestParts.push(
        encoder.encode(`${canonicalJson({ key: object.key })}\n`),
        value,
      );
      records += 1;
      bytes += value.byteLength;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return {
    sourceType: "r2",
    sourceName: source.name,
    destinationPrefix,
    records,
    bytes,
    sha256: await sha256(digestParts),
  };
}

async function archiveKvSource(
  source: KvSource,
  archive: ArchiveBucket,
  prefix: string,
): Promise<StreamManifest> {
  const destinationPrefix = `${prefix}/kv/${sourcePart(source.name)}`;
  const digestParts: Uint8Array[] = [];
  let records = 0;
  let bytes = 0;
  let cursor: string | undefined;
  do {
    const page = await source.namespace.list({ cursor });
    for (const key of [...page.keys].sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const entry = await source.namespace.getWithMetadata(
        key.name,
        "arrayBuffer",
      );
      if (!entry) throw new Error(`legacy KV key disappeared: ${source.name}`);
      const value = new Uint8Array(entry.value);
      await archive.put(`${destinationPrefix}/${sourcePart(key.name)}`, value);
      digestParts.push(
        encoder.encode(
          `${canonicalJson({ key: key.name, metadata: entry.metadata })}\n`,
        ),
        value,
      );
      records += 1;
      bytes += value.byteLength;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return {
    sourceType: "kv",
    sourceName: source.name,
    destinationPrefix,
    records,
    bytes,
    sha256: await sha256(digestParts),
  };
}

export async function archiveSnapshot(
  input: ArchiveInput,
): Promise<SnapshotManifest> {
  const prefix = snapshotPrefix(input.snapshotId);
  if (await input.archive.head(`${prefix}/manifest.json`))
    throw new Error("snapshot already exists");
  const pageSize = input.pageSize ?? 500;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1)
    throw new TypeError("pageSize must be a positive integer");

  try {
    const streams = (
      await Promise.all(
        input.stores.map((store) =>
          archiveSurrealStore(store, input.archive, prefix, pageSize),
        ),
      )
    ).flat();
    for (const source of input.objectSources)
      streams.push(await archiveObjectSource(source, input.archive, prefix));
    for (const source of input.kvSources)
      streams.push(await archiveKvSource(source, input.archive, prefix));
    streams.sort(
      (left, right) =>
        left.sourceType.localeCompare(right.sourceType) ||
        left.sourceName.localeCompare(right.sourceName),
    );
    const manifest = {
      snapshotId: input.snapshotId,
      createdAt: input.createdAt ?? new Date().toISOString(),
      streams,
    } satisfies SnapshotManifest;
    await input.archive.put(`${prefix}/manifest.json`, canonicalJson(manifest));
    return manifest;
  } finally {
    await Promise.all(input.stores.map((store) => store.close()));
  }
}

async function deleteR2Source(source: ObjectSource): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const page = await source.bucket.list({ cursor });
    for (const object of page.objects) {
      await source.bucket.delete(object.key);
      deleted += 1;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}

async function deleteKvSource(source: KvSource): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const page = await source.namespace.list({ cursor });
    for (const key of page.keys) {
      await source.namespace.delete(key.name);
      deleted += 1;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return deleted;
}

export async function cleanupLegacyObjects(
  input: CleanupInput,
): Promise<CleanupReport> {
  if (!input.verified)
    throw new Error("verified manifest is required before cleanup");
  const r2Counts = await Promise.all(input.r2Sources.map(deleteR2Source));
  const kvCounts = await Promise.all(input.kvSources.map(deleteKvSource));
  return {
    r2ObjectsDeleted: r2Counts.reduce((sum, count) => sum + count, 0),
    kvKeysDeleted: kvCounts.reduce((sum, count) => sum + count, 0),
  };
}
