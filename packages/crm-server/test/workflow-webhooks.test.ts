import { beforeAll, beforeEach, afterAll, it, expect, vi } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  db = platform.env.DB;
  for (const name of readdirSync("migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort())
    for (const sql of readFileSync(`migrations/${name}`, "utf8")
      .split(/;(?!(?:\s*END\b))/i)
      .filter((s) => s.trim()))
      await db.prepare(sql).run();
});
afterAll(async () => platform?.dispose());
beforeEach(async () => {
  await db
    .prepare(
      "UPDATE workflow_executions SET status='cancelled' WHERE status IN ('queued','running','waiting')",
    )
    .run();
});
it("installs isolated webhook storage", async () => {
  const rows = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'workflow_webhook_%'",
    )
    .all();
  expect(rows.results).toHaveLength(7);
});
import { WorkflowRepository } from "../src/workflows/repository";
import {
  WebhookEndpointRepository,
  acceptWorkflowWebhook,
  readWebhookJson,
} from "../src/workflows/webhook-endpoints";
const workspace = "domain:hooks";
async function incoming() {
  const repo = new WorkflowRepository(db, workspace);
  const flow = await repo.create(
    {
      name: "Incoming",
      definition: {
        trigger: { type: "webhook" },
        nodes: [
          {
            id: "data",
            type: "transform",
            values: { name: { ref: "trigger.name" } },
          },
        ],
      },
    },
    "owner",
  );
  await repo.publish(flow.id, flow.revision, "owner");
  const endpoints = new WebhookEndpointRepository(db, workspace);
  const endpoint = await endpoints.ensure(flow.id);
  const accept = (
    key = "event",
    data: Record<string, unknown> = { name: "Ada" },
    secret = endpoint.secret!,
  ) =>
    acceptWorkflowWebhook(
      db,
      { endpointId: endpoint.id, secret, key, data },
      async () => true,
    );
  return { repo, flow, endpoints, endpoint, accept };
}
it("deduplicates concurrent incoming events and rejects conflicting payloads", async () => {
  const f = await incoming();
  const results = await Promise.all([f.accept(), f.accept()]);
  expect(new Set(results.map((r) => r.executionId)).size).toBe(1);
  expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
  await expect(f.accept("event", { name: "Bob" })).rejects.toMatchObject({
    status: 409,
  });
  await expect(f.accept("new", {}, "invalid")).rejects.toMatchObject({
    status: 404,
  });
  await f.repo.setEnabled(f.flow.id, false);
  expect((await f.accept()).duplicate).toBe(true);
  await expect(f.accept("new")).rejects.toMatchObject({ status: 409 });
});
it("rotates credentials and isolates endpoints by workspace", async () => {
  const f = await incoming();
  await expect(
    new WebhookEndpointRepository(db, "other").rotate(f.flow.id),
  ).rejects.toMatchObject({ status: 404 });
  const rotated = await f.endpoints.rotate(f.flow.id);
  await expect(f.accept()).rejects.toMatchObject({ status: 404 });
  expect(
    (await f.accept("rotated", { name: "Ada" }, rotated.secret)).duplicate,
  ).toBe(false);
  const row = await db
    .prepare("SELECT * FROM workflow_webhook_endpoints WHERE id=?")
    .bind(f.endpoint.id)
    .first();
  expect(JSON.stringify(row)).not.toContain(rotated.secret);
});
it("canonicalizes objects but preserves array order and checks owner permission", async () => {
  const f = await incoming();
  await f.accept("nested", { name: "Ada", obj: { b: 2, a: 1 }, arr: [1, 2] });
  expect(
    (
      await f.accept("nested", {
        arr: [1, 2],
        obj: { a: 1, b: 2 },
        name: "Ada",
      })
    ).duplicate,
  ).toBe(true);
  await expect(
    f.accept("nested", { arr: [2, 1], obj: { a: 1, b: 2 }, name: "Ada" }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    acceptWorkflowWebhook(
      db,
      {
        endpointId: f.endpoint.id,
        secret: f.endpoint.secret!,
        key: "denied",
        data: {},
      },
      async () => false,
    ),
  ).rejects.toMatchObject({ status: 403 });
});
it("enforces durable quota without charging duplicates", async () => {
  const f = await incoming();
  const clock = vi.spyOn(Date, "now").mockReturnValue(1800000000000);
  try {
    for (let i = 0; i < 60; i++) await f.accept(String(i));
    await expect(f.accept("overflow")).rejects.toMatchObject({ status: 429 });
    expect((await f.accept("0")).duplicate).toBe(true);
  } finally {
    clock.mockRestore();
  }
}, 60000);
it("bounds raw streamed UTF-8 JSON and rejects invalid input", async () => {
  const req = (text: string) =>
    new Request("https://savia.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: text,
    });
  await expect(
    readWebhookJson(req(JSON.stringify({ x: "é".repeat(17000) }))),
  ).rejects.toMatchObject({ status: 413 });
  await expect(readWebhookJson(req("[]"))).rejects.toMatchObject({
    status: 422,
  });
  expect(await readWebhookJson(req('{"ok":true}'))).toEqual({ ok: true });
});
import { WebhookDestinationRepository } from "../src/workflows/webhook-destinations";
const dependencies = {
  encryptionKey: "test-key-for-workflows-at-least-32-characters",
};
it("pins destination revisions and rotates credentials without leaking them", async () => {
  const repo = new WebhookDestinationRepository(db, workspace, dependencies);
  const first = await repo.create({
    name: "Receiver",
    url: "https://hooks.hefesoft.com/one",
    authType: "bearer",
    secret: "private-token",
  });
  expect(JSON.stringify(first)).not.toContain("private-token");
  const second = await repo.update(first.id, 1, {
    name: "Receiver",
    url: "https://hooks.hefesoft.com/two",
    authType: "bearer",
  });
  expect(second.revision).toBe(2);
  expect((await repo.resolve(first.id, 1)).url).toContain("/one");
  await repo.rotate(first.id, "rotated-token");
  expect((await repo.resolve(first.id, 1)).secret).toBe("rotated-token");
  await expect(
    new WebhookDestinationRepository(db, "other", dependencies).resolve(
      first.id,
      1,
    ),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    repo.update(first.id, 1, {
      name: "Stale",
      url: "https://hooks.hefesoft.com/three",
      authType: "none",
    }),
  ).rejects.toMatchObject({ status: 409 });
  await repo.setEnabled(first.id, false);
  await expect(repo.resolve(first.id, 1)).rejects.toMatchObject({
    status: 409,
  });
});
it("rejects unsafe destinations and missing encryption keys", async () => {
  const repo = new WebhookDestinationRepository(db, workspace, dependencies);
  await expect(
    repo.create({ name: "Private", url: "http://127.0.0.1", authType: "none" }),
  ).rejects.toBeDefined();
  await expect(
    new WebhookDestinationRepository(db, workspace, {}).create({
      name: "Receiver",
      url: "https://hooks.hefesoft.com/one",
      authType: "bearer",
      secret: "token",
    }),
  ).rejects.toBeDefined();
});
import { processWorkflows } from "../src/workflows/runtime";
async function outgoing() {
  const destinations = new WebhookDestinationRepository(
    db,
    workspace,
    dependencies,
  );
  const destination = await destinations.create({
    name: "Delivery",
    url: "https://hooks.hefesoft.com/events",
    authType: "none",
  });
  const repo = new WorkflowRepository(db, workspace);
  const flow = await repo.create(
    {
      name: "Outgoing",
      definition: {
        trigger: { type: "manual" },
        nodes: [
          {
            id: "send",
            type: "webhook",
            destinationId: destination.id,
            destinationRevision: 1,
            values: { name: { ref: "trigger.name" } },
          },
        ],
      },
    },
    "owner",
  );
  await repo.publish(flow.id, flow.revision, "owner");
  const run = await repo.start(
    flow.id,
    { name: "Ada" },
    "owner",
    crypto.randomUUID(),
  );
  return { repo, run, destinations, destination };
}
function receiver(
  requests: { key: string | null; body: string }[],
  status: number,
): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).includes("cloudflare-dns.com"))
      return Response.json({
        Status: 0,
        Answer: [{ type: 1, data: "93.184.216.34" }],
      });
    requests.push({
      key: new Headers(init?.headers).get("idempotency-key"),
      body: String(init?.body),
    });
    return Response.json({ ok: status === 200 }, { status });
  }) as typeof fetch;
}
it("delivers with stable bytes and keys across retries and records history", async () => {
  const f = await outgoing(),
    requests: { key: string | null; body: string }[] = [];
  await processWorkflows(db, async () => true, {
    maxSteps: 1,
    webhooks: { ...dependencies, fetcher: receiver(requests, 503) },
  });
  expect((await f.repo.execution(f.run.id)).status).toBe("waiting");
  await db
    .prepare(
      "UPDATE workflow_executions SET wake_at=0 WHERE workspace_id=? AND id=?",
    )
    .bind(workspace, f.run.id)
    .run();
  await processWorkflows(db, async () => true, {
    maxSteps: 1,
    webhooks: { ...dependencies, fetcher: receiver(requests, 200) },
  });
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  const result = await f.repo.execution(f.run.id);
  expect(result.status).toBe("completed");
  expect(result.jobs[0].output).toMatchObject({ status: 200 });
  expect(result.deliveries).toHaveLength(2);
});
it("exhausts automatic attempts and preserves the key on manual retry", async () => {
  const f = await outgoing(),
    requests: { key: string | null; body: string }[] = [];
  for (let i = 0; i < 3; i++) {
    await db
      .prepare(
        "UPDATE workflow_executions SET wake_at=0 WHERE workspace_id=? AND id=?",
      )
      .bind(workspace, f.run.id)
      .run();
    await processWorkflows(db, async () => true, {
      maxSteps: 1,
      webhooks: { fetcher: receiver(requests, 503) },
    });
  }
  expect((await f.repo.execution(f.run.id)).status).toBe("failed");
  await f.repo.retry(f.run.id);
  await processWorkflows(db, async () => true, {
    maxSteps: 1,
    webhooks: { fetcher: receiver(requests, 200) },
  });
  expect(requests).toHaveLength(4);
  expect(new Set(requests.map((r) => r.key)).size).toBe(1);
  expect((await f.repo.execution(f.run.id)).status).toBe("completed");
});
it("does not advance a workflow cancelled while delivery is in flight", async () => {
  const f = await outgoing();
  const fetcher: typeof fetch = (async (
    url: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    if (String(url).includes("cloudflare-dns.com"))
      return Response.json({
        Status: 0,
        Answer: [{ type: 1, data: "93.184.216.34" }],
      });
    await f.repo.cancel(f.run.id);
    return Response.json({ ok: true });
  }) as typeof fetch;
  await processWorkflows(db, async () => true, {
    maxSteps: 1,
    webhooks: { fetcher },
  });
  expect((await f.repo.execution(f.run.id)).status).toBe("cancelled");
});
import { createCrmApp } from "../src/index";
it("protects endpoint and destination management with workflow permission", async () => {
  const f = await incoming();
  const app = createCrmApp(workspace, {
    principalId: "owner",
    authorizeWorkflow: async () => false,
  });
  const response = await app.request(
    `/api/workflows/${f.flow.id}/webhook`,
    { method: "POST" },
    { DB: db, POC_LOCAL: "1" } as any,
  );
  expect(response.status).toBe(403);
});
it("fences acceptance when credentials rotate during owner authorization", async () => {
  const f = await incoming();
  await expect(
    acceptWorkflowWebhook(
      db,
      {
        endpointId: f.endpoint.id,
        secret: f.endpoint.secret!,
        key: "race",
        data: {},
      },
      async () => {
        await f.endpoints.rotate(f.flow.id);
        return true;
      },
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(await f.repo.executions(f.flow.id)).toHaveLength(0);
});
it("fences acceptance when the workflow is disabled during authorization", async () => {
  const f = await incoming();
  await expect(
    acceptWorkflowWebhook(
      db,
      {
        endpointId: f.endpoint.id,
        secret: f.endpoint.secret!,
        key: "race",
        data: {},
      },
      async () => {
        await f.repo.setEnabled(f.flow.id, false);
        return true;
      },
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(await f.repo.executions(f.flow.id)).toHaveLength(0);
});
it("keeps published destination URL and blocks disabled destinations", async () => {
  const f = await outgoing();
  await f.destinations.update(f.destination.id, 1, {
    name: "Changed",
    url: "https://hooks.hefesoft.com/changed",
    authType: "none",
  });
  const urls: string[] = [];
  const fetcher: typeof fetch = (async (url: RequestInfo | URL) => {
    if (String(url).includes("cloudflare-dns.com"))
      return Response.json({
        Status: 0,
        Answer: [{ type: 1, data: "93.184.216.34" }],
      });
    urls.push(String(url));
    return Response.json({ ok: true });
  }) as typeof fetch;
  await processWorkflows(db, async () => true, {
    maxSteps: 1,
    webhooks: { fetcher },
  });
  expect(urls).toEqual(["https://hooks.hefesoft.com/events"]);
  const second = await outgoing();
  await second.destinations.setEnabled(second.destination.id, false);
  await processWorkflows(db, async () => true, {
    maxSteps: 1,
    webhooks: { fetcher },
  });
  expect(urls).toHaveLength(1);
  expect((await second.repo.execution(second.run.id)).status).toBe("failed");
});
it("recovers a lost delivery outcome using identical bytes and identity", async () => {
  const f = await outgoing(),
    requests: { key: string | null; body: string }[] = [];
  const fetcher: typeof fetch = (async (
    url: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    if (String(url).includes("cloudflare-dns.com"))
      return Response.json({
        Status: 0,
        Answer: [{ type: 1, data: "93.184.216.34" }],
      });
    requests.push({
      key: new Headers(init?.headers).get("idempotency-key"),
      body: String(init?.body),
    });
    await db
      .prepare(
        "UPDATE workflow_executions SET lease_token='lost',lease_until=0 WHERE workspace_id=? AND id=?",
      )
      .bind(workspace, f.run.id)
      .run();
    return Response.json({ accepted: true });
  }) as typeof fetch;
  await processWorkflows(db, async () => true, {
    maxSteps: 1,
    webhooks: { fetcher },
  });
  expect((await f.repo.execution(f.run.id)).status).toBe("running");
  await processWorkflows(db, async () => true, {
    maxSteps: 1,
    webhooks: { fetcher: receiver(requests, 200) },
  });
  expect(requests[1]).toEqual(requests[0]);
  expect((await f.repo.execution(f.run.id)).status).toBe("completed");
  const attempts = (await f.repo.execution(f.run.id)).deliveries;
  expect(attempts[0].error).toContain("unknown");
});
it("does not undo a credential rotation concurrent with a URL edit", async () => {
  const repo = new WebhookDestinationRepository(db, workspace, dependencies);
  const d = await repo.create({
    name: "Concurrent",
    url: "https://hooks.hefesoft.com/old",
    authType: "bearer",
    secret: "original-secret",
  });
  let intercept = true;
  const racingDb = new Proxy(db, {
    get(target, property) {
      if (property === "batch")
        return async (statements: D1PreparedStatement[]) => {
          if (intercept) {
            intercept = false;
            await repo.rotate(d.id, "fresh-secret");
          }
          return target.batch(statements);
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await new WebhookDestinationRepository(
    racingDb,
    workspace,
    dependencies,
  ).update(d.id, 1, {
    name: "Concurrent",
    url: "https://hooks.hefesoft.com/new",
    authType: "bearer",
  });
  expect((await repo.resolve(d.id, 1)).secret).toBe("fresh-secret");
  expect((await repo.resolve(d.id, 2)).secret).toBe("fresh-secret");
});
it("closes the last uncertain attempt when repeated lost outcomes exhaust the budget", async () => {
  const f = await outgoing();
  let sends = 0;
  const fetcher = (async (url: RequestInfo | URL) => {
    if (String(url).includes("cloudflare-dns.com"))
      return Response.json({
        Status: 0,
        Answer: [{ type: 1, data: "93.184.216.34" }],
      });
    sends++;
    await db
      .prepare(
        "UPDATE workflow_executions SET lease_token='lost',lease_until=0 WHERE workspace_id=? AND id=?",
      )
      .bind(workspace, f.run.id)
      .run();
    return Response.json({ accepted: true });
  }) as typeof fetch;
  for (let i = 0; i < 4; i++)
    await processWorkflows(db, async () => true, {
      maxSteps: 1,
      webhooks: { fetcher },
    });
  const result = await f.repo.execution(f.run.id);
  expect(sends).toBe(3);
  expect(result.status).toBe("failed");
  expect(result.deliveries).toHaveLength(3);
  expect(
    result.deliveries.every(
      (a) => a.finished_at !== null && String(a.error).includes("unknown"),
    ),
  ).toBe(true);
  expect(
    (
      await db
        .prepare(
          "SELECT state FROM workflow_webhook_deliveries WHERE workspace_id=? AND execution_id=?",
        )
        .bind(workspace, f.run.id)
        .first()
    )?.state,
  ).toBe("failed");
});
it("records a retryable DNS failure as a finished attempt and resumes delivery", async () => {
  const f = await outgoing();
  await processWorkflows(db, async () => true, {
    maxSteps: 1,
    webhooks: {
      fetcher: (async () =>
        new Response("dns unavailable", { status: 503 })) as typeof fetch,
    },
  });
  let result = await f.repo.execution(f.run.id);
  expect(result.status).toBe("waiting");
  expect(result.deliveries[0].finished_at).not.toBeNull();
  await db
    .prepare(
      "UPDATE workflow_executions SET wake_at=0 WHERE workspace_id=? AND id=?",
    )
    .bind(workspace, f.run.id)
    .run();
  await processWorkflows(db, async () => true, {
    maxSteps: 1,
    webhooks: { fetcher: receiver([], 200) },
  });
  result = await f.repo.execution(f.run.id);
  expect(result.status).toBe("completed");
  expect(result.deliveries).toHaveLength(2);
});
