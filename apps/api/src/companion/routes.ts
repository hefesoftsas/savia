import type { Context } from "hono";
import {
  DEFAULT_CANONICAL_HOST,
  parseTenantSlugFromHostname,
} from "@savia/tenant-host/tenant-host";
import { recordingScopeSchema } from "../auth/personal-api-keys";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { actorFromContext } from "../auth/middleware";
import { AuthenticationError, type AppActor } from "../auth/types";
import {
  requiredOAuthScope,
  requiredRecordingScope,
} from "../auth/oauth-resource";
import type { AssistantConfigurationRepository } from "../assistant/configuration";
import {
  CompanionError,
  CompanionService,
  MAX_AUDIO_BYTES,
  transcribeSchema,
  transcriptSchema,
  summarizeSchema,
  summarySchema,
  recordingQuestionSchema,
  recordingAnswerSchema,
  companionProviderOperationSchema,
} from "./service";

import {
  MAX_RECORDING_BYTES,
  importedAudioFormatSchema,
} from "./imported-audio";
import type { PersonalIntegrationOperations } from "../personal-integrations/operations";
import {
  PersonalIntegrationInputError,
  PersonalIntegrationUnavailableError,
  PersonalIntegrationUpstreamError,
  PersonalIntegrationAccessError,
} from "../personal-integrations/contracts";
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
  personalFiles?: Pick<PersonalIntegrationOperations, "downloadRecordingFile">;
  enabled: boolean;
  sttModel?: string;
  configuration?: Pick<
    AssistantConfigurationRepository,
    "effectiveConfigurationFor"
  > &
    Partial<
      Pick<
        AssistantConfigurationRepository,
        "effectiveConfigurationForTenant" | "activeTenantFor"
      >
    >;
  service?: CompanionService;
};
const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    providerOperation: companionProviderOperationSchema.optional(),
    upstreamStatus: z.number().int().min(100).max(599).optional(),
  }),
});
function companionErrorBody(error: CompanionError) {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.providerOperation && error.upstreamStatus !== undefined
        ? {
            providerOperation: error.providerOperation,
            upstreamStatus: error.upstreamStatus,
          }
        : {}),
    },
  };
}
const failures = Object.fromEntries(
  [400, 401, 403, 404, 409, 413, 502, 503, 504].map((status) => [
    status,
    {
      description: "Request unavailable or rejected",
      content: { "application/json": { schema: errorSchema } },
    },
  ]),
);
const cloudImportSchema = z
  .object({
    id: recordingIdSchema,
    provider: z.enum([
      "google_drive",
      "onedrive_personal",
      "onedrive_business",
    ]),
    fileId: z.string().min(1).max(1024),
    consent: z.literal(true),
  })
  .strict();
