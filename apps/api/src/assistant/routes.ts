import { registerEmployeeMcpRoutes } from "./employee-mcp";
import { PendingActionRepository } from "./pending-actions";
import { z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { actorFromContext } from "../auth/middleware";
import { AuthenticationError } from "../auth/types";
import type { AssistantService } from "./contracts";
import type { AssistantConfigurationRepository } from "./configuration";
import { VirtualEmployeesRepository } from "./virtual-employees";
import { employeeTenantScope } from "./employee-scope";
import { pluginAuthoringRequestSchema } from "@savia/studio-shared/plugin-authoring";
import {
  createPluginAuthoringService,
  PluginAuthoringError,
  type PluginAuthoringCollection,
} from "./plugin-authoring";
import {
  createPluginCompletionService,
  PluginCompletionError,
} from "./plugin-completion";
import { pluginCompletionRequestSchema } from "@savia/studio-shared/plugin-completion";
import {
  AssistantConfigurationUnavailableError,
  normalizeAssistantModel,
} from "./configuration";
import {
  extractTextFromFile,
  indexDocument,
  deleteFileVectors,
  type RagEnvironment,
} from "./rag";
import { disabledSolutionObjects } from "@savia/studio-server/solutions";
import { CompanionError } from "../companion/service";
import {
  AssistantThreadConflictError,
  AssistantThreadRepository,
  assistantThreadMessagesSchema,
  assistantThreadWriteSchema,
} from "./threads";

const chatRequestSchema = z.object({
  messages: assistantThreadMessagesSchema,
  employeeId: z.string().optional(),
  employeeHandle: z.string().optional(),
  inferEmployeeFromMentions: z.boolean().optional(),
  responseMode: z.literal("text").optional(),
  model: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .refine((value) => {
      try {
        return Boolean(normalizeAssistantModel(value));
      } catch {
        return false;
      }
    }, "An OpenRouter model must use provider/model format")
    .optional(),
  threadId: z.string().uuid().optional(),
});

function assertEmployeeModelAdministrator(
  actor: ReturnType<typeof actorFromContext>,
  tenantId: number | null,
  model: string | null | undefined,
  allowInherited = true,
): void {
  if (
    model === undefined ||
    (allowInherited && !model?.trim()) ||
    actor.globalRoles.includes("platform_admin")
  )
    return;
  if (
    tenantId !== null &&
    actor.memberships.some(
      (membership) =>
        membership.isActive &&
        (membership.tenantId ?? membership.agencyId) === tenantId &&
        ["tenant_admin", "agency_admin"].includes(membership.role),
    )
  )
    return;
  throw new AuthenticationError(
    "AUTHORIZATION_FORBIDDEN",
    "Only an administrator can assign an employee model. Use the inherited default.",
  );
}

const createEmployeeSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  handle: z.string().trim().min(1, "Handle is required"),
  position: z.string().trim().optional().nullable(),
  avatar: z.string().trim().optional().nullable(),
  greeting: z.string().trim().optional().nullable(),
  systemPrompt: z.string().trim().min(1, "System prompt is required"),
  allowedCollections: z.array(z.string()).optional(),
  model: z.string().trim().optional().nullable(),
  status: z.enum(["active", "inactive"]).optional(),
});

const updateEmployeeSchema = createEmployeeSchema.partial();

export type AssistantRouteDependencies = {
  db?: D1Database;
  documents?: R2Bucket;
  ragEnv?: RagEnvironment;
  configuration?: AssistantConfigurationRepository;
  loadThreadContext?: (
    actor: ReturnType<typeof actorFromContext>,
    request: Request,
    threadContext: { kind: "recording" | "session"; id: string; title: string },
  ) => Promise<{
    kind: "recording" | "session";
    title: string;
    content: string;
    tenantId: number | null;
  }>;
};

function unavailableResponse(): Response {
  return Response.json(
    {
      error: {
        code: "ASSISTANT_UNAVAILABLE",
        message: "The assistant is not configured",
      },
    },
    { status: 503 },
  );
}

