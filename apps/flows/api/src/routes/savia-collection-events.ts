import type { SaviaCollectionEvent } from "@savia/studio-shared/savia-flows";
import { and, eq, lt, or } from "drizzle-orm";
import { Hono } from "hono";
import { jwtVerify } from "jose";
import type { ApiContext } from "../context";
import {
  createDatabase,
  getOrganizationBillingInfo,
  resolveOrganizationBillingOptions,
  saviaCollectionAdmissions,
  saviaCollectionTriggers,
  workflows,
} from "../db";
import {
  callSaviaCollections,
  SaviaCollectionHostError,
} from "../nodes/savia/collection-client";
import { WorkflowExecutor } from "../services/workflow-executor";
import { WorkflowStore } from "../stores/workflow-store";
import {
  matchesSaviaCollectionSubscription,
  type SaviaCollectionSubscription,
} from "./savia-collection-trigger";

export const saviaCollectionEventRoutes = new Hono<ApiContext>();

saviaCollectionEventRoutes.post("/", async (c) => {
  const secret = c.env.SAVIA_FLOWS_BRIDGE_SECRET;
  if (!secret || new TextEncoder().encode(secret).byteLength < 32) {
    return c.json({ error: "Savia collection events are unavailable" }, 503);
  }
  const token = c.req.header("x-savia-flows-event");
  if (!token) return c.json({ error: "Event signature required" }, 401);

  const rawBody = await readBoundedBody(c.req.raw, 1024 * 1024);
  if (rawBody === null)
    return c.json({ error: "Savia collection event is too large" }, 413);
  let event: SaviaCollectionEvent;
  try {
    event = await verifySaviaCollectionEvent(token, rawBody, secret);
  } catch {
    return c.json({ error: "Invalid Savia collection event signature" }, 401);
  }

  const db = createDatabase(c.env.DB);
  const subscriptions = await db
    .select({
      workflowId: saviaCollectionTriggers.workflowId,
      principalId: saviaCollectionTriggers.principalId,
      config: saviaCollectionTriggers.config,
      createdAt: saviaCollectionTriggers.createdAt,
      organizationId: saviaCollectionTriggers.organizationId,
      enabled: workflows.enabled,
      workflowTrigger: workflows.trigger,
    })
    .from(saviaCollectionTriggers)
    .innerJoin(workflows, eq(saviaCollectionTriggers.workflowId, workflows.id))
    .where(
      and(
        eq(saviaCollectionTriggers.organizationId, event.tenant),
        eq(saviaCollectionTriggers.active, true),
      ),
    );

  let accepted = 0;
  for (const subscription of subscriptions) {
    const executionId = `savia-${await shortHash(`${event.id}:${subscription.workflowId}`)}`;
    const now = new Date();
    await db
      .insert(saviaCollectionAdmissions)
      .values({
        eventId: event.id,
        workflowId: subscription.workflowId,
        executionId,
        status: "pending",
        updatedAt: now,
      })
      .onConflictDoNothing();
    const [admission] = await db
      .select()
      .from(saviaCollectionAdmissions)
      .where(
        and(
          eq(saviaCollectionAdmissions.eventId, event.id),
          eq(saviaCollectionAdmissions.workflowId, subscription.workflowId),
        ),
      )
      .limit(1);
    if (!admission)
      return c.json({ error: "Could not persist Savia event admission" }, 503);
    if (admission.status === "accepted" || admission.status === "skipped") {
      accepted += 1;
      continue;
    }
    const claimTime = new Date();
    const claimed = await db
      .update(saviaCollectionAdmissions)
      .set({ status: "processing", updatedAt: claimTime })
      .where(
        and(
          eq(saviaCollectionAdmissions.eventId, event.id),
          eq(saviaCollectionAdmissions.workflowId, subscription.workflowId),
          or(
            eq(saviaCollectionAdmissions.status, "pending"),
            and(
              eq(saviaCollectionAdmissions.status, "processing"),
              lt(
                saviaCollectionAdmissions.updatedAt,
                new Date(claimTime.getTime() - 60_000),
              ),
            ),
          ),
        ),
      )
      .returning({ executionId: saviaCollectionAdmissions.executionId });
    if (!claimed.length)
      return c.json(
        { error: "Savia event admission is already in progress" },
        503,
      );

    const skip = async () => {
      await db
        .update(saviaCollectionAdmissions)
        .set({ status: "skipped", updatedAt: new Date() })
        .where(
          and(
            eq(saviaCollectionAdmissions.eventId, event.id),
            eq(saviaCollectionAdmissions.workflowId, subscription.workflowId),
          ),
        );
      accepted += 1;
    };

    if (
      !subscription.enabled ||
      subscription.workflowTrigger !== "savia_collection_event"
    ) {
      await skip();
      continue;
    }
    const config = JSON.parse(
      subscription.config,
    ) as SaviaCollectionSubscription;
    if (!matchesSaviaCollectionSource(event, config)) {
      await skip();
      continue;
    }
    // Events already queued before enable are not retroactively admitted.
    if (Date.parse(event.timestamp) < subscription.createdAt.getTime()) {
      await skip();
      continue;
    }

    let projected: SaviaCollectionEvent;
    try {
      const authorized = await callSaviaCollections<{
        event: SaviaCollectionEvent;
        authorized: true;
      }>(
        c.env,
        { action: "authorize-event", eventId: event.id },
        {
          principalId: subscription.principalId,
          tenant: event.tenant,
          workflowId: subscription.workflowId,
        },
      );
      projected = authorized.event;
      if (!authorized.authorized || !projected) {
        await skip();
        continue;
      }
    } catch (error) {
      if (isTerminalSaviaAuthorizationSkip(error)) {
        await skip();
        continue;
      }
      console.error("Savia event authorization failed", error);
      await retryAdmission(db, event.id, subscription.workflowId);
      return c.json(
        { error: "Savia event authorization is temporarily unavailable" },
        503,
      );
    }
    if (
      !matchesSaviaCollectionSubscription(
        projected,
        config,
        event.tenant,
        subscription.workflowId,
      )
    ) {
      await skip();
      continue;
    }

    try {
      const billingInfo = await getOrganizationBillingInfo(db, event.tenant);
      if (!billingInfo)
        throw new Error("Organization billing info is unavailable");

      const store = new WorkflowStore(c.env);
      const saved = await store.getWithData(
        subscription.workflowId,
        event.tenant,
      );
      // A subscription or graph can change while authorization is in flight. Re-read
      // both immediately before admission, and use the current saved graph.
      const [current] = await db
        .select()
        .from(saviaCollectionTriggers)
        .where(
          and(
            eq(saviaCollectionTriggers.workflowId, subscription.workflowId),
            eq(saviaCollectionTriggers.active, true),
          ),
        )
        .limit(1);
      if (
        !current ||
        current.organizationId !== event.tenant ||
        Date.parse(event.timestamp) < current.createdAt.getTime() ||
        !saved?.enabled ||
        saved.data.trigger !== "savia_collection_event" ||
        !saved.data.nodes.some((node) => node.type === "savia-collection-event")
      ) {
        await skip();
        continue;
      }
      const currentConfig = JSON.parse(
        current.config,
      ) as SaviaCollectionSubscription;
      if (!matchesSaviaCollectionSource(event, currentConfig)) {
        await skip();
        continue;
      }
      if (
        !matchesSaviaCollectionSubscription(
          projected,
          currentConfig,
          event.tenant,
          subscription.workflowId,
        )
      ) {
        await skip();
        continue;
      }
      // Reauthorize under the latest configuring principal if the manager changed
      // the subscription while this event was being admitted.
      let currentProjected = projected;
      if (current.principalId !== subscription.principalId) {
        try {
          const refreshed = await callSaviaCollections<{
            event: SaviaCollectionEvent;
            authorized: true;
          }>(
            c.env,
            { action: "authorize-event", eventId: event.id },
            {
              principalId: current.principalId,
              tenant: event.tenant,
              workflowId: subscription.workflowId,
            },
          );
          currentProjected = refreshed.event;
        } catch (error) {
          if (isTerminalSaviaAuthorizationSkip(error)) {
            await skip();
            continue;
          }
          throw error;
        }
      }
      if (
        !matchesSaviaCollectionSubscription(
          currentProjected,
          currentConfig,
          event.tenant,
          subscription.workflowId,
        )
      ) {
        await skip();
        continue;
      }
      await WorkflowExecutor.execute({
        workflow: saved.data,
        userId: current.principalId,
        organizationId: event.tenant,
        ...resolveOrganizationBillingOptions(billingInfo),
        saviaCollectionEvent: currentProjected,
        executionId: admission.executionId,
        env: c.env,
      });
      await db
        .update(saviaCollectionAdmissions)
        .set({ status: "accepted", updatedAt: new Date() })
        .where(
          and(
            eq(saviaCollectionAdmissions.eventId, event.id),
            eq(saviaCollectionAdmissions.workflowId, subscription.workflowId),
          ),
        );
      accepted += 1;
    } catch (error) {
      console.error("Savia workflow admission failed", error);
      await retryAdmission(db, event.id, subscription.workflowId);
      return c.json(
        { error: "Savia workflow admission is temporarily unavailable" },
        503,
      );
    }
  }

  return c.json({ accepted });
});

