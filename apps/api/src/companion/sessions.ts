import { inspectImportedAudio } from "./imported-audio";
import { z } from "@hono/zod-openapi";
import { CompanionError, summarySchema, transcriptSchema } from "./service";
import { decodeAudio } from "./service";
import { inspectOggOpus, MAX_OPUS_BYTES } from "./ogg";
import type { RecordingAccess } from "./recordings";

export const sessionIdSchema = z.string().uuid();
export const sessionSourceSchema = z.enum(["microphone", "system"]);
export const createSessionSchema = z
  .object({
    id: sessionIdSchema,
    name: z.string().trim().min(1).max(255),
    sources: z.array(sessionSourceSchema).min(1).max(2),
    consent: z.literal(true),
  })
  .strict();
export const chunkInputSchema = z
  .object({
    source: sessionSourceSchema,
    sequence: z.number().int().min(0).max(119),
    startSeconds: z.number().finite().min(0).max(3600),
    audio: z
      .object({
        data: z
          .string()
          .min(1)
          .max(4 * Math.ceil(MAX_OPUS_BYTES / 3)),
        format: z.enum(["ogg", "m4a"]),
      })
      .strict(),
  })
  .strict();
export const finalizeSessionSchema = z
  .object({
    expectedChunks: z.number().int().min(1).max(240),
    durationSeconds: z.number().finite().positive().max(3600),
  })
  .strict();
const languageSchema = z.string().regex(/^([a-z]{2}|auto)$/);
export const processingRequestSchema = z
  .object({
    consent: z.literal(true),
    retryAmbiguous: z.boolean().optional(),
    language: languageSchema.optional(),
    retranscribe: z.boolean().optional(),
  })
  .strict();

