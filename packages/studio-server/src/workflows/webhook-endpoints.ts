import { HTTPException } from "hono/http-exception";
import { WorkflowRepository } from "./repository";
import type { WorkflowAuthorization } from "./runtime";
import { guard, transaction } from "../services";
import { fail } from "../context";
import type { WorkflowDefinition } from "@savia/studio-shared/workflows";
export async function webhookHash(text: string) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
function secret() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
function equal(a: string, b: string) {
  let difference = a.length ^ b.length;
  for (let i = 0; i < 64; i++)
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}
export function canonicalWebhookJson(data: Record<string, unknown>): string {
  const canonical = (value: unknown, depth: number): unknown => {
    if (depth > 50) fail("JSON nesting exceeds 50 levels", 422);
    if (Array.isArray(value)) return value.map((v) => canonical(v, depth + 1));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((k) => [
            k,
            canonical((value as Record<string, unknown>)[k], depth + 1),
          ]),
      );
    return value;
  };
  return JSON.stringify(canonical(data, 0));
}
export async function readWebhookJson(
  request: Request,
): Promise<Record<string, unknown>> {
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") ?? "",
    )
  )
    fail("Expected application/json", 422);
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader)
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 32768) {
          await reader.cancel();
          fail("Webhook body exceeds 32 KiB", 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("Invalid JSON", 422);
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    fail("Expected a JSON object", 422);
  canonicalWebhookJson(data as Record<string, unknown>);
  return data as Record<string, unknown>;
}
export class WebhookEndpointRepository {
  constructor(
    readonly db: D1Database,
    readonly workspace: string,
  ) {}
  async metadata(workflowId: string) {
    await new WorkflowRepository(this.db, this.workspace).get(workflowId);
    return this.db
      .prepare(
        "SELECT id FROM workflow_webhook_endpoints WHERE workspace_id=? AND workflow_id=?",
      )
      .bind(this.workspace, workflowId)
      .first<{ id: string }>();
  }
  async ensure(workflowId: string): Promise<{ id: string; secret?: string }> {
    const existing = await this.metadata(workflowId);
    if (existing) return existing;
    const id = crypto.randomUUID(),
      token = secret();
    const result = await this.db
      .prepare(
        "INSERT INTO workflow_webhook_endpoints(workspace_id,id,workflow_id,secret_hash) VALUES (?,?,?,?) ON CONFLICT(workspace_id,workflow_id) DO NOTHING",
      )
      .bind(this.workspace, id, workflowId, await webhookHash(token))
      .run();
    return result.meta.changes
      ? { id, secret: token }
      : (await this.metadata(workflowId))!;
  }
  async rotate(workflowId: string) {
    const endpoint = await this.metadata(workflowId);
    if (!endpoint) fail("Endpoint not found", 404);
    const token = secret();
    await this.db
      .prepare(
        "UPDATE workflow_webhook_endpoints SET secret_hash=? WHERE workspace_id=? AND id=?",
      )
      .bind(await webhookHash(token), this.workspace, endpoint.id)
      .run();
    return { id: endpoint.id, secret: token };
  }
}
export async function acceptWorkflowWebhook(
  db: D1Database,
  input: {
    endpointId: string;
    secret: string;
    key: string;
    data: Record<string, unknown>;
  },
  authorize: WorkflowAuthorization,
) {
  if (!input.secret || input.secret.length > 256)
    fail("Endpoint not found", 404);
  const endpoint = await db
    .prepare("SELECT * FROM workflow_webhook_endpoints WHERE id=?")
    .bind(input.endpointId)
    .first<{
      id: string;
      workspace_id: string;
      workflow_id: string;
      secret_hash: string;
    }>();
  const digest = await webhookHash(input.secret);
  if (!equal(digest, endpoint?.secret_hash ?? "0".repeat(64)) || !endpoint)
    fail("Endpoint not found", 404);
  if (!/^[\x21-\x7e][\x20-\x7e]{0,149}$/.test(input.key))
    fail("Invalid idempotency key", 422);
  const encoded = canonicalWebhookJson(input.data);
  if (new TextEncoder().encode(encoded).length > 32768)
    fail("Webhook body exceeds 32 KiB", 413);
  const hash = await webhookHash(encoded);
  const receipt = async () => {
    const row = await db
      .prepare(
        "SELECT execution_id,payload_hash FROM workflow_webhook_receipts WHERE workspace_id=? AND endpoint_id=? AND event_key=?",
      )
      .bind(endpoint.workspace_id, endpoint.id, input.key)
      .first<{ execution_id: string; payload_hash: string }>();
    if (!row) return null;
    if (row.payload_hash !== hash)
      fail("Event key was used with different input", 409);
    return { executionId: row.execution_id, duplicate: true };
  };
  const existing = await receipt();
  if (existing) return existing;
  const row = await db
    .prepare(
      "SELECT w.enabled,w.published_version,v.definition,v.owner_id FROM workflows w LEFT JOIN workflow_versions v ON v.workspace_id=w.workspace_id AND v.id=w.published_version WHERE w.workspace_id=? AND w.id=?",
    )
    .bind(endpoint.workspace_id, endpoint.workflow_id)
    .first<{
      enabled: number;
      published_version: string;
      definition: string;
      owner_id: string;
    }>();
  if (!row?.enabled || !row.definition) fail("Workflow is not active", 409);
  const definition = JSON.parse(row.definition) as WorkflowDefinition;
  if (definition.trigger.type !== "webhook")
    fail("Workflow does not accept webhooks", 409);
  if (
    !(await authorize({
      workspace: endpoint.workspace_id,
      principalId: row.owner_id,
    }))
  )
    fail("Workflow permission revoked", 403);
  const run = crypto.randomUUID(),
    minute = Math.floor(Date.now() / 60000);
  const g = guard(
    db,
    "SELECT EXISTS(SELECT 1 FROM workflows w JOIN workflow_webhook_endpoints e ON e.workspace_id=w.workspace_id AND e.workflow_id=w.id WHERE e.id=? AND e.secret_hash=? AND w.enabled=1 AND w.published_version=?)",
    [endpoint.id, digest, row.published_version],
  );
  try {
    await transaction(db, [
      g.start,
      db
        .prepare(
          "INSERT INTO workflow_webhook_admissions(endpoint_id,minute,count) VALUES (?,?,1) ON CONFLICT(endpoint_id,minute) DO UPDATE SET count=count+1",
        )
        .bind(endpoint.id, minute),
      db
        .prepare(
          "INSERT INTO workflow_executions(workspace_id,id,workflow_id,version_id,owner_id,initiator_id,event_key,node_id,context) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          endpoint.workspace_id,
          run,
          endpoint.workflow_id,
          row.published_version,
          row.owner_id,
          `webhook:${endpoint.id}`,
          `webhook:${endpoint.id}:${input.key}`,
          definition.nodes[0].id,
          JSON.stringify({
            trigger: input.data,
            before: {},
            steps: {},
            system: {
              owner: row.owner_id,
              workspace: endpoint.workspace_id,
              webhook: endpoint.id,
            },
          }),
        ),
      db
        .prepare(
          "INSERT INTO workflow_webhook_receipts(workspace_id,endpoint_id,event_key,payload_hash,execution_id) VALUES (?,?,?,?,?)",
        )
        .bind(endpoint.workspace_id, endpoint.id, input.key, hash, run),
      db
        .prepare(
          "DELETE FROM workflow_webhook_admissions WHERE endpoint_id=? AND minute<?",
        )
        .bind(endpoint.id, minute),
      g.end,
    ]);
  } catch (error) {
    const duplicate = await receipt();
    if (duplicate) return duplicate;
    const quota = await db
      .prepare(
        "SELECT count FROM workflow_webhook_admissions WHERE endpoint_id=? AND minute=?",
      )
      .bind(endpoint.id, minute)
      .first<{ count: number }>();
    if (quota && quota.count >= 60)
      throw new HTTPException(429, {
        message: "Webhook admission limit reached",
      });
    throw error;
  }
  return { executionId: run, duplicate: false };
}