function authorizationFor(context: Context): string {
  const authorization = context.req.header("authorization");
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) {
    throw new AuthenticationError(
      "AUTHENTICATION_REQUIRED",
      "A bearer token is required for assistant requests",
    );
  }
  return authorization;
}

function pluginAuthoringDependencies(app: OpenAPIHono, context: Context) {
  return {
    loadCollectionMetadata: async (tenantId: number, signal?: AbortSignal) => {
      // Resolve through the same authenticated Studio route used by clients.
      // The fixed path keeps the client from selecting another source URL.
      const target = new URL(context.req.url);
      target.pathname = `/v1/studio/${tenantId}/api/objects`;
      target.search = "";
      const headers = new Headers();
      for (const name of ["authorization", "cookie"]) {
        const value = context.req.header(name);
        if (value) headers.set(name, value);
      }
      const response = await app.fetch(
        new Request(target, { method: "GET", headers, signal }),
        context.env,
      );
      if (!response.ok)
        throw new Error("Authorized collection metadata lookup failed");
      const body = (await response.json().catch(() => null)) as {
        data?: unknown;
      } | null;
      if (!body || !Array.isArray(body.data))
        throw new Error("Authorized collection metadata was invalid");
      return summarizePluginAuthoringCollections(body.data);
    },
  };
}

