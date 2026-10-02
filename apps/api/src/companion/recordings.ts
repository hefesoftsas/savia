import { z } from "@hono/zod-openapi";
import {
  CompanionError,
  decodeAudio,
  sourceSchema,
  summarySchema,
  transcriptSchema,
} from "./service";
import { inspectOggOpus, MAX_OPUS_BYTES } from "./ogg";
export const recordingIdSchema = z.string().uuid();
export const saveRecordingSchema = z
  .object({
    id: recordingIdSchema,
    source: sourceSchema,
    audio: z
      .object({
        data: z
          .string()
          .min(1)
          .max(4 * Math.ceil(MAX_OPUS_BYTES / 3)),
        format: z.literal("ogg"),
      })
      .strict(),
    consent: z.literal(true),
  })
  .strict();
export const recordingSchema = z.object({
  id: recordingIdSchema,
  source: sourceSchema,
  format: z.literal("ogg"),
  bytes: z.number().int().positive().max(MAX_OPUS_BYTES),
  durationSeconds: z.number().positive().max(60),
  createdAt: z.string().datetime(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const recordingListSchema = z.object({
  recordings: z.array(recordingSchema),
  cursor: z.string().nullable(),
});
export const recordingNotesSchema = z
  .object({
    transcript: transcriptSchema.nullable(),
    summary: summarySchema.nullable(),
  })
  .strict();
export type Recording = z.infer<typeof recordingSchema>;
export type RecordingNotes = z.infer<typeof recordingNotesSchema>;
export type RecordingAudio = {
  source: Recording["source"];
  durationSeconds: number;
  bytes: Uint8Array;
};
const MAX_NOTES_BYTES = 128 * 1024;
const processingByBucket = new WeakMap<R2Bucket, Map<string, Promise<void>>>();
const digest = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
const missing = () =>
  new CompanionError("RECORDING_NOT_FOUND", "Recording not found.", 404);
export class CompanionRecordings {
  private readonly processing: Map<string, Promise<void>>;
  constructor(private bucket?: R2Bucket) {
    if (bucket) {
      let locks = processingByBucket.get(bucket);
      if (!locks) {
        locks = new Map();
        processingByBucket.set(bucket, locks);
      }
      this.processing = locks;
    } else {
      this.processing = new Map();
    }
  }
  private storage(): R2Bucket {
    if (!this.bucket)
      throw new CompanionError(
        "STORAGE_UNAVAILABLE",
        "Companion storage is unavailable.",
        503,
      );
    return this.bucket;
  }
  private async prefix(owner: string) {
    return `companion/samples/${await digest(new TextEncoder().encode(owner))}/`;
  }
  private async key(owner: string, id: string) {
    if (!recordingIdSchema.safeParse(id).success)
      throw new CompanionError(
        "INVALID_REQUEST",
        "Invalid recording identifier.",
      );
    return `${await this.prefix(owner)}${id}.ogg`;
  }
  private async notesKey(owner: string, id: string) {
    await this.key(owner, id);
    return `${await this.prefix(owner)}${id}.notes.json`;
  }
  /**
   * Serialize processing for this owner and recording across repository
   * instances sharing a bucket in this isolate. Separate isolates may still
   * process concurrently; this is
   * not an exactly-once guarantee across Workers.
   */
  async withNotesLock<T>(
    owner: string,
    id: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const key = await this.key(owner, id);
    const previous = this.processing.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.processing.set(key, current);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.processing.get(key) === current) this.processing.delete(key);
    }
  }
  private metadata(object: R2Object): Recording {
    const metadata = object.customMetadata ?? {};
    const parsed = recordingSchema.safeParse({
      id: metadata.id,
      source: metadata.source,
      format: "ogg",
      bytes: object.size,
      durationSeconds: Number(metadata.durationSeconds),
      createdAt: metadata.createdAt,
      sha256: metadata.sha256,
    });
    if (!parsed.success)
      throw new CompanionError(
        "STORAGE_INVALID_RECORD",
        "Stored recording metadata is invalid.",
        503,
      );
    return parsed.data;
  }
  async save(
    owner: string,
    input: z.input<typeof saveRecordingSchema>,
  ): Promise<Recording> {
    const bucket = this.storage(),
      parsed = saveRecordingSchema.safeParse(input);
    if (!parsed.success)
      throw new CompanionError(
        "INVALID_REQUEST",
        "Invalid consented recording request.",
      );
    const audio = decodeAudio(parsed.data.audio.data, "ogg");
    let durationSeconds: number;
    try {
      durationSeconds = inspectOggOpus(audio).durationSeconds;
    } catch {
      throw new CompanionError(
        "INVALID_AUDIO",
        "Expected a valid short mono Ogg Opus sample.",
      );
    }
    const key = await this.key(owner, parsed.data.id),
      sha256 = await digest(audio);
    let object: R2Object | null;
    try {
      object = await bucket.put(key, audio, {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: {
          contentType: "audio/ogg",
          cacheControl: "private, no-store",
        },
        customMetadata: {
          id: parsed.data.id,
          source: parsed.data.source,
          durationSeconds: String(durationSeconds),
          createdAt: new Date().toISOString(),
          sha256,
        },
      });
      if (!object) object = await bucket.head(key);
    } catch {
      throw new CompanionError(
        "STORAGE_UNAVAILABLE",
        "Could not save the recording; retry with the same identifier.",
        503,
      );
    }
    if (!object)
      throw new CompanionError(
        "STORAGE_UNAVAILABLE",
        "Could not confirm the saved recording.",
        503,
      );
    const result = this.metadata(object);
    if (result.sha256 !== sha256 || result.source !== parsed.data.source)
      throw new CompanionError(
        "RECORDING_CONFLICT",
        "This identifier belongs to a different sample.",
        409,
      );
    return result;
  }
  async list(owner: string, cursor?: string) {
    const result = await this.storage().list({
      prefix: await this.prefix(owner),
      limit: 50,
      include: ["customMetadata"],
      ...(cursor ? { cursor } : {}),
    });
    return {
      recordings: result.objects
        .filter((object) => object.key.endsWith(".ogg"))
        .map((object) => this.metadata(object)),
      cursor: result.truncated ? result.cursor : null,
    };
  }
  async get(owner: string, id: string): Promise<R2ObjectBody> {
    const object = await this.storage().get(await this.key(owner, id));
    if (!object) throw missing();
    this.metadata(object);
    return object;
  }
  async getAudio(owner: string, id: string): Promise<RecordingAudio> {
    const object = await this.get(owner, id);
    const metadata = this.metadata(object);
    return {
      source: metadata.source,
      durationSeconds: metadata.durationSeconds,
      bytes: new Uint8Array(await object.arrayBuffer()),
    };
  }
  async getNotes(owner: string, id: string): Promise<RecordingNotes> {
    await this.get(owner, id);
    const object = await this.storage().get(await this.notesKey(owner, id));
    if (!object) return { transcript: null, summary: null };
    if (object.size > MAX_NOTES_BYTES)
      throw new CompanionError(
        "STORAGE_INVALID_RECORD",
        "Stored recording notes are invalid.",
        503,
      );
    let candidate: unknown;
    try {
      candidate = JSON.parse(await object.text());
    } catch {
      throw new CompanionError(
        "STORAGE_INVALID_RECORD",
        "Stored recording notes are invalid.",
        503,
      );
    }
    const parsed = recordingNotesSchema.safeParse(candidate);
    if (!parsed.success)
      throw new CompanionError(
        "STORAGE_INVALID_RECORD",
        "Stored recording notes are invalid.",
        503,
      );
    return parsed.data;
  }
  async storeNotes(
    owner: string,
    id: string,
    input: RecordingNotes,
  ): Promise<void> {
    await this.get(owner, id);
    const parsed = recordingNotesSchema.safeParse(input);
    if (!parsed.success)
      throw new CompanionError(
        "PROVIDER_INVALID_RESPONSE",
        "Provider returned invalid recording notes.",
        502,
      );
    const bucket = this.storage();
    const key = await this.notesKey(owner, id);
    const serialized = JSON.stringify(parsed.data);
    if (new TextEncoder().encode(serialized).byteLength > MAX_NOTES_BYTES)
      throw new CompanionError(
        "PROVIDER_INVALID_RESPONSE",
        "Provider returned recording notes that exceed the storage limit.",
        502,
      );
    try {
      await bucket.put(key, serialized, {
        httpMetadata: {
          contentType: "application/json; charset=utf-8",
          cacheControl: "private, no-store",
        },
      });
    } catch {
      throw new CompanionError(
        "STORAGE_UNAVAILABLE",
        "Could not save recording notes.",
        503,
      );
    }
    // A delete from another isolate can race the initial existence check. If
    // the audio vanished before this write completed, remove any late sidecar.
    if (!(await bucket.head(await this.key(owner, id)))) {
      await bucket.delete(key);
      throw missing();
    }
  }
  async remove(owner: string, id: string) {
    await this.withNotesLock(owner, id, async () => {
      const bucket = this.storage();
      const key = await this.key(owner, id);
      if (!(await bucket.head(key))) throw missing();
      await bucket.delete([key, await this.notesKey(owner, id)]);
    });
  }
}
