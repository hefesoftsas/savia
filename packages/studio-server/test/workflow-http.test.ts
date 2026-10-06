import { migrationStatements } from "./migration-statements";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import { WorkflowRepository } from "../src/workflows/repository";
import { WebhookDestinationRepository } from "../src/workflows/webhook-destinations";
import { processWorkflows } from "../src/workflows/runtime";
import type { WorkflowDefinition } from "@savia/studio-shared/workflows";

let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
const workspace = "domain:http",
  owner = "user-http";
const dependencies = {
  encryptionKey: "test-key-for-http-requests-at-least-32-chars",
};
type SeenRequest = {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: string;
};
function apiMock(
  requests: SeenRequest[],
  status: number,
  body: unknown,
): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).includes("cloudflare-dns.com"))
      return Response.json({
        Status: 0,
        Answer: [{ type: 1, data: "93.184.216.34" }],
      });
    requests.push({
      url: String(url),
      method: init?.method,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? String(init?.body) : undefined,
    });
    return Response.json(body, { status });
  }) as typeof fetch;
}
async function published(definition: WorkflowDefinition) {
  const repo = new WorkflowRepository(db, workspace);
  const draft = await repo.create({ name: "HTTP flow", definition }, owner);
  await repo.publish(draft.id, draft.revision, owner);
  return { repo, id: draft.id };
}
const webhooks = (fetcher: typeof fetch) => ({ ...dependencies, fetcher });
async function tick(fetcher: typeof fetch, maxSteps = 20) {
  await processWorkflows(db, async () => true, {
    maxSteps,
    webhooks: webhooks(fetcher),
  });
}
async function wake(id: string) {
  await db
    .prepare(
      "UPDATE workflow_executions SET wake_at=0 WHERE workspace_id=? AND id=?",
    )
    .bind(workspace, id)
    .run();
}

beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  db = platform.env.DB;
  for (const name of readdirSync("migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    for (const sql of migrationStatements(
      readFileSync(`migrations/${name}`, "utf8"),
    ))
      await db.prepare(sql).run();
  }
});
afterAll(async () => platform?.dispose());
beforeEach(async () => {
  await db
    .prepare(
      "UPDATE workflow_executions SET status='cancelled' WHERE status IN ('queued','running','waiting')",
    )
    .run();
});

