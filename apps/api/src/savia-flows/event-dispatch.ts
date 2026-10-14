import type { OpenAPIHono } from "@hono/zod-openapi";
import { jwtVerify } from "jose";
import { CollectionEventOutbox } from "@savia/studio-server/collection-event-outbox";
import type { SaviaFlowsOptions } from "../routes/savia-flows";
import { signCollectionEvent } from "./protocol";

/** Dispatch after commit; a persisted lease lets a later process recover failures. */
export async function dispatchSaviaCollectionEvents(
  db: D1Database,
  options: SaviaFlowsOptions = {},
  now = Date.now(),
) {
  const secret = options.bridgeSecret?.trim();
  const report = { enabled: false, claimed: 0, delivered: 0, failed: 0 };
  if (
    !options.service ||
    !secret ||
    new TextEncoder().encode(secret).length < 32
  )
    return report;
  report.enabled = true;
  const outbox = new CollectionEventOutbox(db);
  const claimed = await outbox.claim(25, now);
  report.claimed = claimed.length;
  for (const { event, lease } of claimed) {
    try {
      // Only send a wake-up envelope. Flows retrieves and projects the snapshots
      // under the subscription owner's current access before evaluating a run.
      const body = JSON.stringify({
        ...event,
        before: null,
        after: null,
        changedFields: [],
      });
      const token = await signCollectionEvent(
        body,
        event.tenant,
        event.id,
        secret,
      );
      const response = await options.service.fetch(
        new Request(
          "https://savia-flows.internal/internal/savia/collection-events",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-savia-flows-event": token,
            },
            body,
          },
        ),
      );
      await response.text();
      if (!response.ok)
        throw new Error(`Flows event admission returned ${response.status}`);
      await outbox.complete(event.id, lease, now);
      report.delivered++;
    } catch (error) {
      await outbox.retry(
        event.id,
        lease,
        error instanceof Error ? error.message : "Event delivery failed",
        now,
      );
      report.failed++;
    }
  }
  return report;
}

export function installSaviaCollectionEventDelivery(
  app: OpenAPIHono,
  db: D1Database,
  options?: SaviaFlowsOptions,
) {
  if (options?.service && options.bridgeSecret) {
    app.use("*", async (c, next) => {
      await next();
      if (
        !["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method) ||
        c.res.status >= 400 ||
        !/^\/(?:v1\/(?:studio|dynamic-crm|tenants)\/|api\/public\/savia-flows\/collections$)/.test(
          c.req.path,
        )
      )
        return;
      const task = dispatchSaviaCollectionEvents(db, options).catch((error) =>
        console.error("Savia collection outbox dispatch failed", error),
      );
      try {
        c.executionCtx.waitUntil(task);
      } catch {
        await task;
      }
    });
  }
  app.post("/api/public/savia-flows/drain-events", async (c) => {
    const secret = options?.bridgeSecret?.trim();
    if (!secret || !options?.service)
      return c.json(
        { error: "Collection event delivery is unavailable." },
        503,
      );
    try {
      const token =
        c.req.header("authorization")?.replace(/^Bearer /, "") ?? "";
      const { payload } = await jwtVerify(
        token,
        new TextEncoder().encode(secret),
        {
          issuer: "savia-flows",
          audience: "savia-flows-outbox-drain",
          algorithms: ["HS256"],
          maxTokenAge: "10s",
        },
      );
      if (
        payload.sub !== "savia-local-outbox" ||
        !Number.isInteger(payload.iat) ||
        !Number.isInteger(payload.exp) ||
        payload.exp! - payload.iat! > 10
      )
        throw new Error("Invalid drain identity");
    } catch {
      return c.json({ error: "Invalid collection dispatcher authority." }, 401);
    }
    return c.json(await dispatchSaviaCollectionEvents(db, options));
  });
}
