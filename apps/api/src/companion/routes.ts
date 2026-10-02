import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  actorFromContext,
  requirePlatformAdministrator,
} from "../auth/middleware";
import type { AssistantConfigurationRepository } from "../assistant/configuration";
import {
  CompanionError,
  CompanionService,
  MAX_AUDIO_BYTES,
  transcribeSchema,
  transcriptSchema,
  summarizeSchema,
  summarySchema,
} from "./service";

import { MAX_OPUS_BYTES } from "./ogg";
import {
  CompanionRecordings,
  saveRecordingSchema,
  recordingSchema,
  recordingListSchema,
  recordingIdSchema,
  recordingNotesSchema,
} from "./recordings";

export type CompanionOptions = {
  storage?: R2Bucket;
  enabled: boolean;
  sttModel?: string;
  configuration?: Pick<
    AssistantConfigurationRepository,
    "effectiveConfigurationFor"
  >;
  service?: CompanionService;
};
const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
const failures = Object.fromEntries(
  [400, 401, 403, 404, 409, 413, 502, 503, 504].map((status) => [
    status,
    {
      description: "Request unavailable or rejected",
      content: { "application/json": { schema: errorSchema } },
    },
  ]),
);
const capabilitiesSchema = z.object({
  sttModel: z.string(),
  summaryModel: z.string(),
  maxDurationSeconds: z.number(),
  maxAudioBytes: z.number(),
  maxCompressedAudioBytes: z.number(),
  audioFormats: z.array(z.enum(["wav", "ogg"])),
  storageAvailable: z.boolean(),
  privacyRouting: z.literal("unverified"),
});
const capabilities = createRoute({
  method: "get",
  path: "/v1/companion/capabilities",
  tags: ["Companion"],
  summary: "Read the enabled Companion validation limits",
  security: [{ oauth2: ["savia.api.read"] }],
  responses: {
    200: {
      description: "Validation capabilities",
      content: { "application/json": { schema: capabilitiesSchema } },
    },
    ...failures,
  },
});
const transcribe = createRoute({
  method: "post",
  path: "/v1/companion/transcribe",
  tags: ["Companion"],
  summary: "Transcribe one consented short audio source",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: transcribeSchema } },
    },
  },
  responses: {
    200: {
      description: "Transcript (not persisted)",
      content: { "application/json": { schema: transcriptSchema } },
    },
    ...failures,
  },
});
const summarize = createRoute({
  method: "post",
  path: "/v1/companion/summarize",
  tags: ["Companion"],
  summary: "Generate reviewable meeting notes without business writes",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: summarizeSchema } },
    },
  },
  responses: {
    200: {
      description: "Draft notes (not persisted)",
      content: { "application/json": { schema: summarySchema } },
    },
    ...failures,
  },
});