export function registerAssistantRoutes(
  app: OpenAPIHono,
  service?: AssistantService,
  dependencies?: AssistantRouteDependencies,
): void {
  registerEmployeeMcpRoutes(app, service, dependencies);
  app.post("/api/assistant/plugin-authoring", async (context) => {
    if (!dependencies?.configuration) return unavailableResponse();
    const parsed = pluginAuthoringRequestSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return context.json(
        { error: { code: "VALIDATION_ERROR", message: "Invalid request" } },
        400,
      );
    }
    const actor = actorFromContext(context);
    const pluginAuthoring = createPluginAuthoringService(
      dependencies.configuration,
      pluginAuthoringDependencies(app, context),
    );
    try {
      const result = await pluginAuthoring.generate({
        ...parsed.data,
        principalId: actor.principal.id,
        isPlatformAdministrator: actor.globalRoles.includes("platform_admin"),
        signal: context.req.raw.signal,
      });
      return context.json(result);
    } catch (error) {
      if (error instanceof PluginAuthoringError) {
        return context.json(
          {
            error: {
              code: error.code,
              message: error.message,
              ...(error.details ? { details: error.details } : {}),
            },
          },
          error.status,
        );
      }
      if (error instanceof AssistantConfigurationUnavailableError)
        return unavailableResponse();
      throw error;
    }
  });
  app.post("/api/assistant/plugin-completion", async (context) => {
    if (!dependencies?.configuration) return unavailableResponse();
    const parsed = pluginCompletionRequestSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return context.json(
        { error: { code: "VALIDATION_ERROR", message: "Invalid request" } },
        400,
      );
    }
    const actor = actorFromContext(context);
    const completions = createPluginCompletionService(
      dependencies.configuration,
    );
    try {
      const result = await completions.complete({
        ...parsed.data,
        principalId: actor.principal.id,
        isPlatformAdministrator: actor.globalRoles.includes("platform_admin"),
        signal: context.req.raw.signal,
      });
      return context.json(result);
    } catch (error) {
      if (error instanceof PluginCompletionError) {
        return context.json(
          {
            error: {
              code: error.code,
              message: error.message,
            },
          },
          error.status,
        );
      }
      if (error instanceof AssistantConfigurationUnavailableError)
        return unavailableResponse();
      throw error;
    }
  });
  app.post("/api/assistant/plugin-authoring/stream", async (context) => {
    if (!dependencies?.configuration) return unavailableResponse();
    const parsed = pluginAuthoringRequestSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return context.json(
        { error: { code: "VALIDATION_ERROR", message: "Invalid request" } },
        400,
      );
    }
    const actor = actorFromContext(context);
    const pluginAuthoring = createPluginAuthoringService(
      dependencies.configuration,
      pluginAuthoringDependencies(app, context),
    );
    const runAbort = new AbortController();
    const runSignal = context.req.raw.signal
      ? AbortSignal.any([context.req.raw.signal, runAbort.signal])
      : runAbort.signal;
    // Resolve authentication, configuration, and collection metadata before
    // the first byte so those failures keep regular JSON error responses.
    let prepared;
    try {
      prepared = await pluginAuthoring.prepareStream({
        ...parsed.data,
        principalId: actor.principal.id,
        isPlatformAdministrator: actor.globalRoles.includes("platform_admin"),
        signal: runSignal,
      });
    } catch (error) {
      if (error instanceof PluginAuthoringError) {
        return context.json(
          {
            error: {
              code: error.code,
              message: error.message,
              ...(error.details ? { details: error.details } : {}),
            },
          },
          error.status,
        );
      }
      if (error instanceof AssistantConfigurationUnavailableError)
        return unavailableResponse();
      throw error;
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = async (event: unknown) => {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
            );
          } catch {
            // The reader went away; the aborted run below ends the loop.
          }
        };
        try {
          await pluginAuthoring.runStream(prepared, send);
        } catch {
          await send({
            type: "error",
            code: "PLUGIN_AUTHORING_UNAVAILABLE",
            message: "AI plugin authoring is temporarily unavailable.",
          });
        } finally {
          try {
            controller.close();
          } catch {
            // Already closed by cancellation.
          }
        }
      },
      cancel() {
        try {
          runAbort.abort();
        } catch {
          // Best effort; the request signal still bounds the run.
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  });
  app.get("/api/assistant/threads", async (context) => {
    if (!dependencies?.db) return unavailableResponse();
    const actor = actorFromContext(context);
    const repo = new AssistantThreadRepository(dependencies.db);
    const kind = context.req.query("contextKind");
    const id = context.req.query("contextId");
    if (
      (kind && !id) ||
      (!kind && id) ||
      (kind && !["recording", "session"].includes(kind))
    )
      return context.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid context filter",
          },
        },
        400,
      );
    let matching: Awaited<ReturnType<typeof repo.findSummaryByContext>> = null;
    if (kind && id) {
      if (!dependencies.loadThreadContext)
        return context.json(
          {
            error: {
              code: "ASSISTANT_UNAVAILABLE",
              message: "Conversation context is unavailable",
            },
          },
          503,
        );
      try {
        const source = await dependencies.loadThreadContext(
          actor,
          context.req.raw,
          {
            kind: kind as "recording" | "session",
            id,
            title: "Context lookup",
          },
        );
        matching = await repo.findSummaryByContext(
          actor.principal.id,
          kind as "recording" | "session",
          id,
          source.tenantId,
        );
      } catch (error) {
        if (error instanceof CompanionError)
          return context.json(
            { error: { code: error.code, message: error.message } },
            error.status,
          );
        throw error;
      }
    }
    const threads =
      kind && id
        ? matching
          ? [matching]
          : []
        : await repo.listSummaries(actor.principal.id);
    return context.json({ threads });
  });

  app.get("/api/assistant/threads/:id", async (context) => {
    if (!dependencies?.db) return unavailableResponse();
    const actor = actorFromContext(context);
    const thread = await new AssistantThreadRepository(dependencies.db).get(
      actor.principal.id,
      context.req.param("id"),
    );
    return thread
      ? context.json(thread)
      : context.json(
          { error: { code: "NOT_FOUND", message: "Conversation not found" } },
          404,
        );
  });

  app.put("/api/assistant/threads/:id", async (context) => {
    if (!dependencies?.db) return unavailableResponse();
    const actor = actorFromContext(context);
    const parsed = assistantThreadWriteSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success)
      return context.json(
        {
          error: { code: "VALIDATION_ERROR", message: "Invalid conversation" },
        },
        400,
      );
    try {
      let contextTenantId: number | null = null;
      if (parsed.data.context) {
        if (!dependencies.loadThreadContext)
          return context.json(
            {
              error: {
                code: "ASSISTANT_UNAVAILABLE",
                message: "Conversation context is unavailable",
              },
            },
            503,
          );
        try {
          const resolved = await dependencies.loadThreadContext(
            actor,
            context.req.raw,
            parsed.data.context,
          );
          contextTenantId = resolved.tenantId;
        } catch (error) {
          if (error instanceof CompanionError)
            return context.json(
              { error: { code: error.code, message: error.message } },
              error.status,
            );
          throw error;
        }
      }
      const thread = await new AssistantThreadRepository(dependencies.db).save(
        actor.principal.id,
        context.req.param("id"),
        parsed.data,
        contextTenantId,
      );
      return context.json(thread);
    } catch (error) {
      if (error instanceof AssistantThreadConflictError)
        return context.json(
          { error: { code: "REVISION_CONFLICT", message: error.message } },
          409,
        );
      if (error instanceof RangeError)
        return context.json(
          { error: { code: "THREAD_TOO_LARGE", message: error.message } },
          413,
        );
      if (error instanceof TypeError)
        return context.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "Invalid conversation identifier",
            },
          },
          400,
        );
      throw error;
    }
  });

  app.delete("/api/assistant/threads/:id", async (context) => {
    if (!dependencies?.db) return unavailableResponse();
    const actor = actorFromContext(context);
    const expectedRevision = Number(context.req.query("expectedRevision"));
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
      return context.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "expectedRevision is required",
          },
        },
        400,
      );
    try {
      await new AssistantThreadRepository(dependencies.db).delete(
        actor.principal.id,
        context.req.param("id"),
        expectedRevision,
      );
      return context.body(null, 204);
    } catch (error) {
      if (error instanceof AssistantThreadConflictError)
        return context.json(
          { error: { code: "REVISION_CONFLICT", message: error.message } },
          409,
        );
      throw error;
    }
  });

  app.post("/api/assistant/chat", async (context) => {
    if (!service) return unavailableResponse();
    const parsed = chatRequestSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return context.json(
        { error: { code: "VALIDATION_ERROR", message: "Invalid request" } },
        400,
      );
    }

    const actor = actorFromContext(context);
    try {
      let trustedContext:
        | {
            kind: "recording" | "session";
            title: string;
            content: string;
          }
        | undefined;
      if (parsed.data.threadId) {
        if (!dependencies?.db)
          return context.json(
            {
              error: {
                code: "ASSISTANT_UNAVAILABLE",
                message: "Conversation storage is unavailable",
              },
            },
            503,
          );
        const thread = await new AssistantThreadRepository(dependencies.db).get(
          actor.principal.id,
          parsed.data.threadId,
        );
        if (!thread)
          return context.json(
            { error: { code: "NOT_FOUND", message: "Conversation not found" } },
            404,
          );
        if (thread.context) {
          if (!dependencies.loadThreadContext)
            return context.json(
              {
                error: {
                  code: "ASSISTANT_UNAVAILABLE",
                  message: "Conversation context is unavailable",
                },
              },
              503,
            );
          try {
            const resolved = await dependencies.loadThreadContext(
              actor,
              context.req.raw,
              thread.context,
            );
            if (resolved.tenantId !== thread.context.tenantId)
              return context.json(
                {
                  error: {
                    code: "CONTEXT_WORKSPACE_MISMATCH",
                    message:
                      "This conversation belongs to a different workspace.",
                  },
                },
                409,
              );
            trustedContext = {
              kind: resolved.kind,
              title: resolved.title,
              content: resolved.content,
            };
          } catch (error) {
            if (error instanceof CompanionError)
              return context.json(
                { error: { code: error.code, message: error.message } },
                error.status,
              );
            throw error;
          }
        }
      }
      return await service.chat({
        messages: parsed.data.messages,
        principalId: actor.principal.id,
        authorization: authorizationFor(context),
        employeeId: parsed.data.employeeId,
        employeeHandle: parsed.data.employeeHandle,
        inferEmployeeFromMentions: parsed.data.inferEmployeeFromMentions,
        responseMode: parsed.data.responseMode,
        model: parsed.data.model,
        trustedContext,
      });
    } catch (chatError) {
      console.error("[Assistant Chat Error]:", chatError);
      throw chatError;
    }
  });

  app.get("/api/assistant/actions/:id", async (context) => {
    if (!dependencies?.db) return unavailableResponse();
    const actor = actorFromContext(context);
    const status = await new PendingActionRepository(dependencies.db).status(
      context.req.param("id"),
      actor.principal.id,
    );
    return status
      ? context.json(status)
      : context.json({ state: "unavailable" }, 404);
  });

  app.post("/api/assistant/actions/:id/confirm", async (context) => {
    if (!service) return unavailableResponse();
    const actor = actorFromContext(context);
    const result = await service.confirmAction({
      actionId: context.req.param("id"),
      principalId: actor.principal.id,
      authorization: authorizationFor(context),
    });
    return context.json(result, result.state === "unavailable" ? 409 : 200);
  });

  app.post("/api/assistant/actions/:id/cancel", async (context) => {
    if (!service) return unavailableResponse();
    const actor = actorFromContext(context);
    const result = await service.cancelAction({
      actionId: context.req.param("id"),
      principalId: actor.principal.id,
    });
    return context.json(result, result.state === "unavailable" ? 409 : 200);
  });

  // --- Virtual Employees Routes ---

  app.get("/api/assistant/collections", async (context) => {
    if (!dependencies?.db) return unavailableResponse();
    const actor = actorFromContext(context);
    const agencyId = await employeeTenantScope(
      actor,
      dependencies.configuration,
    );

    const { results: rows } = await dependencies.db
      .prepare(
        `SELECT name, label, description, tenant_id FROM studio_objects
         WHERE tenant_id = ?
         ORDER BY label ASC, name ASC`,
      )
      .bind(`tenant:${agencyId ?? 0}`)
      .all<{
        name: string;
        label: string | null;
        description: string | null;
        tenant_id: string;
      }>();

    let disabled = new Set<string>();
    if (agencyId !== null) {
      try {
        disabled = await disabledSolutionObjects(
          dependencies.db,
          `tenant:${agencyId}`,
        );
      } catch {}
    }

    const uniqueMap = new Map<
      string,
      { name: string; label: string; description: string }
    >();
    for (const row of rows) {
      if (disabled.has(row.name)) continue;
      if (!uniqueMap.has(row.name)) {
        uniqueMap.set(row.name, {
          name: row.name,
          label: row.label && row.label.trim() ? row.label.trim() : row.name,
          description: row.description ?? "",
        });
      }
    }

    return context.json({ data: Array.from(uniqueMap.values()) });
  });

  app.get("/api/assistant/employees", async (context) => {
    if (!dependencies?.db) return unavailableResponse();
    const actor = actorFromContext(context);
    const agencyId = await employeeTenantScope(
      actor,
      dependencies.configuration,
    );

    const repo = new VirtualEmployeesRepository(dependencies.db);
    const employees = await repo.list(agencyId);
    return context.json({ data: employees });
  });

  app.post("/api/assistant/employees", async (context) => {
    if (!dependencies?.db) return unavailableResponse();
    const actor = actorFromContext(context);
    const body = await context.req.json().catch(() => undefined);
    const parsed = createEmployeeSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "Invalid input",
          },
        },
        400,
      );
    }

    const agencyId = await employeeTenantScope(
      actor,
      dependencies.configuration,
    );

    assertEmployeeModelAdministrator(actor, agencyId, parsed.data.model);
    const repo = new VirtualEmployeesRepository(dependencies.db);
    try {
      const created = await repo.create({
        ...parsed.data,
        agencyId: agencyId ?? null,
        createdBy: actor.principal.id,
      });
      return context.json({ data: created }, 201);
    } catch (error) {
      const msg = (error as Error).message;
      if (msg.includes("UNIQUE") || msg.includes("unique")) {
        return context.json(
          {
            error: {
              code: "HANDLE_ALREADY_EXISTS",
              message: `El identificador @${parsed.data.handle} ya está en uso.`,
            },
          },
          409,
        );
      }
      throw error;
    }
  });

  app.get("/api/assistant/employees/:id", async (context) => {
    if (!dependencies?.db) return unavailableResponse();
    const actor = actorFromContext(context);
    const agencyId = await employeeTenantScope(
      actor,
      dependencies.configuration,
    );

    const repo = new VirtualEmployeesRepository(dependencies.db);
    const employee = await repo.getById(context.req.param("id"), agencyId);
    if (!employee) {
      return context.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Empleado virtual no encontrado",
          },
        },
        404,
      );
    }
    return context.json({ data: employee });
  });

  app.patch("/api/assistant/employees/:id", async (context) => {
    if (!dependencies?.db) return unavailableResponse();
    const actor = actorFromContext(context);
    const agencyId = await employeeTenantScope(
      actor,
      dependencies.configuration,
    );

    const body = await context.req.json().catch(() => undefined);
    const parsed = updateEmployeeSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "Invalid input",
          },
        },
        400,
      );
    }

    assertEmployeeModelAdministrator(actor, agencyId, parsed.data.model, false);
    const repo = new VirtualEmployeesRepository(dependencies.db);
    const updated = await repo.update(
      context.req.param("id"),
      parsed.data,
      agencyId,
    );
    if (!updated) {
      return context.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Empleado virtual no encontrado",
          },
        },
        404,
      );
    }
    return context.json({ data: updated });
  });

  app.delete("/api/assistant/employees/:id", async (context) => {
    if (!dependencies?.db) return unavailableResponse();
    const actor = actorFromContext(context);
    const agencyId = await employeeTenantScope(
      actor,
      dependencies.configuration,
    );

    const repo = new VirtualEmployeesRepository(dependencies.db);
    const id = context.req.param("id");
    const existing = await repo.getById(id, agencyId);
    if (!existing) {
      return context.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Empleado virtual no encontrado",
          },
        },
        404,
      );
    }

    // Clean up RAG vectors for all files of this employee
    const ragEnv = dependencies.ragEnv ?? {
      DB: dependencies.db,
      DOCUMENTS: dependencies.documents,
    };
    if (existing.files) {
      for (const file of existing.files) {
        await deleteFileVectors(ragEnv, id, file.id);
        if (dependencies.documents && file.r2Key) {
          await dependencies.documents
            .delete(file.r2Key)
            .catch(() => undefined);
        }
      }
    }

    await repo.delete(id, agencyId);
    return context.json({ data: { success: true } });
  });

  // --- Virtual Employee Files & Cloudflare RAG ---

  app.post("/api/assistant/employees/:id/files", async (context) => {
    if (!dependencies?.db) return unavailableResponse();
    const actor = actorFromContext(context);
    const agencyId = await employeeTenantScope(
      actor,
      dependencies.configuration,
    );

    const repo = new VirtualEmployeesRepository(dependencies.db);
    const employeeId = context.req.param("id");
    const employee = await repo.getById(employeeId, agencyId);
    if (!employee) {
      return context.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Empleado virtual no encontrado",
          },
        },
        404,
      );
    }

    const reqContentType = context.req.header("content-type") ?? "";
    let filename = "";
    let fileType = "text/plain";
    let fileBuffer: ArrayBuffer;

    if (reqContentType.includes("multipart/form-data")) {
      const form = await context.req.formData();
      const file = form.get("file");
      if (!file || !(file instanceof File)) {
        return context.json(
          {
            error: { code: "VALIDATION_ERROR", message: "Archivo no provisto" },
          },
          400,
        );
      }
      filename = file.name;
      fileType = file.type || "application/octet-stream";
      fileBuffer = await file.arrayBuffer();
    } else {
      const json = await context.req.json().catch(() => undefined);
      if (
        !json ||
        typeof json.name !== "string" ||
        typeof json.content !== "string"
      ) {
        return context.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message:
                "Se requiere un objeto con { name, contentType, content }",
            },
          },
          400,
        );
      }
      filename = json.name;
      fileType = json.contentType || "text/plain";
      if (json.isBase64) {
        const binaryString = atob(json.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        fileBuffer = bytes.buffer;
      } else {
        fileBuffer = new TextEncoder().encode(json.content).buffer;
      }
    }

    const fileId = crypto.randomUUID();
    const r2Key = `assistant/employees/${employeeId}/files/${fileId}-${filename}`;

    // 1. Upload to R2 if available
    if (dependencies.documents) {
      await dependencies.documents.put(r2Key, fileBuffer, {
        httpMetadata: { contentType: fileType },
      });
    }

    // 2. Extract text from file
    const text = extractTextFromFile(fileBuffer, fileType, filename);

    // 3. Register in D1
    const fileRecord = await repo.addFile({
      id: fileId,
      employeeId,
      name: filename,
      contentType: fileType,
      sizeBytes: fileBuffer.byteLength,
      r2Key,
      ragStatus: "indexed",
    });

    // 4. Index in Cloudflare RAG (Workers AI Embeddings + Vectorize, with D1 chunk persistence)
    const ragEnv = dependencies.ragEnv ?? {
      DB: dependencies.db,
      DOCUMENTS: dependencies.documents,
    };
    try {
      await indexDocument(ragEnv, employeeId, fileId, filename, text);
    } catch (error) {
      console.warn("[Cloudflare RAG] Error indexing file:", error);
      await repo.updateFileStatus(fileId, "failed");
      fileRecord.ragStatus = "failed";
    }

    return context.json({ data: fileRecord }, 201);
  });

  app.delete("/api/assistant/employees/:id/files/:fileId", async (context) => {
    if (!dependencies?.db) return unavailableResponse();
    const actor = actorFromContext(context);
    const agencyId = await employeeTenantScope(
      actor,
      dependencies.configuration,
    );

    const repo = new VirtualEmployeesRepository(dependencies.db);
    const employeeId = context.req.param("id");
    const fileId = context.req.param("fileId");

    const employee = await repo.getById(employeeId, agencyId);
    if (!employee) {
      return context.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Empleado virtual no encontrado",
          },
        },
        404,
      );
    }

    const file = await repo.getFile(fileId);
    if (!file || file.employeeId !== employeeId) {
      return context.json(
        { error: { code: "NOT_FOUND", message: "Archivo no encontrado" } },
        404,
      );
    }

    const ragEnv = dependencies.ragEnv ?? {
      DB: dependencies.db,
      DOCUMENTS: dependencies.documents,
    };
    await deleteFileVectors(ragEnv, employeeId, fileId);

    if (dependencies.documents && file.r2Key) {
      await dependencies.documents.delete(file.r2Key).catch(() => undefined);
    }

    await repo.removeFile(fileId);
    return context.json({ data: { success: true } });
  });
}

