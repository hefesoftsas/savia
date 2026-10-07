import { migrationStatements } from "./migration-statements";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import { maintainWorkflowHistory } from "../src/workflows/runtime";

let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
const workspace = "domain:retention";

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

describe("workflow history retention", () => {
  it("keeps the latest 100 terminal executions with their children", async () => {
    const workflow = `wf-${Date.now()}`;
    await db
      .prepare(
        "INSERT INTO workflows(workspace_id,id,name,definition,created_by) VALUES (?,?,?,?,?)",
      )
      .bind(
        workspace,
        workflow,
        "Retention",
        '{"trigger":{"type":"manual"},"nodes":[]}',
        "owner",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO workflow_versions(workspace_id,id,workflow_id,definition,owner_id,revision) VALUES (?,?,?,?,?,1)",
      )
      .bind(
        workspace,
        "v1",
        workflow,
        '{"trigger":{"type":"manual"},"nodes":[]}',
        "owner",
      )
      .run();
    for (let n = 0; n < 105; n++) {
      const id = `exec-${n.toString().padStart(3, "0")}`;
      await db
        .prepare(
          "INSERT INTO workflow_executions(workspace_id,id,workflow_id,version_id,owner_id,initiator_id,event_key,status,context,created_at) VALUES (?,?,?,?,?,?,?,?,?,datetime('now', ?))",
        )
        .bind(
          workspace,
          `${workflow}-${id}`,
          workflow,
          "v1",
          "owner",
          "owner",
          `key-${id}`,
          "completed",
          '{"steps":{}}',
          `-${105 - n} minutes`,
        )
        .run();
      await db
        .prepare(
          "INSERT INTO workflow_jobs(workspace_id,execution_id,node_id,sequence,type,input,output,attempts,invocation) VALUES (?,?,?,?,?,?,?,0,1)",
        )
        .bind(
          workspace,
          `${workflow}-${id}`,
          "done",
          0,
          "transform",
          "{}",
          "{}",
        )
        .run();
    }
    const report = await maintainWorkflowHistory(db);
    expect(report.executions).toBe(5);
    const remaining = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM workflow_executions WHERE workspace_id=? AND workflow_id=?",
      )
      .bind(workspace, workflow)
      .first<{ n: number }>();
    expect(remaining?.n).toBe(100);
    const orphanJobs = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM workflow_jobs WHERE workspace_id=? AND execution_id NOT IN (SELECT id FROM workflow_executions WHERE workspace_id=?)",
      )
      .bind(workspace, workspace)
      .first<{ n: number }>();
    expect(orphanJobs?.n).toBe(0);
  });

  it("prunes resolved inbox items and old events", async () => {
    const old = "2020-01-01 00:00:00";
    const workflow = `wf-inbox-${Date.now()}`;
    await db
      .prepare(
        "INSERT INTO workflows(workspace_id,id,name,definition,created_by) VALUES (?,?,?,?,?)",
      )
      .bind(
        workspace,
        workflow,
        "Inbox",
        '{"trigger":{"type":"manual"},"nodes":[]}',
        "owner",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO workflow_versions(workspace_id,id,workflow_id,definition,owner_id,revision) VALUES (?,?,?,?,?,1)",
      )
      .bind(
        workspace,
        `${workflow}-v1`,
        workflow,
        '{"trigger":{"type":"manual"},"nodes":[]}',
        "owner",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO workflow_executions(workspace_id,id,workflow_id,version_id,owner_id,initiator_id,event_key,status,context) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        workspace,
        `${workflow}-exec`,
        workflow,
        `${workflow}-v1`,
        "owner",
        "owner",
        "k",
        "completed",
        '{"steps":{}}',
      )
      .run();
    await db
      .prepare(
        "INSERT INTO workflow_tasks(workspace_id,id,execution_id,node_id,kind,title,assignee,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        workspace,
        `task-old-${Date.now()}`,
        `${workflow}-exec`,
        "node",
        "task",
        "Old",
        "user-1",
        "done",
        old,
      )
      .run();
    await db
      .prepare(
        "INSERT INTO workflow_approvals(workspace_id,id,execution_id,node_id,title,assignee,status,due_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        workspace,
        `appr-old-${Date.now()}`,
        `${workflow}-exec`,
        "node",
        "Old",
        "user-1",
        "decided",
        1,
        old,
      )
      .run();
    await db
      .prepare(
        "INSERT INTO workflow_events(workspace_id,collection,kind,before_state,after_state,created_at) VALUES (?,?,?,?,?,?)",
      )
      .bind(workspace, "requests", "created", "{}", "{}", old)
      .run();
    const report = await maintainWorkflowHistory(db);
    expect(report.inbox).toBeGreaterThanOrEqual(2);
    expect(report.events).toBeGreaterThanOrEqual(1);
  });
});
