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
import {
  extractTextFromFile,
  indexDocument,
  deleteFileVectors,
  type RagEnvironment,
} from "./rag";
import { disabledSolutionObjects } from "@savia/studio-server/solutions";

const chatRequestSchema = z.object({
  messages: z.array(z.unknown()).max(100),
  employeeId: z.string().optional(),
  employeeHandle: z.string().optional(),
});

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

export function registerAssistantRoutes(
  app: OpenAPIHono,
  service?: AssistantService,
  dependencies?: AssistantRouteDependencies,
): void {
  registerEmployeeMcpRoutes(app, service, dependencies);
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
      return await service.chat({
        messages: parsed.data.messages,
        principalId: actor.principal.id,
        authorization: authorizationFor(context),
        employeeId: parsed.data.employeeId,
        employeeHandle: parsed.data.employeeHandle,
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
    const agencyId = dependencies.configuration
      ? await dependencies.configuration.activeAgencyFor(actor.principal.id)
      : undefined;

    const isPlatform = actor.globalRoles.includes("platform_admin");

    let rows: Array<{
      name: string;
      label: string | null;
      description: string | null;
      tenant_id: string;
    }> = [];

    if (agencyId) {
      const { results } = await dependencies.db
        .prepare(
          `SELECT name, label, description, tenant_id FROM studio_objects
           WHERE tenant_id IN (?, 'domain:platform')
           ORDER BY CASE WHEN tenant_id = ? THEN 0 ELSE 1 END, label ASC, name ASC`,
        )
        .bind(`agency:${agencyId}`, `agency:${agencyId}`)
        .all<{
          name: string;
          label: string | null;
          description: string | null;
          tenant_id: string;
        }>();
      rows = results;
    } else if (isPlatform) {
      const { results } = await dependencies.db
        .prepare(
          `SELECT name, label, description, tenant_id FROM studio_objects
           ORDER BY label ASC, name ASC`,
        )
        .all<{
          name: string;
          label: string | null;
          description: string | null;
          tenant_id: string;
        }>();
      rows = results;
    } else {
      const tenantIds = actor.memberships
        .filter((m) => m.isActive && (m.tenantId ?? m.agencyId))
        .map((m) => `agency:${m.tenantId ?? m.agencyId}`);
      tenantIds.push("domain:platform");
      const placeholders = tenantIds.map(() => "?").join(",");
      const { results } = await dependencies.db
        .prepare(
          `SELECT name, label, description, tenant_id FROM studio_objects
           WHERE tenant_id IN (${placeholders})
           ORDER BY label ASC, name ASC`,
        )
        .bind(...tenantIds)
        .all<{
          name: string;
          label: string | null;
          description: string | null;
          tenant_id: string;
        }>();
      rows = results;
    }

    let disabled = new Set<string>();
    if (agencyId) {
      try {
        disabled = await disabledSolutionObjects(
          dependencies.db,
          `agency:${agencyId}`,
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
    const agencyId = dependencies.configuration
      ? await dependencies.configuration.activeAgencyFor(actor.principal.id)
      : undefined;

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

    const agencyId = dependencies.configuration
      ? await dependencies.configuration.activeAgencyFor(actor.principal.id)
      : undefined;

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
    const agencyId = dependencies.configuration
      ? await dependencies.configuration.activeAgencyFor(actor.principal.id)
      : undefined;

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
    const agencyId = dependencies.configuration
      ? await dependencies.configuration.activeAgencyFor(actor.principal.id)
      : undefined;

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
    const agencyId = dependencies.configuration
      ? await dependencies.configuration.activeAgencyFor(actor.principal.id)
      : undefined;

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
    const agencyId = dependencies.configuration
      ? await dependencies.configuration.activeAgencyFor(actor.principal.id)
      : undefined;

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
    const agencyId = dependencies.configuration
      ? await dependencies.configuration.activeAgencyFor(actor.principal.id)
      : undefined;

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