export function isTerminalSaviaAuthorizationSkip(error: unknown): boolean {
  return (
    error instanceof SaviaCollectionHostError &&
    [403, 404, 422].includes(error.status)
  );
}

export function matchesSaviaCollectionSource(
  event: SaviaCollectionEvent,
  subscription: SaviaCollectionSubscription,
): boolean {
  return (
    event.collection === subscription.collection &&
    subscription.operations.includes(event.operation)
  );
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function retryAdmission(
  db: ReturnType<typeof createDatabase>,
  eventId: string,
  workflowId: string,
) {
  await db
    .update(saviaCollectionAdmissions)
    .set({ status: "pending", updatedAt: new Date() })
    .where(
      and(
        eq(saviaCollectionAdmissions.eventId, eventId),
        eq(saviaCollectionAdmissions.workflowId, workflowId),
        eq(saviaCollectionAdmissions.status, "processing"),
      ),
    );
}

async function shortHash(value: string): Promise<string> {
  return (await sha256(value)).slice(0, 40);
}

function isCollectionEvent(value: unknown): value is SaviaCollectionEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.id === "string" &&
    typeof event.tenant === "string" &&
    typeof event.collection === "string" &&
    typeof event.recordId === "string" &&
    typeof event.timestamp === "string" &&
    Array.isArray(event.changedFields) &&
    typeof event.operation === "string" &&
    ["created", "updated", "deleted", "restored"].includes(event.operation)
  );
}