export function registerCompanionRoutes(
  app: OpenAPIHono,
  options?: CompanionOptions,
) {
  const service =
    options?.service ?? new CompanionService({ sttModel: options?.sttModel });
  app.use("/v1/companion/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    requirePlatformAdministrator(actorFromContext(c));
    if (!options?.enabled || !options.configuration)
      return c.json(
        {
          error: {
            code: "COMPANION_DISABLED",
            message: "Companion validation is not enabled on this server.",
          },
        },
        503,
      );
    // Count actual body bytes even if Content-Length is absent or incorrect.
    if (c.req.method === "POST") {
      const max = c.req.path.endsWith("/transcribe")
        ? 12 * 1024 * 1024
        : c.req.path.endsWith("/recordings")
          ? 768 * 1024
          : 128 * 1024;
      const reader = c.req.raw.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        try {
          while (true) {
            const item = await reader.read();
            if (item.done) break;
            size += item.value.length;
            if (size > max)
              return c.json(
                {
                  error: {
                    code: "PAYLOAD_TOO_LARGE",
                    message: "The validation request exceeds its size limit.",
                  },
                },
                413,
              );
            chunks.push(item.value);
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
      }
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }
      const headers = new Headers(c.req.raw.headers);
      headers.delete("content-length");
      c.req.raw = new Request(c.req.url, {
        method: c.req.method,
        headers,
        body,
      });
    }
    try {
      await next();
      // Hono's composed handlers may already have converted a thrown route error.
      if (c.error instanceof CompanionError)
        c.res = c.json(
          { error: { code: c.error.code, message: c.error.message } },
          c.error.status,
        );
    } catch (error) {
      if (error instanceof CompanionError)
        return c.json(
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      throw error;
    }
  });
  const configuration = (principalId: string) =>
    options!.configuration!.effectiveConfigurationFor(principalId);
  app.openapi(capabilities, async (c) => {
    const config = await configuration(actorFromContext(c).principal.id);
    return c.json(
      {
        sttModel: config.transcriptionModel ?? service.sttModel,
        summaryModel: config.summaryModel ?? config.model,
        maxDurationSeconds: 60,
        maxAudioBytes: MAX_AUDIO_BYTES,
        maxCompressedAudioBytes: MAX_OPUS_BYTES,
        audioFormats: ["wav", "ogg"] as ("wav" | "ogg")[],
        storageAvailable: Boolean(options?.storage),
        privacyRouting: "unverified" as const,
      },
      200,
    );
  });
  app.openapi(transcribe, async (c) =>
    c.json(
      await service.transcribe(
        await configuration(actorFromContext(c).principal.id),
        c.req.valid("json"),
      ),
      200,
    ),
  );
  const recordings = new CompanionRecordings(options?.storage);
  const base = {
    tags: ["Companion"],
    security: [{ oauth2: ["savia.api.write"] }],
  };
  app.openapi(
    createRoute({
      ...base,
      method: "post",
      path: "/v1/companion/recordings",
      summary: "Save one private consented Opus sample",
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: saveRecordingSchema } },
        },
      },
      responses: {
        200: {
          description: "Saved sample",
          content: { "application/json": { schema: recordingSchema } },
        },
        ...failures,
      },
    }),
    async (c) =>
      c.json(
        await recordings.save(
          actorFromContext(c).principal.id,
          c.req.valid("json"),
        ),
        200,
      ),
  );
  app.openapi(
    createRoute({
      ...base,
      security: [{ oauth2: ["savia.api.read"] }],
      method: "get",
      path: "/v1/companion/recordings",
      summary: "List the current user's private samples",
      request: { query: z.object({ cursor: z.string().max(1024).optional() }) },
      responses: {
        200: {
          description: "Private samples",
          content: { "application/json": { schema: recordingListSchema } },
        },
        ...failures,
      },
    }),
    async (c) =>
      c.json(
        await recordings.list(
          actorFromContext(c).principal.id,
          c.req.valid("query").cursor,
        ),
        200,
      ),
  );
  const params = z.object({ id: recordingIdSchema });
  app.openapi(
    createRoute({
      ...base,
      security: [{ oauth2: ["savia.api.read"] }],
      method: "get",
      path: "/v1/companion/recordings/{id}",
      summary: "Download the current user's private sample",
      request: { params },
      responses: {
        200: {
          description: "Ogg/Opus audio",
          content: {
            "audio/ogg": { schema: z.string().openapi({ format: "binary" }) },
          },
        },
        ...failures,
      },
    }),
    async (c) => {
      const id = c.req.valid("param").id;
      const object = await recordings.get(actorFromContext(c).principal.id, id);
      return new Response(object.body, {
        headers: {
          "Content-Type": "audio/ogg",
          "Cache-Control": "private, no-store",
          "Content-Length": String(object.size),
          "Content-Disposition": `attachment; filename="${id}.ogg"`,
        },
      });
    },
  );
  const notesParams = z.object({ id: recordingIdSchema });
  const notesConsentSchema = z.object({ consent: z.literal(true) }).strict();
  app.openapi(
    createRoute({
      ...base,
      security: [{ oauth2: ["savia.api.read"] }],
      method: "get",
      path: "/v1/companion/recordings/{id}/notes",
      summary: "Read saved transcript and draft notes",
      request: { params: notesParams },
      responses: {
        200: {
          description: "Persisted transcript and meeting notes",
          content: { "application/json": { schema: recordingNotesSchema } },
        },
        ...failures,
      },
    }),
    async (c) =>
      c.json(
        await recordings.getNotes(
          actorFromContext(c).principal.id,
          c.req.valid("param").id,
        ),
        200,
      ),
  );
  app.openapi(
    createRoute({
      ...base,
      method: "post",
      path: "/v1/companion/recordings/{id}/notes",
      summary:
        "Transcribe and summarize one saved sample with explicit consent",
      request: {
        params: notesParams,
        body: {
          required: true,
          content: { "application/json": { schema: notesConsentSchema } },
        },
      },
      responses: {
        200: {
          description: "Persisted transcript and draft notes",
          content: { "application/json": { schema: recordingNotesSchema } },
        },
        ...failures,
      },
    }),
    async (c) => {
      const owner = actorFromContext(c).principal.id;
      const id = c.req.valid("param").id;
      return recordings.withNotesLock(owner, id, async () => {
        let notes = await recordings.getNotes(owner, id);
        if (notes.summary) return c.json(notes, 200);

        const config = await configuration(owner);
        if (!notes.transcript) {
          const audio = await recordings.getAudio(owner, id);
          let binary = "";
          for (let offset = 0; offset < audio.bytes.length; offset += 0x8000) {
            binary += String.fromCharCode(
              ...audio.bytes.subarray(offset, offset + 0x8000),
            );
          }
          const transcript = await service.transcribe(config, {
            source: audio.source,
            audio: { data: btoa(binary), format: "ogg" },
            language: "es",
            consent: true,
          });
          notes = { transcript, summary: null };
          await recordings.storeNotes(owner, id, notes);
        }

        const transcript = notes.transcript;
        if (!transcript)
          throw new CompanionError(
            "STORAGE_INVALID_RECORD",
            "Stored recording notes are invalid.",
            503,
          );
        const summary = await service.summarize(config, {
          transcripts: [{ source: transcript.source, text: transcript.text }],
          consent: true,
        });
        notes = { transcript, summary };
        await recordings.storeNotes(owner, id, notes);
        return c.json(notes, 200);
      });
    },
  );
  app.openapi(
    createRoute({
      ...base,
      method: "delete",
      path: "/v1/companion/recordings/{id}",
      summary: "Delete the current user's private sample",
      request: { params },
      responses: { 204: { description: "Sample deleted" }, ...failures },
    }),
    async (c) => {
      await recordings.remove(
        actorFromContext(c).principal.id,
        c.req.valid("param").id,
      );
      return c.body(null, 204);
    },
  );

  app.openapi(summarize, async (c) =>
    c.json(
      await service.summarize(
        await configuration(actorFromContext(c).principal.id),
        c.req.valid("json"),
      ),
      200,
    ),
  );
}
