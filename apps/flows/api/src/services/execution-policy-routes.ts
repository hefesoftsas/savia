import { Hono } from "hono";
import type { ApiContext } from "../context";
import {
  createExecutionPolicy,
  policyStatus,
  type ExecutionPolicyEnvironment,
} from "./execution-policy";

/** Signed internal RPC mounted by the Savia host at /internal/savia/execution-policy. */
export const executionPolicyRoutes = new Hono<ApiContext>();

executionPolicyRoutes.post("/", async (c) => {
  const secret = c.env.SAVIA_FLOWS_BRIDGE_SECRET;
  if (
    !secret ||
    new TextEncoder().encode(secret).byteLength < 32 ||
    c.req.header("x-savia-bridge-key") !== secret
  ) {
    return c.json({ error: "Execution policy bridge unavailable" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    const value: unknown = await c.req.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return c.json({ error: "Invalid execution policy request" }, 400);
    }
    body = value as Record<string, unknown>;
  } catch {
    return c.json({ error: "Invalid execution policy request" }, 400);
  }

  const env = c.env as typeof c.env & ExecutionPolicyEnvironment;
  try {
    switch (body.action) {
      case "admit": {
        if (
          typeof body.executionId !== "string" ||
          !body.executionId ||
          typeof body.organizationId !== "string" ||
          !body.organizationId ||
          typeof body.workflowId !== "string" ||
          !body.workflowId ||
          !Number.isInteger(body.nodeCount) ||
          (body.nodeCount as number) < 0
        ) {
          return c.json({ error: "Invalid execution admission" }, 400);
        }
        const result = await createExecutionPolicy(env).admit({
          executionId: body.executionId,
          organizationId: body.organizationId,
          workflowId: body.workflowId,
          nodeCount: body.nodeCount as number,
        });
        return c.json(result, result.allowed ? 200 : 429);
      }
      case "step": {
        if (typeof body.executionId !== "string" || !body.executionId) {
          return c.json({ error: "Invalid execution step request" }, 400);
        }
        await createExecutionPolicy(env).consumeStep(body.executionId);
        return c.json({ allowed: true });
      }
      case "release": {
        if (
          typeof body.executionId !== "string" ||
          !body.executionId ||
          typeof body.terminal !== "boolean"
        ) {
          return c.json({ error: "Invalid execution release request" }, 400);
        }
        await createExecutionPolicy(env).release(
          body.executionId,
          body.terminal,
        );
        return c.json({ ok: true });
      }
      case "status":
        return c.json(await policyStatus(env));
      default:
        return c.json({ error: "Unknown execution policy action" }, 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Execution policy request failed", message);
    return c.json({ error: message }, 503);
  }
});
