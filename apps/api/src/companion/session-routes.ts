import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { EffectiveAssistantConfiguration } from "../assistant/configuration";
import type { RecordingAccess } from "./recordings";
import {
  CompanionError,
  type CompanionService,
  recordingQuestionSchema,
  recordingAnswerSchema,
} from "./service";
import {
  CompanionSessions,
  sessionSchema,
  sessionIdSchema,
  sessionSourceSchema,
  createSessionSchema,
  chunkInputSchema,
  finalizeSessionSchema,
  processingRequestSchema,
  renameSessionSchema,
} from "./sessions";
import { selectSessionEvidence } from "./session-evidence";

export function registerCompanionSessionRoutes(
  app: OpenAPIHono,
  options: {
    sessions: CompanionSessions;
    service: CompanionService;
    access: (context: Context) => Promise<RecordingAccess>;
    configuration: (
      context: Context,
      access: RecordingAccess,
    ) => Promise<EffectiveAssistantConfiguration>;
  },
) {
  const access = async (c: Context) => {
    const owner = await options.access(c);
    if (owner.tenantId === undefined)
      throw new CompanionError(
        "WORKSPACE_REQUIRED",
        "Select an active workspace for recording sessions.",
        403,
      );
    return { ...owner, requireTenant: true };
  };
  const security = (scope: string): Record<string, string[]>[] => [
    { oauth2: [scope] },
    { personalApiKey: [] },
  ];
  const params = z.object({ id: sessionIdSchema });
  const success = {
    description: "Recording session",
    content: { "application/json": { schema: sessionSchema } },
  };
  const uploadSchema = sessionSchema.omit({ job: true });
  const uploadSuccess = {
    description: "Uploaded session metadata",
    content: { "application/json": { schema: uploadSchema } },
  };
  const failure = {
    description: "Request rejected",
    content: {
      "application/json": {
        schema: z.object({
          error: z.object({ code: z.string(), message: z.string() }),
        }),
      },
    },
  };
  const failures = {
    400: failure,
    403: failure,
    404: failure,
    409: failure,
    413: failure,
    503: failure,
  };
  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/companion/sessions",
      tags: ["Companion"],
      security: security("recordings:read"),
      summary:
        "List owned session metadata; read an individual session for transcripts and notes",
      request: { query: z.object({ cursor: z.string().max(2048).optional() }) },
      responses: {
        200: {
          description: "Session page",
          content: {
            "application/json": {
              schema: z.object({
                sessions: z.array(sessionSchema),
                cursor: z.string().nullable(),
              }),
            },
          },
        },
        ...failures,
      },
    }),
    async (c) =>
      c.json(
        await options.sessions.list(
          await access(c),
          c.req.valid("query").cursor,
        ),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/companion/sessions",
      tags: ["Companion"],
      security: security("recordings:upload"),
      summary: "Create an idempotent consented recording session",
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: createSessionSchema } },
        },
      },
      responses: { 200: uploadSuccess, ...failures },
    }),
    async (c) =>
      c.json(
        uploadSchema.parse(
          await options.sessions.create(await access(c), c.req.valid("json")),
        ),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/companion/sessions/{id}",
      tags: ["Companion"],
      security: security("recordings:read"),
      summary: "Read recording progress, transcripts and notes",
      request: { params },
      responses: { 200: success, ...failures },
    }),
    async (c) =>
      c.json(
        await options.sessions.get(await access(c), c.req.valid("param").id),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "patch",
      path: "/v1/companion/sessions/{id}",
      tags: ["Companion"],
      security: security("recordings:upload"),
      summary: "Rename an owned recording session",
      request: {
        params,
        body: {
          required: true,
          content: { "application/json": { schema: renameSessionSchema } },
        },
      },
      responses: { 200: success, ...failures },
    }),
    async (c) =>
      c.json(
        await options.sessions.rename(
          await access(c),
          c.req.valid("param").id,
          c.req.valid("json"),
        ),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "delete",
      path: "/v1/companion/sessions/{id}",
      tags: ["Companion"],
      security: security("recordings:delete"),
      summary: "Permanently delete an owned recording session and its audio",
      request: { params },
      responses: {
        204: { description: "Recording session deleted" },
        ...failures,
      },
    }),
    async (c) => {
      await options.sessions.remove(await access(c), c.req.valid("param").id);
      return c.body(null, 204);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/companion/sessions/{id}/chunks",
      tags: ["Companion"],
      security: security("recordings:upload"),
      summary: "Upload an immutable independently decodable audio segment",
      request: {
        params,
        body: {
          required: true,
          content: { "application/json": { schema: chunkInputSchema } },
        },
      },
      responses: { 200: uploadSuccess, ...failures },
    }),
    async (c) =>
      c.json(
        uploadSchema.parse(
          await options.sessions.putChunk(
            await access(c),
            c.req.valid("param").id,
            c.req.valid("json"),
          ),
        ),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/companion/sessions/{id}/finalize",
      tags: ["Companion"],
      security: security("recordings:upload"),
      summary: "Finalize a complete recording timeline of up to one hour",
      request: {
        params,
        body: {
          required: true,
          content: { "application/json": { schema: finalizeSessionSchema } },
        },
      },
      responses: { 200: uploadSuccess, ...failures },
    }),
    async (c) =>
      c.json(
        uploadSchema.parse(
          await options.sessions.finalize(
            await access(c),
            c.req.valid("param").id,
            c.req.valid("json"),
          ),
        ),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/companion/sessions/{id}/chunks/{source}/{sequence}",
      tags: ["Companion"],
      security: security("recordings:read"),
      summary: "Play an owned audio segment",
      request: {
        params: params.extend({
          source: sessionSourceSchema,
          sequence: z.string().regex(/^(0|[1-9][0-9]{0,2})$/),
        }),
      },
      responses: {
        200: {
          description: "Ogg Opus or M4A audio",
          content: {
            "audio/ogg": { schema: z.string().openapi({ format: "binary" }) },
            "audio/mp4": { schema: z.string().openapi({ format: "binary" }) },
          },
        },
        ...failures,
      },
    }),
    async (c) => {
      const { id, source, sequence } = c.req.valid("param");
      if (Number(sequence) >= 120)
        throw new CompanionError("INVALID_REQUEST", "Invalid audio segment.");
      const audio = await options.sessions.getAudio(
        await access(c),
        id,
        source,
        Number(sequence),
      );
      return new Response(new Uint8Array(audio.bytes), {
        headers: {
          "Content-Type": audio.format === "m4a" ? "audio/mp4" : "audio/ogg",
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/companion/sessions/{id}/audio",
      tags: ["Companion"],
      security: security("recordings:read"),
      summary: "Download one source as a single concatenated Ogg audio file",
      request: {
        params,
        query: z.object({ source: sessionSourceSchema }),
      },
      responses: {
        200: {
          description: "Concatenated Ogg Opus audio in timeline order",
          content: {
            "audio/ogg": { schema: z.string().openapi({ format: "binary" }) },
          },
        },
        ...failures,
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const { source } = c.req.valid("query");
      const audio = await options.sessions.getFullAudio(
        await access(c),
        id,
        source,
      );
      return new Response(audio.bytes, {
        headers: {
          "Content-Type": "audio/ogg",
          "Content-Disposition": `inline; filename="savia-session-${id}-${source}.ogg"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/companion/sessions/{id}/notes",
      tags: ["Companion"],
      security: security("recordings:process"),
      summary:
        "Queue durable transcription and summary processing with provider consent",
      request: {
        params,
        body: {
          required: true,
          content: { "application/json": { schema: processingRequestSchema } },
        },
      },
      responses: { 200: success, ...failures },
    }),
    async (c) => {
      const owner = await access(c);
      await options.configuration(c, owner);
      return c.json(
        await options.sessions.requestProcessing(
          owner,
          c.req.valid("param").id,
          c.req.valid("json"),
        ),
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/companion/sessions/{id}/cancel",
      tags: ["Companion"],
      security: security("recordings:process"),
      summary: "Cancel pending provider work while preserving saved results",
      request: { params },
      responses: { 200: success, ...failures },
    }),
    async (c) =>
      c.json(
        await options.sessions.cancelProcessing(
          await access(c),
          c.req.valid("param").id,
        ),
        200,
      ),
  );
  const evidenceSchema = z.object({
    source: z.string(),
    sequence: z.number(),
    startSeconds: z.number(),
    durationSeconds: z.number(),
  });
  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/companion/sessions/{id}/questions",
      tags: ["Companion"],
      security: security("recordings:process"),
      summary:
        "Answer using bounded transcript evidence and return its timeline references",
      request: {
        params,
        body: {
          required: true,
          content: { "application/json": { schema: recordingQuestionSchema } },
        },
      },
      responses: {
        200: {
          description: "Grounded answer",
          content: {
            "application/json": {
              schema: recordingAnswerSchema.extend({
                partial: z.boolean(),
                evidence: z.array(evidenceSchema),
              }),
            },
          },
        },
        ...failures,
      },
    }),
    async (c) => {
      const owner = await access(c);
      const session = await options.sessions.get(
        owner,
        c.req.valid("param").id,
      );
      const input = c.req.valid("json");
      const segments = session.chunks.flatMap((chunk) => {
        const transcript =
          session.job.transcripts[`${chunk.source}:${chunk.sequence}`];
        return transcript ? [{ ...chunk, text: transcript.text }] : [];
      });
      if (!segments.length)
        throw new CompanionError(
          "TRANSCRIPT_REQUIRED",
          "Generate a transcript before asking questions.",
          409,
        );
      const selection = selectSessionEvidence(segments, input.question);
      const answer = selection.text
        ? await options.service.answer(
            await options.configuration(c, owner),
            selection.text,
            input,
          )
        : {
            answer:
              "There is insufficient transcript evidence to answer this question.",
            insufficientEvidence: true,
          };
      return c.json(
        {
          ...answer,
          partial:
            selection.partial || segments.length !== session.chunks.length,
          evidence: selection.evidence,
        },
        200,
      );
    },
  );
}
