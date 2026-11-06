import { randomUUID } from "node:crypto";
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  type GetObjectCommandOutput,
  type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";

export type ObjectStoreConfig = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
};
const customMetadataKey = "savia-r2-custom";
const versionKey = "savia-r2-version";
const httpFields = {
  contentType: "content-type",
  contentLanguage: "content-language",
  contentDisposition: "content-disposition",
  contentEncoding: "content-encoding",
  cacheControl: "cache-control",
} as const;
function httpMetadata(value?: R2HTTPMetadata | Headers): R2HTTPMetadata {
  if (!(value instanceof Headers)) return value ?? {};
  return {
    ...Object.fromEntries(
      Object.entries(httpFields).flatMap(([field, header]) =>
        value.has(header) ? [[field, value.get(header)!]] : [],
      ),
    ),
    ...(value.has("expires")
      ? { cacheExpiry: new Date(value.get("expires")!) }
      : {}),
  };
}
function conditions(value?: R2Conditional | Headers): R2Conditional {
  if (!(value instanceof Headers)) return value ?? {};
  return {
    ...(value.has("if-match") ? { etagMatches: value.get("if-match")! } : {}),
    ...(value.has("if-none-match")
      ? { etagDoesNotMatch: value.get("if-none-match")! }
      : {}),
    ...(value.has("if-unmodified-since")
      ? { uploadedBefore: new Date(value.get("if-unmodified-since")!) }
      : {}),
    ...(value.has("if-modified-since")
      ? { uploadedAfter: new Date(value.get("if-modified-since")!) }
      : {}),
    secondsGranularity: true,
  };
}
function quotedEtag(value: string | undefined): string | undefined {
  if (value === undefined || value === "*" || value.startsWith('"'))
    return value;
  if (value.includes(",") || value.startsWith("W/"))
    throw new Error(
      "Only a single strong ETag is supported by the S3 adapter.",
    );
  return JSON.stringify(value);
}
function rangeHeader(value?: R2Range | Headers): string | undefined {
  if (!value) return undefined;
  if (value instanceof Headers) {
    const range = value.get("range") ?? undefined;
    if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range))
      throw new RangeError("Only one valid byte range is supported.");
    return range;
  }
  if ("suffix" in value) {
    if (!Number.isSafeInteger(value.suffix) || value.suffix <= 0)
      throw new RangeError("Invalid range suffix.");
    return `bytes=-${value.suffix}`;
  }
  const offset = value.offset ?? 0;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    (value.length !== undefined &&
      (!Number.isSafeInteger(value.length) || value.length <= 0))
  )
    throw new RangeError("Invalid byte range.");
  return `bytes=${offset}-${value.length === undefined ? "" : offset + value.length - 1}`;
}
function status(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
}
function objectMetadata(
  key: string,
  output: HeadObjectCommandOutput | GetObjectCommandOutput,
): R2Object {
  const etag = (output.ETag ?? "").replace(/^"|"$/g, "");
  const range =
    "ContentRange" in output && output.ContentRange
      ? /^bytes (\d+)-(\d+)\/(\d+)$/.exec(output.ContentRange)
      : null;
  const metadata = output.Metadata ?? {};
  let customMetadata: Record<string, string> = {};
  if (metadata[customMetadataKey]) {
    customMetadata = JSON.parse(
      Buffer.from(metadata[customMetadataKey], "base64").toString("utf8"),
    );
  } else {
    customMetadata = Object.fromEntries(
      Object.entries(metadata).filter(([name]) => name !== versionKey),
    );
  }
  const http: R2HTTPMetadata = {
    ...(output.ContentType !== undefined
      ? { contentType: output.ContentType }
      : {}),
    ...(output.ContentLanguage !== undefined
      ? { contentLanguage: output.ContentLanguage }
      : {}),
    ...(output.ContentDisposition !== undefined
      ? { contentDisposition: output.ContentDisposition }
      : {}),
    ...(output.ContentEncoding !== undefined
      ? { contentEncoding: output.ContentEncoding }
      : {}),
    ...(output.CacheControl !== undefined
      ? { cacheControl: output.CacheControl }
      : {}),
    ...(output.Expires ? { cacheExpiry: output.Expires } : {}),
  };
  const md5 = /^[a-f\d]{32}$/i.test(etag)
    ? Uint8Array.from(Buffer.from(etag, "hex")).buffer
    : undefined;
  return {
    key,
    version: output.VersionId ?? metadata[versionKey] ?? etag,
    size: range ? Number(range[3]) : (output.ContentLength ?? 0),
    etag,
    httpEtag: JSON.stringify(etag),
    uploaded: output.LastModified ?? new Date(0),
    httpMetadata: http,
    customMetadata,
    ...(range
      ? {
          range: {
            offset: Number(range[1]),
            length: Number(range[2]) - Number(range[1]) + 1,
          },
        }
      : {}),
    storageClass:
      output.StorageClass === "STANDARD_IA" ? "InfrequentAccess" : "Standard",
    checksums: {
      ...(md5 ? { md5 } : {}),
      toJSON: () => (md5 ? { md5: etag } : {}),
    },
    writeHttpMetadata(headers: Headers) {
      for (const [field, header] of Object.entries(httpFields)) {
        const value = http[field as keyof typeof httpFields];
        if (value !== undefined) headers.set(header, value);
      }
      if (http.cacheExpiry)
        headers.set("expires", http.cacheExpiry.toUTCString());
    },
  };
}

