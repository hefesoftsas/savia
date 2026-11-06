import type { Hono } from "hono";
import type { ApiContext } from "./context";
import { handleScheduledEvent } from "./scheduled";
import {
  isSaviaBridgePlatformAdmin,
  isSaviaBridgeRequest,
} from "./savia-bridge";

export function registerLocalScheduledRoute(app: Hono<ApiContext>): void {
  app.post("/_local/scheduled", async (c) => {
    if (c.env.SAVIA_FLOWS_LOCAL_ONLY !== "true") {
      return c.json({ error: "Not found" }, 404);
    }
    if (!isSaviaBridgeRequest(c) || !isSaviaBridgePlatformAdmin(c)) {
      return c.json({ error: "Savia scheduler identity required" }, 403);
    }
    await handleScheduledEvent(
      {
        cron: "* * * * *",
        scheduledTime: Date.now(),
        type: "scheduled",
      } as ScheduledEvent,
      c.env,
      c.executionCtx as unknown as ExecutionContext,
    );
    return c.json({ ok: true });
  });
}
