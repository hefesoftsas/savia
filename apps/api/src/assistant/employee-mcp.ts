import type { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";
import { actorFromContext } from "../auth/middleware";
import type { AssistantService } from "./contracts";
import type { AssistantRouteDependencies } from "./routes";
import { VirtualEmployeesRepository } from "./virtual-employees";

const invocation = z.object({
  message: z.string().trim().min(1).max(12000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(12000),
      }),
    )
    .max(20)
    .default([]),
});

type EmployeeResult = {
  text: string;
  pendingActions: Record<string, unknown>[];
};

/** Consume the existing UI stream without leaking prompts, reasoning or arbitrary tool output. */
export async function consumeEmployeeStream(
  response: Response,
): Promise<EmployeeResult> {
  if (
    !response.ok ||
    !response.body ||
    !response.headers.get("content-type")?.includes("text/event-stream")
  )
    throw new Error("Employee response failed");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const result: EmployeeResult = { text: "", pendingActions: [] };
  let buffer = "",
    bytes = 0,
    finished = false,
    timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 90000);
  function line(value: string) {
    if (!value.startsWith("data:")) return;
    const data = value.slice(5).trim();
    if (data === "[DONE]") return;
    const event = JSON.parse(data) as Record<string, unknown>;
    if (["error", "abort", "tool-error"].includes(String(event.type)))
      throw new Error("Employee response failed");
    if (event.type === "finish") finished = true;
    if (event.type === "text-delta" && typeof event.delta === "string")
      result.text += event.delta;
    if (result.text.length > 64000)
      throw new Error("Employee response is too large");
    if (
      event.type === "tool-output-available" &&
      event.output &&
      typeof event.output === "object"
    ) {
      const output = event.output as Record<string, unknown>;
      if (
        output.requiresConfirmation === true &&
        typeof output.actionId === "string"
      ) {
        if (result.pendingActions.length >= 20)
          throw new Error("Too many pending actions");
        result.pendingActions.push(
          Object.fromEntries(
            [
              "actionId",
              "domain",
              "command",
              "input",
              "expiresAt",
              "requiresConfirmation",
            ].map((key) => [key, output[key]]),
          ),
        );
      }
    }
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (timedOut) throw new Error("Employee response timed out");
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1024 * 1024)
        throw new Error("Employee response is too large");
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        line(buffer.slice(0, index).replace(/\r$/, ""));
        buffer = buffer.slice(index + 1);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) line(buffer.trim());
    if (!finished) throw new Error("Employee response is incomplete");
    return result;
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function registerEmployeeMcpRoutes(
  app: OpenAPIHono,
  service: AssistantService | undefined,
  dependencies: AssistantRouteDependencies | undefined,
) {
  app.get("/api/assistant/mcp/employees", async (context) => {
    if (!dependencies?.db)
      return context.json({ error: "Employees unavailable" }, 503);
    const actor = actorFromContext(context);
    const agencyId = await dependencies.configuration?.activeAgencyFor(
      actor.principal.id,
    );
    const employees = await new VirtualEmployeesRepository(
      dependencies.db,
    ).list(agencyId);
    return context.json({
      data: employees
        .filter((employee) => employee.status === "active")
        .map(({ id, name, handle, position, greeting }) => ({
          id,
          name,
          handle,
          position,
          greeting,
        })),
    });
  });
  app.post("/api/assistant/mcp/employees/:id/invoke", async (context) => {
    if (!dependencies?.db || !service)
      return context.json({ error: "Employees unavailable" }, 503);
    const parsed = invocation.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success)
      return context.json({ error: "Invalid employee request" }, 400);
    const actor = actorFromContext(context);
    const agencyId = await dependencies.configuration?.activeAgencyFor(
      actor.principal.id,
    );
    const employees = await new VirtualEmployeesRepository(
      dependencies.db,
    ).list(agencyId);
    const employee = employees.find(
      (item) => item.id === context.req.param("id") && item.status === "active",
    );
    if (!employee) return context.json({ error: "Employee unavailable" }, 404);
    const authorization = context.req.header("authorization");
    if (!authorization?.startsWith("Bearer "))
      return context.json({ error: "Bearer token required" }, 401);
    const messages = [
      ...parsed.data.history,
      { role: "user", text: parsed.data.message },
    ].map(({ role, text }) => ({
      id: crypto.randomUUID(),
      role,
      parts: [{ type: "text", text }],
    }));
    const response = await service.chat({
      principalId: actor.principal.id,
      authorization,
      employeeId: employee.id,
      messages,
    });
    if (!response.ok) return response;
    try {
      return context.json({
        employee: {
          id: employee.id,
          name: employee.name,
          handle: employee.handle,
        },
        ...(await consumeEmployeeStream(response)),
      });
    } catch {
      return context.json(
        { error: "Employee response failed or was incomplete" },
        502,
      );
    }
  });
}