export async function verifySaviaCollectionEvent(
  token: string,
  rawBody: string,
  secret: string,
): Promise<SaviaCollectionEvent> {
  const verified = await jwtVerify(token, new TextEncoder().encode(secret), {
    issuer: "savia",
    audience: "savia-flows-collection-events",
    algorithms: ["HS256"],
    maxTokenAge: "30s",
  });
  const nowSeconds = Math.floor(Date.now() / 1000);
  const issuedAt = verified.payload.iat;
  const expiresAt = verified.payload.exp;
  if (
    typeof issuedAt !== "number" ||
    typeof expiresAt !== "number" ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > 30 ||
    issuedAt > nowSeconds + 5
  ) {
    throw new Error("Invalid event token lifetime");
  }
  const digest = await sha256(rawBody);
  if (
    verified.payload.bodyDigest !== digest ||
    typeof verified.payload.tenant !== "string" ||
    typeof verified.payload.eventId !== "string"
  )
    throw new Error("Event token/body mismatch");
  const event = JSON.parse(rawBody) as SaviaCollectionEvent;
  if (
    event.id !== verified.payload.eventId ||
    event.tenant !== verified.payload.tenant
  ) {
    throw new Error("Event token/body mismatch");
  }
  if (
    !isCollectionEvent(event) ||
    !Number.isFinite(Date.parse(event.timestamp))
  )
    throw new Error("Invalid collection event");
  return event;
}

async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<string | null> {
  const statedLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(statedLength) && statedLength > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}