const chunkSchema = z.object({
  format: z.enum(["ogg", "m4a"]).default("ogg"),
  source: sessionSourceSchema,
  sequence: z.number().int().min(0).max(119),
  startSeconds: z.number().finite().min(0).max(3600),
  durationSeconds: z.number().finite().positive().max(60.1),
  bytes: z.number().int().positive().max(MAX_OPUS_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const jobStatusSchema = z.enum([
  "idle",
  "queued",
  "transcribing",
  "summarizing",
  "complete",
  "needs_attention",
  "cancelled",
  "failed",
]);
const jobSchema = z.object({
  runId: z.string().uuid().nullable().default(null),
  status: jobStatusSchema,
  // "auto" lets the provider detect the spoken language; a two-letter code
  // forces it. An explicit user choice always wins over detection.
  language: languageSchema.default("es"),
  completedChunks: z.number().int().min(0).max(240),
  totalChunks: z.number().int().min(0).max(240),
  error: z.string().max(80).optional(),
  transcripts: z.record(z.string(), transcriptSchema).default({}),
  summary: summarySchema.nullable().default(null),
  lease: z
    .object({
      token: z.string().uuid(),
      expiresAt: z.string().datetime(),
      phase: z.enum(["transcribe", "summarize"]),
      chunkKey: z.string().optional(),
      providerStarted: z.boolean(),
    })
    .nullable()
    .default(null),
  summaryWork: z
    .array(
      z.object({ source: sessionSourceSchema, text: z.string().max(60000) }),
    )
    .default([]),
});
const manifestSchema = z.object({
  id: sessionIdSchema,
  ownerId: z.string().min(1),
  tenantId: z.number().int().nonnegative().optional(),
  name: z.string().min(1).max(255),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  sources: z.array(sessionSourceSchema).min(1).max(2),
  state: z.enum(["uploading", "ready"]),
  durationSeconds: z.number().finite().positive().max(3600).nullable(),
  chunks: z.array(chunkSchema).max(240),
  job: jobSchema,
});
type Manifest = z.infer<typeof manifestSchema>;
type Chunk = z.infer<typeof chunkSchema>;
const failMissing = () =>
  new CompanionError("SESSION_NOT_FOUND", "Session not found.", 404);
const storageUnavailable = () =>
  new CompanionError(
    "STORAGE_UNAVAILABLE",
    "Companion storage is unavailable.",
    503,
  );
const keyPart = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
};
const sha256 = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
const ownerPrefix = async (access: RecordingAccess) => {
  if (
    !access.ownerId ||
    (access.requireTenant &&
      (!Number.isSafeInteger(access.tenantId) || access.tenantId! < 0))
  )
    throw failMissing();
  return `companion/sessions/${await keyPart(`${access.ownerId}\0${access.tenantId ?? ""}`)}/`;
};
const chunkKeyPart = (source: string, sequence: number, format = "ogg") =>
  `${source}/${String(sequence).padStart(3, "0")}.${format}`;
const chunkIdentity = (source: string, sequence: number) =>
  `${source}:${sequence}`;
const publicJobSchema = jobSchema.omit({ lease: true, summaryWork: true });
export const sessionSchema = manifestSchema
  .omit({ ownerId: true })
  .extend({ job: publicJobSchema });
export type Session = z.infer<typeof sessionSchema>;
const publicSession = (manifest: Manifest): Session => {
  const { ownerId: _ownerId, ...session } = manifest;
  const { lease: _lease, summaryWork: _summaryWork, ...job } = session.job;
  return sessionSchema.parse({ ...session, job });
};

export class CompanionSessions {
  constructor(private readonly bucket?: R2Bucket) {}
  private storage(): R2Bucket {
    if (!this.bucket) throw storageUnavailable();
    return this.bucket;
  }
  private async prefix(access: RecordingAccess) {
    return ownerPrefix(access);
  }
  private async manifestKey(access: RecordingAccess, id: string) {
    if (!sessionIdSchema.safeParse(id).success)
      throw new CompanionError(
        "INVALID_REQUEST",
        "Invalid session identifier.",
      );
    return `${await this.prefix(access)}${id}/manifest.json`;
  }
  private checkAccess(access: RecordingAccess, manifest: Manifest) {
    if (
      manifest.ownerId !== access.ownerId ||
      manifest.tenantId !== access.tenantId ||
      (access.requireTenant && manifest.tenantId !== access.tenantId)
    )
      throw failMissing();
  }
  private async readManifest(access: RecordingAccess, id: string) {
    const key = await this.manifestKey(access, id);
    let object: R2ObjectBody | null;
    try {
      object = await this.storage().get(key);
    } catch {
      throw storageUnavailable();
    }
    if (!object) throw failMissing();
    const custom = object.customMetadata ?? {};
    const expectedOwnerHash = (await this.prefix(access)).split("/")[2];
    if (
      custom.id !== id ||
      custom.ownerIdHash !== expectedOwnerHash ||
      custom.tenantId !==
        (access.tenantId === undefined ? undefined : String(access.tenantId))
    ) {
      await object.body.cancel();
      throw new CompanionError(
        "STORAGE_INVALID_RECORD",
        "Stored session ownership metadata is invalid.",
        503,
      );
    }
    let candidate: unknown;
    try {
      candidate = JSON.parse(await object.text());
    } catch {
      throw new CompanionError(
        "STORAGE_INVALID_RECORD",
        "Stored session is invalid.",
        503,
      );
    }
    const parsed = manifestSchema.safeParse(candidate);
    if (!parsed.success)
      throw new CompanionError(
        "STORAGE_INVALID_RECORD",
        "Stored session is invalid.",
        503,
      );
    this.checkAccess(access, parsed.data);
    return { manifest: parsed.data, etag: object.etag, key };
  }
  /** CAS mutation hook used by the durable processing engine. */
  async mutate(
    access: RecordingAccess,
    id: string,
    update: (manifest: Manifest) => Manifest | Promise<Manifest>,
  ) {
    const bucket = this.storage();
    for (let attempt = 0; attempt < 12; attempt++) {
      const current = await this.readManifest(access, id);
      const next = manifestSchema.parse(
        await update(structuredClone(current.manifest)),
      );
      this.checkAccess(access, next);
      next.updatedAt = new Date().toISOString();
      try {
        const saved = await bucket.put(current.key, JSON.stringify(next), {
          onlyIf: { etagMatches: current.etag },
          httpMetadata: {
            contentType: "application/json; charset=utf-8",
            cacheControl: "private, no-store",
          },
          customMetadata: {
            id,
            ownerIdHash: (await this.prefix(access)).split("/")[2],
            ...(access.tenantId !== undefined
              ? { tenantId: String(access.tenantId) }
              : {}),
          },
        });
        if (saved) return next;
      } catch (error) {
        if (error instanceof CompanionError) throw error;
        throw storageUnavailable();
      }
    }
    throw new CompanionError(
      "SESSION_BUSY",
      "Session changed concurrently; retry the request.",
      409,
    );
  }
  async create(
    access: RecordingAccess,
    input: z.input<typeof createSessionSchema>,
  ): Promise<Session> {
    const parsed = createSessionSchema.safeParse(input);
    if (
      !parsed.success ||
      new Set(parsed.data?.sources ?? []).size !== parsed.data?.sources.length
    )
      throw new CompanionError(
        "INVALID_REQUEST",
        "Invalid consented session request.",
      );
    const bucket = this.storage();
    const now = new Date().toISOString();
    const manifest: Manifest = {
      ...parsed.data,
      ownerId: access.ownerId,
      ...(access.tenantId !== undefined ? { tenantId: access.tenantId } : {}),
      createdAt: now,
      updatedAt: now,
      state: "uploading",
      durationSeconds: null,
      chunks: [],
      job: {
        runId: null,
        status: "idle",
        language: "auto",
        completedChunks: 0,
        totalChunks: 0,
        transcripts: {},
        summary: null,
        lease: null,
        summaryWork: [],
      },
    };
    const key = await this.manifestKey(access, parsed.data.id);
    try {
      const object = await bucket.put(key, JSON.stringify(manifest), {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: {
          contentType: "application/json; charset=utf-8",
          cacheControl: "private, no-store",
        },
        customMetadata: {
          id: manifest.id,
          ownerIdHash: (await this.prefix(access)).split("/")[2],
          ...(access.tenantId !== undefined
            ? { tenantId: String(access.tenantId) }
            : {}),
        },
      });
      if (object) return publicSession(manifest);
      const existing = await this.readManifest(access, parsed.data.id);
      if (
        existing.manifest.ownerId === access.ownerId &&
        existing.manifest.tenantId === access.tenantId &&
        existing.manifest.name === parsed.data.name &&
        JSON.stringify(existing.manifest.sources) ===
          JSON.stringify(parsed.data.sources)
      )
        return publicSession(existing.manifest);
      throw new CompanionError(
        "SESSION_CONFLICT",
        "This session identifier already exists.",
        409,
      );
    } catch (error) {
      if (error instanceof CompanionError) throw error;
      throw storageUnavailable();
    }
  }
  async get(access: RecordingAccess, id: string): Promise<Session> {
    return publicSession((await this.readManifest(access, id)).manifest);
  }
  async list(access: RecordingAccess, cursor?: string) {
    let decoded: { storageCursor?: string } = {};
    if (cursor) {
      try {
        decoded = JSON.parse(atob(cursor));
      } catch {
        throw new CompanionError("INVALID_REQUEST", "Invalid session cursor.");
      }
      if (
        decoded.storageCursor !== undefined &&
        typeof decoded.storageCursor !== "string"
      )
        throw new CompanionError("INVALID_REQUEST", "Invalid session cursor.");
    }
    const result = await this.storage().list({
      prefix: await this.prefix(access),
      delimiter: "/",
      limit: 50,
      ...(decoded.storageCursor ? { cursor: decoded.storageCursor } : {}),
    });
    const prefix = await this.prefix(access);
    const sessionPrefixes = result.delimitedPrefixes
      .filter(
        (key) =>
          key.startsWith(prefix) &&
          sessionIdSchema.safeParse(key.slice(prefix.length, -1)).success,
      )
      .sort();
    // A library page carries metadata only. Load large transcripts one session at
    // a time through GET rather than retaining 50 complete transcripts in a Worker.
    const sessions: Session[] = [];
    for (const key of sessionPrefixes) {
      const id = key.slice(prefix.length).replace(/\/$/, "");
      try {
        const session = await this.get(access, id);
        sessions.push({
          ...session,
          job: { ...session.job, transcripts: {}, summary: null },
        });
      } catch (error) {
        if (!(error instanceof CompanionError && error.status === 404))
          throw error;
      }
    }
    return {
      sessions: sessions.filter(
        (session): session is Session => session !== null,
      ),
      cursor: result.truncated
        ? btoa(JSON.stringify({ storageCursor: result.cursor }))
        : null,
    };
  }
  async putChunk(
    access: RecordingAccess,
    id: string,
    input: z.input<typeof chunkInputSchema>,
  ): Promise<Session> {
    const parsed = chunkInputSchema.safeParse(input);
    if (!parsed.success)
      throw new CompanionError("INVALID_REQUEST", "Invalid session chunk.");
    const manifest = (await this.readManifest(access, id)).manifest;
    if (manifest.state !== "uploading")
      throw new CompanionError(
        "SESSION_FINALIZED",
        "Finalized session chunks cannot be changed.",
        409,
      );
    if (!manifest.sources.includes(parsed.data.source))
      throw new CompanionError(
        "INVALID_REQUEST",
        "Source is not part of this session.",
      );
    // Both formats share the compressed segment budget; inspection below is format-specific.
    const bytes = decodeAudio(parsed.data.audio.data, "ogg");
    let durationSeconds: number;
    try {
      const inspected =
        parsed.data.audio.format === "ogg"
          ? inspectOggOpus(bytes).durationSeconds
          : inspectImportedAudio(bytes, "m4a").durationSeconds;
      if (
        inspected === null ||
        inspected <= 0 ||
        inspected > (parsed.data.audio.format === "m4a" ? 60.1 : 60)
      )
        throw new Error("Invalid segment duration");
      durationSeconds = inspected;
    } catch {
      throw new CompanionError(
        "INVALID_AUDIO",
        "Expected a valid Ogg Opus or M4A audio segment of at most 60 seconds.",
      );
    }
    const startSeconds = parsed.data.startSeconds;
    const sha = await sha256(bytes);
    const chunk: Chunk = {
      format: parsed.data.audio.format,
      source: parsed.data.source,
      sequence: parsed.data.sequence,
      startSeconds,
      durationSeconds,
      bytes: bytes.byteLength,
      sha256: sha,
    };
    const audioKey = `${await this.manifestKey(access, id)}`.replace(
      /manifest\.json$/,
      `chunks/${chunkKeyPart(chunk.source, chunk.sequence, chunk.format)}`,
    );
    const existing = manifest.chunks.find(
      (candidate) =>
        candidate.source === chunk.source &&
        candidate.sequence === chunk.sequence,
    );
    if (existing) {
      if (
        existing.format === chunk.format &&
        existing.sha256 === sha &&
        existing.startSeconds === startSeconds &&
        existing.durationSeconds === durationSeconds &&
        existing.bytes === bytes.byteLength
      )
        return publicSession(manifest);
      throw new CompanionError(
        "CHUNK_CONFLICT",
        "Chunk sequence already contains different audio.",
        409,
      );
    }
    if (
      manifest.chunks.length >= 240 ||
      manifest.chunks.filter((c) => c.source === chunk.source).length >= 120 ||
      startSeconds + durationSeconds >
        3600 + (chunk.format === "m4a" ? 0.1 : 0.001)
    )
      throw new CompanionError(
        "SESSION_LIMIT_EXCEEDED",
        "Session exceeds its recording limits.",
        413,
      );
    const bucket = this.storage();
    let stored: R2Object | null;
    try {
      stored = await bucket.put(audioKey, bytes, {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: {
          contentType: chunk.format === "m4a" ? "audio/mp4" : "audio/ogg",
          cacheControl: "private, no-store",
        },
        customMetadata: {
          sessionId: id,
          ownerId: access.ownerId,
          ...(access.tenantId !== undefined
            ? { tenantId: String(access.tenantId) }
            : {}),
          format: chunk.format,
          source: chunk.source,
          sequence: String(chunk.sequence),
          startSeconds: String(startSeconds),
          durationSeconds: String(durationSeconds),
          sha256: sha,
        },
      });
    } catch {
      throw storageUnavailable();
    }
    if (!stored) {
      // A previous request may have written the immutable audio object and then
      // lost its manifest CAS. Validate that orphaned object before adopting it.
      const prior = await bucket.get(audioKey).catch(() => null);
      if (!prior)
        throw new CompanionError(
          "CHUNK_CONFLICT",
          "Chunk sequence already contains different audio.",
          409,
        );
      const metadata = prior.customMetadata ?? {};
      const priorBytes = new Uint8Array(await prior.arrayBuffer());
      if (
        metadata.sessionId !== id ||
        metadata.ownerId !== access.ownerId ||
        metadata.tenantId !==
          (access.tenantId === undefined
            ? undefined
            : String(access.tenantId)) ||
        (metadata.format ?? "ogg") !== chunk.format ||
        metadata.source !== chunk.source ||
        metadata.sequence !== String(chunk.sequence) ||
        metadata.startSeconds !== String(startSeconds) ||
        metadata.durationSeconds !== String(durationSeconds) ||
        metadata.sha256 !== sha ||
        prior.size !== bytes.byteLength ||
        (await sha256(priorBytes)) !== sha
      )
        throw new CompanionError(
          "CHUNK_CONFLICT",
          "Chunk sequence already contains different audio.",
          409,
        );
    }
    try {
      const next = await this.mutate(access, id, (current) => {
        if (current.state !== "uploading")
          throw new CompanionError(
            "SESSION_FINALIZED",
            "Finalized session chunks cannot be changed.",
            409,
          );
        const duplicate = current.chunks.find(
          (c) => c.source === chunk.source && c.sequence === chunk.sequence,
        );
        if (duplicate) {
          if (
            duplicate.format === chunk.format &&
            duplicate.sha256 === sha &&
            duplicate.startSeconds === startSeconds &&
            duplicate.durationSeconds === durationSeconds
          )
            return current;
          throw new CompanionError(
            "CHUNK_CONFLICT",
            "Chunk sequence already contains different audio.",
            409,
          );
        }
        if (
          current.chunks.length >= 240 ||
          current.chunks.filter((c) => c.source === chunk.source).length >=
            120 ||
          !current.sources.includes(chunk.source)
        )
          throw new CompanionError(
            "SESSION_LIMIT_EXCEEDED",
            "Session exceeds its recording limits.",
            413,
          );
        current.chunks.push(chunk);
        return current;
      });
      return publicSession(next);
    } catch (error) {
      // Immutable chunk writes may precede a racing manifest update. Keep only a valid exact retry.
      if (error instanceof CompanionError && error.status === 409) throw error;
      throw error;
    }
  }
  async getAudio(
    access: RecordingAccess,
    id: string,
    source: z.infer<typeof sessionSourceSchema>,
    sequence: number,
  ) {
    const manifest = (await this.readManifest(access, id)).manifest;
    const chunk = manifest.chunks.find(
      (candidate) =>
        candidate.source === source && candidate.sequence === sequence,
    );
    if (!chunk) throw failMissing();
    const key = `${await this.manifestKey(access, id)}`.replace(
      /manifest\.json$/,
      `chunks/${chunkKeyPart(source, sequence, chunk.format)}`,
    );
    const object = await this.storage().get(key);
    if (!object) throw failMissing();
    const metadata = object.customMetadata ?? {};
    if (
      metadata.sessionId !== id ||
      metadata.ownerId !== access.ownerId ||
      metadata.tenantId !==
        (access.tenantId === undefined ? undefined : String(access.tenantId)) ||
      metadata.sha256 !== chunk.sha256 ||
      object.size !== chunk.bytes
    ) {
      await object.body.cancel();
      throw new CompanionError(
        "STORAGE_INVALID_RECORD",
        "Stored session audio is invalid.",
        503,
      );
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (
      (await sha256(bytes)) !== chunk.sha256 ||
      (metadata.format ?? "ogg") !== chunk.format ||
      metadata.source !== source ||
      metadata.sequence !== String(sequence) ||
      metadata.startSeconds !== String(chunk.startSeconds) ||
      metadata.durationSeconds !== String(chunk.durationSeconds)
    )
      throw new CompanionError(
        "STORAGE_INVALID_RECORD",
        "Stored session audio failed validation.",
        503,
      );
    return {
      source,
      sequence,
      format: chunk.format,
      startSeconds: chunk.startSeconds,
      durationSeconds: chunk.durationSeconds,
      sha256: chunk.sha256,
      bytes,
    };
  }
  /** Concatenated single-stream audio for one source, in timeline order. */
  async getFullAudio(
    access: RecordingAccess,
    id: string,
    source: z.infer<typeof sessionSourceSchema>,
  ) {
    const manifest = (await this.readManifest(access, id)).manifest;
    if (manifest.state !== "ready")
      throw new CompanionError(
        "SESSION_INCOMPLETE",
        "Finalize the session before downloading the full audio.",
        409,
      );
    const timeline = manifest.chunks
      .filter((candidate) => candidate.source === source)
      .sort((a, b) => a.sequence - b.sequence);
    if (!timeline.length)
      throw new CompanionError(
        "AUDIO_NOT_FOUND",
        "This session has no audio for that source.",
        404,
      );
    if (timeline.some((chunk, index) => chunk.sequence !== index))
      throw new CompanionError(
        "STORAGE_INVALID_RECORD",
        "Stored session audio failed validation.",
        503,
      );
    if (timeline.some((chunk) => chunk.format !== "ogg"))
      throw new CompanionError(
        "FULL_AUDIO_UNAVAILABLE",
        "Full download is available for desktop Ogg recordings; this source has segments in another format.",
        409,
      );
    const total = timeline.reduce((sum, chunk) => sum + chunk.bytes, 0);
    if (total <= 0 || total > 64 * 1024 * 1024)
      throw new CompanionError(
        "AUDIO_TOO_LARGE",
        "Full session audio exceeds the 64 MB download limit.",
        413,
      );
    // Ogg pages chain cleanly, so byte concatenation yields one playable
    // stream in timeline order.
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of timeline) {
      const audio = await this.getAudio(access, id, source, chunk.sequence);
      bytes.set(audio.bytes, offset);
      offset += audio.bytes.length;
    }
    return {
      source,
      format: "ogg" as const,
      chunks: timeline.length,
      durationSeconds: manifest.durationSeconds,
      bytes,
    };
  }
  async finalize(
    access: RecordingAccess,
    id: string,
    input: z.input<typeof finalizeSessionSchema>,
  ): Promise<Session> {
    const parsed = finalizeSessionSchema.safeParse(input);
    if (!parsed.success)
      throw new CompanionError(
        "INVALID_REQUEST",
        "Invalid session finalization request.",
      );
    const result = await this.mutate(access, id, (manifest) => {
      if (manifest.state === "ready") {
        if (
          manifest.chunks.length === parsed.data.expectedChunks &&
          manifest.durationSeconds === parsed.data.durationSeconds
        )
          return manifest;
        throw new CompanionError(
          "SESSION_FINALIZED",
          "Session was finalized with different details.",
          409,
        );
      }
      if (
        !manifest.chunks.length ||
        manifest.chunks.length !== parsed.data.expectedChunks ||
        manifest.chunks.length > 240
      )
        throw new CompanionError(
          "SESSION_INCOMPLETE",
          "Uploaded chunk count does not match finalization.",
          409,
        );
      for (const source of manifest.sources) {
        const list = manifest.chunks
          .filter((chunk) => chunk.source === source)
          .sort((a, b) => a.sequence - b.sequence);
        if (!list.length)
          throw new CompanionError(
            "SESSION_INCOMPLETE",
            "A declared source has no uploaded chunks.",
            409,
          );
        for (let index = 0; index < list.length; index++) {
          if (list[index].sequence !== index)
            throw new CompanionError(
              "SESSION_INCOMPLETE",
              "Chunk sequences must start at zero and be contiguous.",
              409,
            );
          if (
            index &&
            list[index].startSeconds <
              list[index - 1].startSeconds +
                list[index - 1].durationSeconds -
                (list[index - 1].format === "m4a" ? 0.1 : 0.001)
          )
            throw new CompanionError(
              "INVALID_TIMELINE",
              "Chunks for each source cannot overlap.",
            );
        }
      }
      if (
        manifest.chunks.some(
          (chunk) =>
            chunk.startSeconds + chunk.durationSeconds >
            parsed.data.durationSeconds +
              (chunk.format === "m4a" ? 0.1 : 0.001),
        )
      )
        throw new CompanionError(
          "INVALID_TIMELINE",
          "Session duration is shorter than uploaded audio.",
        );
      manifest.state = "ready";
      manifest.durationSeconds = parsed.data.durationSeconds;
      return manifest;
    });
    return publicSession(result);
  }
  async requestProcessing(
    access: RecordingAccess,
    id: string,
    input: z.input<typeof processingRequestSchema>,
  ): Promise<Session> {
    const parsed = processingRequestSchema.safeParse(input);
    if (!parsed.success)
      throw new CompanionError(
        "INVALID_REQUEST",
        "Invalid processing consent.",
      );
    const result = await this.mutate(access, id, (manifest) => {
      if (manifest.state !== "ready")
        throw new CompanionError(
          "SESSION_INCOMPLETE",
          "Finalize the session before processing.",
          409,
        );
      const currentLanguage = manifest.job.language ?? "es";
      const savedTranscripts = Object.keys(manifest.job.transcripts).length;
      const requestedLanguage =
        parsed.data.language ??
        (savedTranscripts > 0 ? currentLanguage : "auto");
      const switchLanguage =
        savedTranscripts > 0 && requestedLanguage !== currentLanguage;
      if (switchLanguage && !parsed.data.retranscribe)
        throw new CompanionError(
          "RETRANSCRIBE_REQUIRED",
          currentLanguage === "auto"
            ? `This session already has an automatically detected transcript. Confirm retranscription to force ${requestedLanguage}; saved results are replaced and provider usage may be billed again.`
            : `This session already has a transcript in ${currentLanguage}. Confirm retranscription to switch to ${requestedLanguage}; saved results are replaced and provider usage may be billed again.`,
          409,
        );
      if (switchLanguage) {
        manifest.job.transcripts = {};
        manifest.job.completedChunks = 0;
        manifest.job.summary = null;
        manifest.job.summaryWork = [];
        manifest.job.language = requestedLanguage;
        manifest.job.runId = crypto.randomUUID();
        manifest.job.status = "queued";
        manifest.job.lease = null;
        manifest.job.error = undefined;
      } else if (manifest.job.status === "complete") {
        throw new CompanionError(
          "PROCESSING_CONFLICT",
          "This session cannot be processed in its current state.",
          409,
        );
      } else if (
        manifest.job.status === "needs_attention" ||
        manifest.job.status === "cancelled"
      ) {
        if (!parsed.data.retryAmbiguous)
          throw new CompanionError(
            "PROCESSING_RECONCILIATION_REQUIRED",
            "Confirm retry after checking provider usage.",
            409,
          );
        manifest.job.runId = crypto.randomUUID();
        manifest.job.lease = null;
        manifest.job.error = undefined;
        manifest.job.status =
          manifest.job.completedChunks < manifest.chunks.length
            ? "queued"
            : "summarizing";
      } else if (
        manifest.job.status === "idle" ||
        manifest.job.status === "failed"
      ) {
        manifest.job.runId = crypto.randomUUID();
        manifest.job.status =
          manifest.job.completedChunks < manifest.chunks.length
            ? "queued"
            : "summarizing";
        manifest.job.error = undefined;
      }
      if (!switchLanguage && savedTranscripts === 0) {
        // No transcripts yet: an explicit choice is honored immediately,
        // otherwise a fresh run starts in detection mode.
        manifest.job.language = requestedLanguage;
      }
      manifest.job.totalChunks = manifest.chunks.length;
      return manifest;
    });
    if (result.job.status === "queued" || result.job.status === "summarizing")
      await this.schedule(access, id);
    return publicSession(result);
  }
  async cancelProcessing(
    access: RecordingAccess,
    id: string,
  ): Promise<Session> {
    const result = await this.mutate(access, id, (manifest) => {
      if (manifest.job.status === "complete")
        throw new CompanionError(
          "PROCESSING_CONFLICT",
          "Completed processing cannot be cancelled.",
          409,
        );
      if (manifest.job.status !== "idle") manifest.job.status = "cancelled";
      manifest.job.lease = null;
      return manifest;
    });
    await this.deleteSchedule(access, id, result.job.runId);
    return publicSession(result);
  }
  /** Internal engine helpers. */
  async readInternal(access: RecordingAccess, id: string) {
    return (await this.readManifest(access, id)).manifest;
  }
  async writeJob(
    access: RecordingAccess,
    id: string,
    update: (manifest: Manifest) => Manifest | Promise<Manifest>,
  ) {
    return this.mutate(access, id, update);
  }
  /** Claim a bounded scan range, not the jobs themselves. R2 leases own execution. */
  async takeJobCandidates(limit = 32): Promise<string[]> {
    const bucket = this.storage();
    const prefix = "companion/session-jobs/";
    const checkpointKey = "companion/session-job-scheduler/checkpoint.json";
    const count = Number.isFinite(limit)
      ? Math.max(1, Math.min(128, Math.floor(limit)))
      : 32;
    for (let attempt = 0; attempt < 12; attempt++) {
      const checkpoint = await bucket.get(checkpointKey);
      let startAfter: string | undefined;
      if (checkpoint) {
        const saved = await checkpoint.json<{ after?: unknown }>();
        if (typeof saved.after === "string" && saved.after.startsWith(prefix))
          startAfter = saved.after;
      }
      let page = await bucket.list({ prefix, limit: count, startAfter });
      // A lexical key survives deletion; opaque continuation tokens need not.
      if (!page.objects.length && startAfter)
        page = await bucket.list({ prefix, limit: count });
      const keys = page.objects.map((object) => object.key).sort();
      const saved = await bucket.put(
        checkpointKey,
        JSON.stringify({
          after: keys.at(-1) ?? null,
          // Prevent ABA when concurrent scans wrap to the same key.
          revision: crypto.randomUUID(),
        }),
        {
          onlyIf: checkpoint
            ? { etagMatches: checkpoint.etag }
            : { etagDoesNotMatch: "*" },
          httpMetadata: {
            contentType: "application/json; charset=utf-8",
            cacheControl: "private, no-store",
          },
        },
      );
      if (saved) return keys;
    }
    throw new CompanionError(
      "SESSION_QUEUE_BUSY",
      "Queue scan changed concurrently; retry on the next tick.",
      503,
    );
  }
  async listJobCandidates() {
    const bucket = this.storage();
    const result = await bucket.list({
      prefix: "companion/session-jobs/",
      limit: 1000,
    });
    return result.objects.map((object) => object.key).sort();
  }
  async schedule(access: RecordingAccess, id: string) {
    const prefix = await this.prefix(access);
    const manifest = await this.get(access, id);
    if (!manifest.job.runId) return manifest;
    const indexKey = `companion/session-jobs/${await keyPart(`${prefix}${id}`)}/${manifest.job.runId}.json`;
    await this.storage().put(
      indexKey,
      JSON.stringify({
        id,
        runId: manifest.job.runId,
        ownerId: access.ownerId,
        ...(access.tenantId !== undefined ? { tenantId: access.tenantId } : {}),
        manifestKey: `${prefix}${id}/manifest.json`,
      }),
      {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: {
          contentType: "application/json; charset=utf-8",
          cacheControl: "private, no-store",
        },
        customMetadata: {
          id,
          ownerIdHash: prefix.split("/")[2],
          ...(access.tenantId !== undefined
            ? { tenantId: String(access.tenantId) }
            : {}),
        },
      },
    );
    return manifest;
  }
  async deleteSchedule(
    access: RecordingAccess,
    id: string,
    runId: string | null,
  ) {
    if (!runId) return;
    const prefix = await this.prefix(access);
    await this.storage().delete(
      `companion/session-jobs/${await keyPart(`${prefix}${id}`)}/${runId}.json`,
    );
  }
  async readSchedule(key: string) {
    const object = await this.storage().get(key);
    if (!object) return null;
    try {
      const item = JSON.parse(await object.text());
      if (
        !sessionIdSchema.safeParse(item.runId).success ||
        typeof item.id !== "string" ||
        typeof item.ownerId !== "string" ||
        !(
          item.tenantId === undefined ||
          (Number.isSafeInteger(item.tenantId) && item.tenantId >= 0)
        )
      )
        return null;
      return {
        access: {
          ownerId: item.ownerId,
          ...(item.tenantId !== undefined ? { tenantId: item.tenantId } : {}),
          requireTenant: item.tenantId !== undefined,
        } as RecordingAccess,
        id: item.id,
        runId: item.runId as string,
      };
    } catch {
      return null;
    }
  }
}

export { chunkIdentity };