/** R2 operations consumed by Savia. S3 conditions are sent to the server, never checked with a racy HEAD/PUT pair. */
export class S3ObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  constructor(config: ObjectStoreConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle ?? true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  async head(key: string): Promise<R2Object | null> {
    try {
      return objectMetadata(
        key,
        await this.client.send(
          new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
        ),
      );
    } catch (error) {
      if (status(error) === 404) return null;
      throw error;
    }
  }
  get(key: string): Promise<R2ObjectBody | null>;
  get(
    key: string,
    options: R2GetOptions & { onlyIf: R2Conditional | Headers },
  ): Promise<R2ObjectBody | R2Object | null>;
  get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null>;
  async get(
    key: string,
    options: R2GetOptions = {},
  ): Promise<R2ObjectBody | R2Object | null> {
    if (options.ssecKey)
      throw new Error(
        "SSE-C is not supported by the self-hosted object adapter.",
      );
    const condition = conditions(options.onlyIf);
    try {
      const output = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: rangeHeader(options.range),
          IfMatch: quotedEtag(condition.etagMatches),
          IfNoneMatch: quotedEtag(condition.etagDoesNotMatch),
          IfUnmodifiedSince: condition.uploadedBefore,
          IfModifiedSince: condition.uploadedAfter,
        }),
      );
      if (!output.Body)
        throw new Error("S3 returned an object without a body.");
      const response = new Response(
        output.Body.transformToWebStream() as ReadableStream,
        {
          headers: output.ContentType
            ? { "content-type": output.ContentType }
            : undefined,
        },
      );
      const metadata = objectMetadata(key, output);
      return Object.defineProperties(
        Object.assign(metadata, {
          body: response.body!,
          arrayBuffer: () => response.arrayBuffer(),
          bytes: async () => new Uint8Array(await response.arrayBuffer()),
          text: () => response.text(),
          json: <T>() => response.json() as Promise<T>,
          blob: () => response.blob(),
        }),
        {
          bodyUsed: { enumerable: true, get: () => response.bodyUsed },
        },
      ) as R2ObjectBody;
    } catch (error) {
      if (status(error) === 404) return null;
      if (status(error) === 304 || status(error) === 412) return this.head(key);
      throw error;
    }
  }
  async put(
    key: string,
    value:
      ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
    options: R2PutOptions = {},
  ): Promise<R2Object | null> {
    const condition = conditions(options.onlyIf);
    if (condition.uploadedBefore || condition.uploadedAfter)
      throw new Error(
        "Date-conditional writes are not supported by S3; use an ETag condition.",
      );
    if (
      options.ssecKey ||
      options.sha1 ||
      options.sha256 ||
      options.sha384 ||
      options.sha512 ||
      options.md5
    )
      throw new Error(
        "Explicit checksums and SSE-C are not supported by the self-hosted object adapter.",
      );
    const http = httpMetadata(options.httpMetadata);
    const version = randomUUID();
    // Existing Savia callers upload bounded ArrayBuffers. Streams are materialized to give S3 a required content length.
    const body =
      value === null
        ? new Uint8Array()
        : typeof value === "string"
          ? Buffer.from(value)
          : value instanceof ArrayBuffer
            ? new Uint8Array(value)
            : ArrayBuffer.isView(value)
              ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
              : new Uint8Array(await new Response(value).arrayBuffer());
    const metadata = {
      [versionKey]: version,
      [customMetadataKey]: Buffer.from(
        JSON.stringify(options.customMetadata ?? {}),
      ).toString("base64"),
    };
    try {
      const result = await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentLength: body.byteLength,
          ContentType: http.contentType,
          ContentLanguage: http.contentLanguage,
          ContentDisposition: http.contentDisposition,
          ContentEncoding: http.contentEncoding,
          CacheControl: http.cacheControl,
          Expires: http.cacheExpiry,
          Metadata: metadata,
          IfMatch: quotedEtag(condition.etagMatches),
          IfNoneMatch: quotedEtag(condition.etagDoesNotMatch),
          ...(options.storageClass === "InfrequentAccess"
            ? { StorageClass: "STANDARD_IA" as const }
            : {}),
        }),
      );
      return objectMetadata(key, {
        ...result,
        Metadata: metadata,
        ContentLength: body.byteLength,
        ContentType: http.contentType,
        ContentLanguage: http.contentLanguage,
        ContentDisposition: http.contentDisposition,
        ContentEncoding: http.contentEncoding,
        CacheControl: http.cacheControl,
        Expires: http.cacheExpiry,
        LastModified: new Date(),
      });
    } catch (error) {
      if (status(error) === 412) return null;
      throw error;
    }
  }
  async delete(key: string | string[]): Promise<void> {
    if (typeof key === "string") {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return;
    }
    for (let index = 0; index < key.length; index += 1000) {
      const result = await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: {
            Objects: key.slice(index, index + 1000).map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
      if (result.Errors?.length)
        throw new Error(
          `S3 deletion failed: ${result.Errors.map((error) => `${error.Key}: ${error.Code}`).join(", ")}`,
        );
    }
  }
  async list(options: R2ListOptions = {}): Promise<R2Objects> {
    if (
      options.limit !== undefined &&
      (!Number.isInteger(options.limit) ||
        options.limit < 1 ||
        options.limit > 1000)
    )
      throw new RangeError("Object list limit must be between 1 and 1000.");
    const page = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: options.prefix,
        Delimiter: options.delimiter,
        MaxKeys: options.limit,
        ContinuationToken: options.cursor,
        StartAfter: options.startAfter,
      }),
    );
    const objects = await Promise.all(
      (page.Contents ?? []).map(async (item) => {
        if (options.include?.length) return this.head(item.Key!);
        return objectMetadata(item.Key!, {
          $metadata: {},
          ContentLength: item.Size,
          ETag: item.ETag,
          LastModified: item.LastModified,
        });
      }),
    );
    const base = {
      objects: objects.filter((item): item is R2Object => item !== null),
      delimitedPrefixes: (page.CommonPrefixes ?? []).flatMap((item) =>
        item.Prefix ? [item.Prefix] : [],
      ),
    };
    if (page.IsTruncated) {
      if (!page.NextContinuationToken)
        throw new Error("S3 returned a truncated list without a cursor.");
      return { ...base, truncated: true, cursor: page.NextContinuationToken };
    }
    return { ...base, truncated: false };
  }
  close(): void {
    this.client.destroy();
  }
}

export function createObjectStore(config: ObjectStoreConfig): S3ObjectStore {
  return new S3ObjectStore(config);
}
