import { Hono } from "hono";
import { jwtVerify } from "jose";
import type { ApiContext, Bindings } from "../context";
import {
  assertPausedMaintenance,
  type BackupCursor,
  type KvBackupPage,
  type SqlBackupPage,
  type WorkflowBackupCursor,
  type WorkflowBackupPage,
} from "../services/durable-backup";
import { policyStatus } from "../services/execution-policy";
import {
  getAgentByName,
  getWorkflowAgentByName,
} from "../durable-objects/agent-utils";

type Target = {
  kind:
    | "database"
    | "mailbox"
    | "workflow-agent"
    | "agent-runner"
    | "email-agent-runner";
  name: string;
  pages: { key: string; sha256: string }[];
  next?: BackupCursor | string | WorkflowBackupCursor;
  done?: boolean;
};
type Manifest = {
  version: 3;
  coverage: {
    version: 3;
    kinds: Target["kind"][];
    storage: Record<Target["kind"], ("sqlite" | "kv")[]>;
  };
  id: string;
  createdAt: string;
  executionEnabled: false;
  complete: boolean;
  objects: Target[];
};
const PREFIX = "__savia_backups/";
const COVERED_KINDS: Target["kind"][] = [
  "database",
  "mailbox",
  "workflow-agent",
  "agent-runner",
  "email-agent-runner",
];
const STORAGE_COVERAGE: Manifest["coverage"]["storage"] = {
  database: ["sqlite"],
  mailbox: ["sqlite"],
  "workflow-agent": ["sqlite", "kv"],
  "agent-runner": ["sqlite"],
  "email-agent-runner": ["kv"],
};
const keyFor = (id: string) => `${PREFIX}${id}/manifest.json`;
const digest = async (text: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  )
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
async function inventory(env: Bindings): Promise<Target[]> {
  const databases = await env.DB.prepare(
    "SELECT id FROM databases ORDER BY id",
  ).all<{ id: string }>();
  const organizations = await env.DB.prepare(
    "SELECT id FROM organizations ORDER BY id",
  ).all<{ id: string }>();
  const workflows = await env.DB.prepare(
    "SELECT id FROM workflows ORDER BY id",
  ).all<{ id: string }>();
  const registered = await env.DB.prepare(
    "SELECT kind,name FROM durable_object_registry ORDER BY kind,name",
  ).all<{
    kind: "workflow-agent" | "agent-runner" | "email-agent-runner";
    name: string;
  }>();
  if (
    databases.results.length +
      organizations.results.length +
      workflows.results.length +
      registered.results.length >
    1000
  )
    throw new Error("Backup inventory exceeds preview limit");
  const targets: Target[] = [
    ...databases.results.map(({ id }) => ({
      kind: "database" as const,
      name: id,
      pages: [],
    })),
    ...organizations.results.map(({ id }) => ({
      kind: "mailbox" as const,
      name: `mailbox:${id}`,
      pages: [],
    })),
  ];
  const agents = new Map<string, Target>();
  for (const { id } of workflows.results)
    agents.set(`workflow-agent\0${id}`, {
      kind: "workflow-agent",
      name: id,
      pages: [],
    });
  for (const { kind, name } of registered.results)
    agents.set(`${kind}\0${name}`, { kind, name, pages: [] });
  targets.push(...agents.values());
  return targets;
}
function stubFor(env: Bindings, target: Target) {
  if (target.kind === "database")
    return env.DATABASE.get(env.DATABASE.idFromName(target.name));
  if (target.kind === "mailbox")
    return env.MAILBOX.get(env.MAILBOX.idFromName(target.name));
  if (target.kind === "workflow-agent")
    return getWorkflowAgentByName(env, target.name);
  if (target.kind === "agent-runner")
    return getAgentByName(env.AGENT_RUNNER, target.name);
  return env.EMAIL_AGENT_RUNNER.get(
    env.EMAIL_AGENT_RUNNER.idFromName(target.name),
  );
}
async function backupPage(stub: any, target: Target) {
  if (target.kind === "email-agent-runner")
    return stub.backupPage(target.next as string | undefined);
  if (target.kind === "workflow-agent")
    return stub.backupPage(target.next as WorkflowBackupCursor | undefined);
  return stub.backupPage(target.next as BackupCursor | undefined);
}
export const saviaMaintenanceRoutes = new Hono<ApiContext>();
saviaMaintenanceRoutes.post("/", async (c) => {
  const secret = c.env.SAVIA_FLOWS_BRIDGE_SECRET;
  if (!secret || secret.length < 32)
    return c.json({ error: "Maintenance unavailable" }, 503);
  try {
    await jwtVerify(
      c.req.header("x-savia-flows-maintenance") ?? "",
      new TextEncoder().encode(secret),
      {
        algorithms: ["HS256"],
        issuer: "savia",
        audience: "savia-flows-maintenance",
        maxTokenAge: "60s",
      },
    );
  } catch {
    return c.json({ error: "Maintenance authorization required" }, 401);
  }
  try {
    assertPausedMaintenance(c.env);
    const activeRuns = (await policyStatus(c.env)).activeRuns;
    const body = await c.req.json<{
      action: string;
      snapshotId?: string;
      target?: number;
      page?: number;
    }>();
    if (body.action === "status")
      return c.json({ executionEnabled: false, maintenance: true, activeRuns });
    if (activeRuns !== 0)
      throw new Error("Active executions must drain before maintenance");
    const id = body.snapshotId;
    if (!id || !/^[A-Za-z0-9-]{1,80}$/.test(id))
      return c.json({ error: "Invalid snapshot identifier" }, 400);
    if (body.action === "start") {
      if (await c.env.RESSOURCES.head(keyFor(id)))
        return c.json({ error: "Snapshot already exists" }, 409);
      const objects = await inventory(c.env);
      for (const target of objects.filter(
        (entry) => entry.kind === "workflow-agent",
      ))
        await (
          await getWorkflowAgentByName(c.env, target.name)
        ).flushForBackup();
      const manifest: Manifest = {
        version: 3,
        coverage: {
          version: 3,
          kinds: COVERED_KINDS,
          storage: STORAGE_COVERAGE,
        },
        id,
        createdAt: new Date().toISOString(),
        executionEnabled: false,
        complete: false,
        objects,
      };
      await c.env.RESSOURCES.put(keyFor(id), JSON.stringify(manifest));
      return c.json(manifest);
    }
    const object = await c.env.RESSOURCES.get(keyFor(id));
    if (!object) return c.json({ error: "Snapshot not found" }, 404);
    const manifest = await object.json<Manifest>();
    if (
      manifest.version !== 3 ||
      manifest.coverage?.version !== 3 ||
      JSON.stringify(manifest.coverage.kinds) !==
        JSON.stringify(COVERED_KINDS) ||
      JSON.stringify(manifest.coverage.storage) !==
        JSON.stringify(STORAGE_COVERAGE) ||
      manifest.id !== id ||
      manifest.executionEnabled !== false
    )
      throw new Error("Invalid snapshot manifest");
    if (body.action === "inspect") return c.json(manifest);
    if (body.action === "finish") {
      if (manifest.objects.some((target) => !target.done))
        throw new Error("Snapshot is incomplete");
      const expected = await inventory(c.env);
      if (
        expected.length !== manifest.objects.length ||
        expected.some(
          (entry, index) =>
            entry.kind !== manifest.objects[index].kind ||
            entry.name !== manifest.objects[index].name,
        )
      )
        throw new Error("Snapshot inventory changed during export");
      manifest.complete = true;
      await c.env.RESSOURCES.put(keyFor(id), JSON.stringify(manifest));
      return c.json(manifest);
    }
    if (!Number.isSafeInteger(body.target) || body.target! < 0)
      throw new Error("Invalid snapshot target");
    const target = manifest.objects[body.target!];
    if (!target) throw new Error("Unknown snapshot target");
    const currentInventory = await inventory(c.env);
    if (
      !currentInventory.some(
        (entry) => entry.kind === target.kind && entry.name === target.name,
      )
    )
      throw new Error("Snapshot target does not match restored D1 inventory");
    const stub: any = await stubFor(c.env, target);
    if (body.action === "export") {
      if (manifest.complete || target.done)
        throw new Error("Snapshot target is already complete");
      const page = await backupPage(stub, target);
      const text = JSON.stringify(page);
      const key = `${PREFIX}${id}/${body.target}/${target.pages.length}.json`;
      await c.env.RESSOURCES.put(key, text);
      target.pages.push({ key, sha256: await digest(text) });
      target.done = page.next === null;
      if (page.next) target.next = page.next;
      else delete target.next;
      await c.env.RESSOURCES.put(keyFor(id), JSON.stringify(manifest));
      return c.json({ done: target.done, page: target.pages.length - 1 });
    }
    if (body.action === "restore") {
      if (
        !manifest.complete ||
        !Number.isSafeInteger(body.page) ||
        body.page! < 0
      )
        throw new Error("Complete snapshot and page required");
      const entry = target.pages[body.page!];
      if (
        !entry ||
        !entry.key.startsWith(`${PREFIX}${id}/${body.target}/`) ||
        entry.key.includes("..")
      )
        throw new Error("Invalid snapshot page key");
      const saved = await c.env.RESSOURCES.get(entry.key);
      if (!saved) throw new Error("Snapshot page missing");
      const text = await saved.text();
      if ((await digest(text)) !== entry.sha256)
        throw new Error("Snapshot page checksum mismatch");
      const page = JSON.parse(text) as
        SqlBackupPage | KvBackupPage | WorkflowBackupPage;
      if (target.kind === "workflow-agent") {
        const mixed = page as WorkflowBackupPage;
        if (mixed.storage === "sql" && mixed.segmentLast) {
          const first = await c.env.RESSOURCES.get(target.pages[0].key);
          if (!first) throw new Error("Snapshot schema missing");
          const schemaText = await first.text();
          if ((await digest(schemaText)) !== target.pages[0].sha256)
            throw new Error("Snapshot schema checksum mismatch");
          const firstSqlPage = JSON.parse(schemaText) as WorkflowBackupPage;
          if (firstSqlPage.storage !== "sql")
            throw new Error("Snapshot SQLite schema missing");
          mixed.data.schema = firstSqlPage.data.schema;
          mixed.data.sqliteSequence = firstSqlPage.data.sqliteSequence;
        }
      } else if (
        target.kind !== "email-agent-runner" &&
        body.page !== 0 &&
        body.page === target.pages.length - 1
      ) {
        const first = await c.env.RESSOURCES.get(target.pages[0].key);
        if (!first) throw new Error("Snapshot schema missing");
        const schemaText = await first.text();
        if ((await digest(schemaText)) !== target.pages[0].sha256)
          throw new Error("Snapshot schema checksum mismatch");
        (page as SqlBackupPage).schema = (
          JSON.parse(schemaText) as SqlBackupPage
        ).schema;
        (page as SqlBackupPage).sqliteSequence = (
          JSON.parse(schemaText) as SqlBackupPage
        ).sqliteSequence;
      }
      const checkpoint = {
        snapshotId: id,
        page: body.page!,
        sha256: entry.sha256,
      };
      if (target.kind === "workflow-agent")
        await stub.restoreBackupPage(page as WorkflowBackupPage, checkpoint);
      else if (target.kind === "email-agent-runner")
        await stub.restoreBackupPage(
          page as KvBackupPage,
          body.page === 0,
          body.page === target.pages.length - 1,
          checkpoint,
        );
      else
        await stub.restoreBackupPage(
          page as SqlBackupPage,
          body.page === 0,
          body.page === target.pages.length - 1,
          checkpoint,
        );
      return c.json({ restored: true });
    }
    return c.json({ error: "Unknown maintenance action" }, 400);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Maintenance failed" },
      409,
    );
  }
});