describe("generic HTTPS steps", () => {
  it("sends query parameters and records the parsed body", async () => {
    const requests: SeenRequest[] = [];
    const { repo, id } = await published({
      trigger: { type: "manual" },
      nodes: [
        {
          id: "call",
          type: "http",
          method: "GET",
          url: "https://api.example.com/v1/records",
          query: { limit: 2, search: { ref: "trigger.term" } },
          headers: { "X-Source": "savia" },
        },
      ],
    });
    const run = await repo.start(id, { term: "ada" }, owner, "http-get");
    await tick(apiMock(requests, 200, { items: [1, 2] }));
    const detail = await repo.execution(run.id);
    expect(detail.status).toBe("completed");
    expect(detail.jobs[0].output).toMatchObject({
      status: 200,
      body: { items: [1, 2] },
      truncated: false,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("limit=2");
    expect(requests[0].url).toContain("search=ada");
    expect(requests[0].headers["x-source"]).toBe("savia");
  });

  it("posts a JSON body mapping with trigger references", async () => {
    const requests: SeenRequest[] = [];
    const { repo, id } = await published({
      trigger: { type: "manual" },
      nodes: [
        {
          id: "call",
          type: "http",
          method: "POST",
          url: "https://api.example.com/v1/records",
          body: { name: { ref: "trigger.name" } },
        },
      ],
    });
    const run = await repo.start(id, { name: "Ada" }, owner, "http-post");
    await tick(apiMock(requests, 201, { created: true }));
    expect((await repo.execution(run.id)).status).toBe("completed");
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("POST");
    expect(JSON.parse(requests[0].body!)).toEqual({ name: "Ada" });
  });

  it("fails fast on client errors without consuming retries", async () => {
    const requests: SeenRequest[] = [];
    const { repo, id } = await published({
      trigger: { type: "manual" },
      nodes: [
        {
          id: "call",
          type: "http",
          method: "GET",
          url: "https://api.example.com/v1/missing",
        },
      ],
    });
    const run = await repo.start(id, {}, owner, "http-404");
    await tick(apiMock(requests, 404, { error: "gone" }));
    expect((await repo.execution(run.id)).status).toBe("failed");
    expect(requests).toHaveLength(1);
  });

  it("retries server errors with bounded attempts", async () => {
    const requests: SeenRequest[] = [];
    const { repo, id } = await published({
      trigger: { type: "manual" },
      nodes: [
        {
          id: "call",
          type: "http",
          method: "GET",
          url: "https://api.example.com/v1/flaky",
        },
      ],
    });
    const run = await repo.start(id, {}, owner, "http-500");
    const fetcher = apiMock(requests, 500, { error: "down" });
    await tick(fetcher);
    expect((await repo.execution(run.id)).status).toBe("queued");
    await wake(run.id);
    await tick(fetcher);
    expect((await repo.execution(run.id)).status).toBe("queued");
    await wake(run.id);
    await tick(fetcher);
    expect((await repo.execution(run.id)).status).toBe("failed");
    expect(requests).toHaveLength(3);
  });

  it("rejects non-public URLs before contacting them", async () => {
    const requests: SeenRequest[] = [];
    const { repo, id } = await published({
      trigger: { type: "manual" },
      nodes: [
        {
          id: "call",
          type: "http",
          method: "GET",
          url: { ref: "trigger.url" },
        },
      ],
    });
    const run = await repo.start(
      id,
      { url: "http://192.0.2.1/internal" },
      owner,
      "http-ssrf",
    );
    await tick(apiMock(requests, 200, {}));
    expect((await repo.execution(run.id)).status).toBe("failed");
    expect(requests).toHaveLength(0);
  });

  it("applies destination credentials and redacts them from history", async () => {
    const requests: SeenRequest[] = [];
    const destinations = new WebhookDestinationRepository(
      db,
      workspace,
      dependencies,
    );
    const destination = await destinations.create({
      name: "API",
      url: "https://api.example.com/v1",
      authType: "bearer",
      secret: "private-token",
    });
    const { repo, id } = await published({
      trigger: { type: "manual" },
      nodes: [
        {
          id: "call",
          type: "http",
          method: "GET",
          url: "https://api.example.com/v1/whoami",
          destinationId: destination.id,
          destinationRevision: 1,
        },
      ],
    });
    const run = await repo.start(id, {}, owner, "http-auth");
    await tick(apiMock(requests, 200, { token: "private-token" }));
    const detail = await repo.execution(run.id);
    expect(detail.status).toBe("completed");
    expect(requests[0].headers.authorization).toBe("Bearer private-token");
    expect(detail.jobs[0].output).toMatchObject({
      body: { token: "[redacted]" },
    });
    expect(JSON.stringify(detail.jobs)).not.toContain("private-token");
  });

  it("runs once per loop pass without delivery identity conflicts", async () => {
    const requests: SeenRequest[] = [];
    const { repo, id } = await published({
      trigger: { type: "manual" },
      nodes: [
        {
          id: "repeat",
          type: "loop",
          items: { ref: "trigger.tags" },
          body: "call",
          next: "done",
        },
        {
          id: "call",
          type: "http",
          method: "GET",
          url: {
            concat: [
              "https://api.example.com/v1/tags?id=",
              { ref: "steps.repeat.item.id" },
            ],
          },
        },
        { id: "done", type: "transform", values: { finished: true } },
      ],
    });
    const run = await repo.start(
      id,
      { tags: [{ id: "a" }, { id: "b" }] },
      owner,
      "http-loop",
    );
    await tick(apiMock(requests, 200, { ok: true }));
    await tick(apiMock(requests, 200, { ok: true }));
    const detail = await repo.execution(run.id);
    expect(detail.status).toBe("completed");
    expect(detail.jobs.map((job) => job.node_id)).toEqual([
      "repeat",
      "call",
      "repeat",
      "call",
      "done",
    ]);
    expect(requests.map((request) => request.url)).toEqual([
      "https://api.example.com/v1/tags?id=a",
      "https://api.example.com/v1/tags?id=b",
    ]);
  });
});
