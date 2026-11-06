import { Hono } from "hono";

import { jwtMiddleware } from "../auth";
import { ApiContext } from "../context";
import { getWorkflowAgentByName } from "../durable-objects/agent-utils";
import { WorkflowStore } from "../stores/workflow-store";
import { isSaviaBridgeRequest } from "../savia-bridge";

const wsRoutes = new Hono<ApiContext>();

// WebSocket endpoint for real-time workflow state synchronization
wsRoutes.get("/:workflowId", jwtMiddleware, async (c) => {
  const userId = c.var.jwtPayload?.sub;

  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const workflowId = c.req.param("workflowId")!;
  const organizationId = c.req.param("organizationId")!;
  const payload = c.get("jwtPayload");
  const payloadOrganizationId = payload?.organization?.id;
  const role = payload?.organization?.role;

  if (
    !organizationId ||
    c.get("organizationId") !== organizationId ||
    payloadOrganizationId !== organizationId
  ) {
    return c.json({ error: "Organization does not match editor session" }, 403);
  }
  if (!(["admin", "owner"] as string[]).includes(role ?? "")) {
    return c.json({ error: "Editor manager access required" }, 403);
  }

  const access = await new WorkflowStore(c.env).getWithUserAccess(
    workflowId,
    userId,
    organizationId,
  );
  if (!access) return c.json({ error: "Workflow not found" }, 404);

  // getAgentByName initializes the partyserver name before returning the stub
  const stub = await getWorkflowAgentByName(c.env, workflowId);

  // Forward the WS upgrade request with userId header. The protocol tag is
  // `set`, not appended, so a client cannot claim the generation protocol.
  const headers = new Headers(c.req.raw.headers);
  headers.set("X-Agent-Protocol", "editor");
  headers.set("X-User-Id", userId);
  headers.set("X-Organization-Id", organizationId);
  if (isSaviaBridgeRequest(c)) {
    const expiresAt = c.get("saviaBridgeExpiresAt");
    if (!expiresAt || expiresAt <= Math.floor(Date.now() / 1000)) {
      return c.json({ error: "Editor session expired" }, 401);
    }
    headers.set("X-Savia-Session-Expires-At", String(expiresAt));
  }
  const newReq = new Request(c.req.url, {
    method: c.req.method,
    headers,
    body: c.req.raw.body,
  });

  return stub.fetch(newReq);
});

export default wsRoutes;