const uploadQuerySchema = z.object({
  id: recordingIdSchema,
  name: z.string().trim().min(1).max(255),
  format: importedAudioFormatSchema,
  consent: z.literal("true"),
});
const recordingMimeTypes = {
  ogg: "audio/ogg",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
} as const;
function requireCompanionAccess(actor: AppActor) {
  if (!actor.principal.isActive)
    throw new AuthenticationError(
      "AUTHORIZATION_FORBIDDEN",
      "An active tenant membership or platform administrator role is required",
    );
  if (actor.globalRoles.includes("platform_admin")) return;
  if (
    actor.memberships.some(
      (membership) =>
        membership.isActive && (membership.tenantId ?? membership.agencyId) > 0,
    )
  )
    return;
  throw new AuthenticationError(
    "AUTHORIZATION_FORBIDDEN",
    "An active tenant membership or platform administrator role is required",
  );
}
function cloudFormat(name: string) {
  const result = importedAudioFormatSchema.safeParse(
    ["opus", "oga"].includes(name.split(".").pop()?.toLowerCase() ?? "")
      ? "ogg"
      : name.split(".").pop()?.toLowerCase(),
  );
  if (!result.success)
    throw new CompanionError(
      "INVALID_AUDIO",
      "Choose an MP3, WAV, M4A or OGG/Opus file.",
    );
  return result.data;
}
const capabilitiesSchema = z.object({
  sttModel: z.string(),
  summaryModel: z.string(),
  maxDurationSeconds: z.number(),
  maxAudioBytes: z.number(),
  maxCompressedAudioBytes: z.number(),
  audioFormats: z.array(z.enum(["wav", "ogg"])),
  storageAvailable: z.boolean(),
  grantedRecordingScopes: z.array(recordingScopeSchema).optional(),
  privacyRouting: z.literal("unverified"),
});
const recordingReadSecurity: Record<string, string[]>[] = [
  { oauth2: ["recordings:read"] },
  { personalApiKey: [] },
];
const recordingUploadSecurity: Record<string, string[]>[] = [
  { oauth2: ["recordings:upload"] },
  { personalApiKey: [] },
];
const recordingProcessSecurity: Record<string, string[]>[] = [
  { oauth2: ["recordings:process"] },
  { personalApiKey: [] },
];
const capabilities = createRoute({
  method: "get",
  path: "/v1/companion/capabilities",
  tags: ["Companion"],
  summary: "Read the enabled Companion validation limits",
  security: recordingReadSecurity,
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
  const uploadBodies = new WeakMap<Request, Uint8Array<ArrayBuffer>>();
  const service =
    options?.service ?? new CompanionService({ sttModel: options?.sttModel });
  app.use("/v1/companion/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    requireCompanionAccess(actorFromContext(c));
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
      const max = c.req.path.endsWith("/recordings/upload")
        ? MAX_RECORDING_BYTES
        : c.req.path.endsWith("/transcribe")
          ? 12 * 1024 * 1024
          : c.req.path.endsWith("/recordings")
            ? 768 * 1024
            : 128 * 1024;
      const advertised = Number(c.req.header("content-length"));
      if (advertised > max)
        return c.json(
          {
            error: {
              code: "PAYLOAD_TOO_LARGE",
              message: "The recording exceeds its size limit.",
            },
          },
          413,
        );
      const reader = c.req.raw.body?.getReader();
      let bodyBuffer = new Uint8Array(0);
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
            if (size > bodyBuffer.byteLength) {
              const capacity = Math.min(
                max,
                Math.max(size, 65536, bodyBuffer.byteLength * 2),
              );
              const expanded = new Uint8Array(capacity);
              expanded.set(bodyBuffer);
              bodyBuffer = expanded;
            }
            bodyBuffer.set(item.value, size - item.value.byteLength);
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
      }
      const body = bodyBuffer.subarray(0, size);
      bodyBuffer = new Uint8Array(0);
      if (c.req.path.endsWith("/recordings/upload")) {
        uploadBodies.set(c.req.raw, body);
      } else {
        const headers = new Headers(c.req.raw.headers);
        headers.delete("content-length");
        c.req.raw = new Request(c.req.url, {
          method: c.req.method,
          headers,
          body,
        });
      }
    }
    try {
      await next();
      // Hono's composed handlers may already have converted a thrown route error.
      if (c.error instanceof CompanionError)
        c.res = c.json(companionErrorBody(c.error), c.error.status);
    } catch (error) {
      if (error instanceof CompanionError)
        return c.json(companionErrorBody(error), error.status);
      throw error;
    }
  });
  const configuration = (
    actor: AppActor,
    accessContext?: { tenantId?: number; requireTenant: boolean },
  ) => {
    const repo = options!.configuration!;
    if (actor.credential?.kind === "personal-api-key") {
      if (!repo.effectiveConfigurationForTenant)
        throw new CompanionError(
          "COMPANION_UNAVAILABLE",
          "Tenant processing configuration is unavailable",
          503,
        );
      return repo.effectiveConfigurationForTenant(
        actor.principal.id,
        actor.credential.tenantId,
      );
    }
    if (actor.credential?.kind === "oauth" && accessContext?.requireTenant) {
      if (!repo.effectiveConfigurationForTenant || !accessContext.tenantId)
        throw new CompanionError(
          "COMPANION_UNAVAILABLE",
          "Tenant processing configuration is unavailable",
          503,
        );
      return repo.effectiveConfigurationForTenant(
        actor.principal.id,
        accessContext.tenantId,
      );
    }
    return repo.effectiveConfigurationFor(actor.principal.id);
  };
  const access = async (c: Context) => {
    const actor = actorFromContext(c);
    const keyed =
      actor.credential?.kind === "personal-api-key"
        ? actor.credential
        : undefined;
    const recordingScopedOAuth =
      actor.credential?.kind === "oauth" &&
      requiredRecordingScope(c.req.raw) !== null &&
      actor.credential.scopes.some((scope) =>
        ["recordings:read", "recordings:upload", "recordings:process"].includes(
          scope,
        ),
      ) &&
      !actor.credential.scopes.includes(requiredOAuthScope(c.req.raw));
    let selectedTenantId: number | undefined;
    if (recordingScopedOAuth) {
      const header = c.req.header("x-savia-tenant-id");
      selectedTenantId =
        header && /^\d+$/.test(header) ? Number(header) : undefined;
      const membership = actor.memberships.find(
        (entry) =>
          entry.isActive &&
          (entry.tenantId ?? entry.agencyId) === selectedTenantId &&
          selectedTenantId !== undefined &&
          selectedTenantId > 0 &&
          entry.tenantSlug,
      );
      const tenantHostSlug = parseTenantSlugFromHostname(
        new URL(c.req.url).hostname,
        DEFAULT_CANONICAL_HOST,
      );
      const headerSlug = c.req.header("x-savia-tenant-slug")?.toLowerCase();
      if (
        !membership ||
        (headerSlug && headerSlug !== membership.tenantSlug?.toLowerCase()) ||
        (tenantHostSlug &&
          tenantHostSlug !== membership.tenantSlug?.toLowerCase()) ||
        (headerSlug && tenantHostSlug && headerSlug !== tenantHostSlug)
      ) {
        throw new AuthenticationError(
          "AUTHORIZATION_FORBIDDEN",
          "Select an active workspace that matches this Savia workspace URL.",
        );
      }
    }
    return {
      ownerId: actor.principal.id,
      tenantId: keyed
        ? keyed.tenantId
        : recordingScopedOAuth
          ? selectedTenantId
          : await options?.configuration?.activeTenantFor?.(actor.principal.id),
      requireTenant: Boolean(keyed || recordingScopedOAuth),
    };
  };
  app.openapi(capabilities, async (c) => {
    const actor = actorFromContext(c);
    const owner = await access(c);
    const config = await configuration(actor, owner);
    return c.json(
      {
        sttModel: config.transcriptionModel ?? service.sttModel,
        summaryModel: config.summaryModel ?? config.model,
        maxDurationSeconds: 60,
        maxAudioBytes: MAX_AUDIO_BYTES,
        maxCompressedAudioBytes: MAX_OPUS_BYTES,
        audioFormats: ["wav", "ogg"] as ("wav" | "ogg")[],
        storageAvailable: Boolean(options?.storage),
        ...(actorFromContext(c).credential?.kind === "personal-api-key"
          ? {
              grantedRecordingScopes: (
                actorFromContext(c).credential as {
                  scopes: import("../auth/personal-api-keys").RecordingScope[];
                }
              ).scopes,
            }
          : {}),
        privacyRouting: "unverified" as const,
      },
      200,
    );
  });
  app.openapi(transcribe, async (c) =>
    c.json(
      await service.transcribe(
        await configuration(actorFromContext(c)),
        c.req.valid("json"),
      ),
      200,
    ),
  );
  const recordings = new CompanionRecordings(options?.storage);
  const base: { tags: string[]; security: Record<string, string[]>[] } = {
    tags: ["Companion"],
    security: [{ oauth2: ["savia.api.write"] }, { personalApiKey: [] }],
  };
  app.openapi(
    createRoute({
      ...base,
      security: recordingUploadSecurity,
      method: "post",
      path: "/v1/companion/recordings/upload",
      summary: "Upload a private audio recording up to 50 MB",
      request: {
        query: uploadQuerySchema,
        body: {
          required: true,
          content: {
            "application/octet-stream": {
              schema: z.string().openapi({ format: "binary" }),
            },
          },
        },
      },
      responses: {
        200: {
          description: "Saved private recording",
          content: { "application/json": { schema: recordingSchema } },
        },
        ...failures,
      },
    }),
    async (c) => {
      const input = c.req.valid("query");
      const bytes = uploadBodies.get(c.req.raw);
      if (!bytes)
        throw new CompanionError("INVALID_AUDIO", "Missing audio file.");
      uploadBodies.delete(c.req.raw);
      return c.json(
        await recordings.saveImported(await access(c), {
          id: input.id,
          name: input.name,
          format: input.format,
          origin: "local",
          bytes,
        }),
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      ...base,
      method: "post",
      path: "/v1/companion/recordings/import",
      security: [{ oauth2: ["savia.api.write"] }],
      summary:
        "Import a selected recording from the current user's connected drive",
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: cloudImportSchema } },
        },
      },
      responses: {
        200: {
          description: "Saved private recording",
          content: { "application/json": { schema: recordingSchema } },
        },
        ...failures,
        403: {
          description: "Personal connection access denied",
          content: { "application/json": { schema: errorSchema } },
        },
      },
    }),
    async (c) => {
      if (!options?.personalFiles)
        throw new CompanionError(
          "CLOUD_UNAVAILABLE",
          "Cloud file connections are unavailable.",
          503,
        );
      const input = c.req.valid("json");
      try {
        const file = await options.personalFiles.downloadRecordingFile({
          principalId: actorFromContext(c).principal.id,
          provider: input.provider,
          fileId: input.fileId,
        });
        return c.json(
          await recordings.saveImported(await access(c), {
            id: input.id,
            name: file.name,
            origin: input.provider,
            bytes: file.bytes,
            format: cloudFormat(file.name),
          }),
          200,
        );
      } catch (error) {
        if (error instanceof PersonalIntegrationInputError)
          throw new CompanionError(error.code, error.message);
        if (error instanceof PersonalIntegrationUnavailableError)
          throw new CompanionError(error.code, error.message, 503);
        if (error instanceof PersonalIntegrationUpstreamError)
          throw new CompanionError(error.code, error.message, 502);
        if (error instanceof PersonalIntegrationAccessError)
          return c.json(
            { error: { code: error.code, message: error.message } },
            403,
          );
        throw error;
      }
    },
  );
  app.openapi(
    createRoute({
      ...base,
      security: recordingUploadSecurity,
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
      c.json(await recordings.save(await access(c), c.req.valid("json")), 200),
  );
  app.openapi(
    createRoute({
      ...base,
      security: recordingReadSecurity,
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
        await recordings.list(await access(c), c.req.valid("query").cursor),
        200,
      ),
  );
  const params = z.object({ id: recordingIdSchema });
  app.openapi(
    createRoute({
      ...base,
      security: recordingReadSecurity,
      method: "get",
      path: "/v1/companion/recordings/{id}",
      summary: "Download the current user's private sample",
      request: { params },
      responses: {
        200: {
          description: "Original recording audio",
          content: {
            "audio/ogg": { schema: z.string().openapi({ format: "binary" }) },
            "audio/mpeg": { schema: z.string().openapi({ format: "binary" }) },
            "audio/wav": { schema: z.string().openapi({ format: "binary" }) },
            "audio/mp4": { schema: z.string().openapi({ format: "binary" }) },
          },
        },
        ...failures,
      },
    }),
    async (c) => {
      const id = c.req.valid("param").id;
      const object = await recordings.get(await access(c), id);
      const format = importedAudioFormatSchema.parse(
        object.customMetadata?.format ?? "ogg",
      );
      const name = object.customMetadata?.name ?? `${id}.${format}`;
      return new Response(object.body, {
        headers: {
          "Content-Type": recordingMimeTypes[format],
          "Cache-Control": "private, no-store",
          "Content-Length": String(object.size),
          "Content-Disposition": `attachment; filename="${id}.${format}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        },
      });
    },
  );
  const notesParams = z.object({ id: recordingIdSchema });
  const notesConsentSchema = z.object({ consent: z.literal(true) }).strict();
  app.openapi(
    createRoute({
      ...base,
      security: recordingReadSecurity,
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
        await recordings.getNotes(await access(c), c.req.valid("param").id),
        200,
      ),
  );
  app.openapi(
    createRoute({
      ...base,
      security: recordingProcessSecurity,
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
      const owner = await access(c);
      const id = c.req.valid("param").id;
      return recordings.withNotesLock(owner, id, async () => {
        let notes = await recordings.getNotes(owner, id);
        if (notes.summary) return c.json(notes, 200);

        const config = await configuration(actorFromContext(c), owner);
        if (!notes.transcript) {
          const audio = await recordings.getAudio(owner, id);
          let binary = "";
          for (
            let offset = 0;
            audio.source !== "upload" && offset < audio.bytes.length;
            offset += 0x8000
          ) {
            binary += String.fromCharCode(
              ...audio.bytes.subarray(offset, offset + 0x8000),
            );
          }
          const transcript =
            audio.source === "upload"
              ? await service.transcribeRecording(config, audio)
              : await service.transcribe(config, {
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
      security: recordingProcessSecurity,
      method: "post",
      path: "/v1/companion/recordings/{id}/questions",
      summary: "Answer a question using only the saved recording transcript",
      request: {
        params,
        body: {
          required: true,
          content: { "application/json": { schema: recordingQuestionSchema } },
        },
      },
      responses: {
        200: {
          description: "Draft answer, not persisted",
          content: { "application/json": { schema: recordingAnswerSchema } },
        },
        ...failures,
      },
    }),
    async (c) => {
      const owner = await access(c);
      const notes = await recordings.getNotes(owner, c.req.valid("param").id);
      if (!notes.transcript?.text.trim())
        throw new CompanionError(
          "TRANSCRIPT_REQUIRED",
          "Generate a transcript before asking about this recording.",
          409,
        );
      return c.json(
        await service.answer(
          await configuration(actorFromContext(c), owner),
          notes.transcript.text,
          c.req.valid("json"),
        ),
        200,
      );
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
      await recordings.remove(await access(c), c.req.valid("param").id);
      return c.body(null, 204);
    },
  );

  app.openapi(summarize, async (c) =>
    c.json(
      await service.summarize(
        await configuration(actorFromContext(c)),
        c.req.valid("json"),
      ),
      200,
    ),
  );
}