/** Keep only bounded schema labels and field names/types from the authorized route. */
export function summarizePluginAuthoringCollections(
  value: unknown[],
): PluginAuthoringCollection[] {
  const strings = (value: unknown, maximum: number) =>
    typeof value === "string" ? value.slice(0, maximum) : "";
  const summaries: PluginAuthoringCollection[] = [];
  let fieldCount = 0;
  for (const candidate of value.slice(0, 20)) {
    if (!candidate || typeof candidate !== "object") continue;
    const collection = candidate as Record<string, unknown>;
    const config = collection.config;
    if (!config || typeof config !== "object") continue;
    const fields = (config as Record<string, unknown>).fields;
    if (!fields || typeof fields !== "object" || Array.isArray(fields))
      continue;
    const safeFields: PluginAuthoringCollection["fields"] = [];
    for (const [name, rawField] of Object.entries(fields).slice(0, 40)) {
      if (fieldCount >= 400) break;
      if (!rawField || typeof rawField !== "object") continue;
      const field = rawField as Record<string, unknown>;
      if (typeof field.type !== "string") continue;
      safeFields.push({
        name: strings(name, 128),
        label: strings(field.label, 120),
        type: strings(field.type, 64),
      });
      fieldCount++;
    }
    summaries.push({
      name: strings(collection.name, 128),
      label: strings(collection.label, 160),
      fields: safeFields,
    });
  }
  return summaries;
}
