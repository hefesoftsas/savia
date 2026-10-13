import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createBrowserSmoke } from "./browser-smoke.mjs";

const ORIGIN = "http://savia-flows-browser.fixture";
const TENANT = "tenant:101";

function maintenanceJwt(secret, now = Math.floor(Date.now() / 1000)) {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: "savia",
      aud: "savia-flows-maintenance",
      iat: now,
      exp: now + 60,
    }),
  ).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

test(
  "maintenance RPC snapshots all persisted Durable Object classes while paused and restores agent state",
  { timeout: 120_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "savia-flows-maintenance-"));
    let fixture;
    try {
      fixture = await createBrowserSmoke({ port: 0, directory });
      const secrets = fixture.secrets;
      const hostRequest = async (path, init = {}) =>
        fixture.runtime.dispatchFetch(ORIGIN + path, init);
      const databaseResponse = await hostRequest(
        `/v1/savia-flows/${TENANT}/databases?tenant=${TENANT}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "maintenance_backup" }),
        },
      );
      assert.equal(databaseResponse.status, 201);
      const database = await databaseResponse.json();
      const queryPath = `/v1/savia-flows/${TENANT}/databases/${database.id}/query?tenant=${TENANT}`;
      for (const sql of [
        "CREATE TABLE backup_records (id TEXT PRIMARY KEY, label TEXT, payload BLOB)",
        "INSERT INTO backup_records VALUES ('record-1', 'durable backup', X'0102FF')",
        "CREATE TABLE backup_sequence (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT)",
        "INSERT INTO backup_sequence(id,label) VALUES (11,'first'),(31,'second'),(87,'deleted-high-water')",
        "DELETE FROM backup_sequence WHERE id=87",
        "CREATE TABLE a_child(id TEXT PRIMARY KEY, parent_id TEXT REFERENCES z_parent(id))",
        "CREATE TABLE z_parent(id TEXT PRIMARY KEY)",
        "INSERT INTO z_parent(id) VALUES ('parent-1')",
        "INSERT INTO a_child VALUES ('child-1','parent-1')",
      ]) {
        const response = await hostRequest(queryPath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sql }),
        });
        assert.equal(response.status, 200);
      }

      let flowD1 = await fixture.runtime.getD1Database("DB", "savia-flows");
      await flowD1
        .prepare("INSERT OR IGNORE INTO organizations(id,name) VALUES(?,?)")
        .bind(TENANT, "Maintenance smoke tenant")
        .run();
      await flowD1
        .prepare(
          "INSERT OR REPLACE INTO workflows(id,name,organization_id) VALUES(?,?,?)",
        )
        .bind("workflow-maintenance-smoke", "Backup workflow", TENANT)
        .run();
      await flowD1
        .prepare(
          "INSERT OR IGNORE INTO durable_object_registry(kind,name) VALUES(?,?),(?,?)",
        )
        .bind(
          "agent-runner",
          "maintenance-agent-runner",
          "email-agent-runner",
          "maintenance-email-agent",
        )
        .run();
      const agentNamespace = await fixture.runtime.getDurableObjectNamespace(
        "AGENT_RUNNER",
        "savia-flows",
      );
      await agentNamespace
        .get(agentNamespace.idFromName("maintenance-agent-runner"))
        .fetch("https://agent/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "not json",
        });
      const emailAgentNamespace =
        await fixture.runtime.getDurableObjectNamespace(
          "EMAIL_AGENT_RUNNER",
          "savia-flows",
        );
      await emailAgentNamespace
        .get(emailAgentNamespace.idFromName("maintenance-email-agent"))
        .start({
          runId: "maintenance-email-agent",
          executionInstanceId: "missing-execution",
          nodeId: "email-node",
          provider: "workers-ai",
          model: "fixture",
          organizationId: TENANT,
          fromEmailId: "missing-email",
          interlocutors: [],
          objective: "fixture",
          maxRounds: 1,
          replyTimeoutMs: 1000,
        });
      const mailboxNamespace = await fixture.runtime.getDurableObjectNamespace(
        "MAILBOX",
        "savia-flows",
      );
      const mailbox = mailboxNamespace.get(
        mailboxNamespace.idFromName(`mailbox:${TENANT}`),
      );
      await mailbox.ingestInbound({
        emailId: "smoke-email",
        messageId: "smoke-message-1",
        fromEmail: "sender@example.test",
        fromName: "Local sender",
        toEmail: "inbox@example.test",
        subject: "Backup fixture",
        rfc822MessageId: "<smoke-message-1@example.test>",
        inReplyTo: null,
        references: [],
        referencesChain: null,
        snippet: "mailbox state for snapshot verification",
        hasHtml: false,
        hasText: true,
        rawR2Key: "local-smoke/mailbox-message.eml",
        attachments: [],
      });

      await fixture.dispose();
      fixture = await createBrowserSmoke({
        port: 0,
        directory,
        secrets,
        flowsBindings: {
          SAVIA_FLOWS_EXECUTION_ENABLED: "false",
          SAVIA_FLOWS_MAINTENANCE: "true",
        },
      });
      flowD1 = await fixture.runtime.getD1Database("DB", "savia-flows");

      const maintenancePath = "/api/public/savia-flows/maintenance";
      const sendMaintenance = async (
        body,
        token = maintenanceJwt(secrets.bridgeSecret),
      ) =>
        hostRequest(maintenancePath, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { "x-savia-flows-maintenance": token } : {}),
          },
          body: JSON.stringify(body),
        });
      const unsigned = await sendMaintenance({ action: "status" }, null);
      assert.equal(unsigned.status, 401);

      const readResponse = await hostRequest(
        `/v1/savia-flows/${TENANT}/databases?tenant=${TENANT}`,
      );
      assert.equal(readResponse.status, 503);
      const publicReadResponse = await hostRequest(
        "/api/public/savia-flows/http/unknown-preview-capability",
      );
      assert.equal(publicReadResponse.status, 503);

      const statusResponse = await sendMaintenance({ action: "status" });
      assert.equal(statusResponse.status, 200);
      assert.deepEqual(await statusResponse.json(), {
        executionEnabled: false,
        maintenance: true,
        activeRuns: 0,
      });

      const snapshotId = randomUUID();
      const startResponse = await sendMaintenance({
        action: "start",
        snapshotId,
      });
      assert.equal(startResponse.status, 200);
      const started = await startResponse.json();
      assert.equal(started.complete, false);
      assert.deepEqual(started.coverage, {
        version: 2,
        kinds: [
          "database",
          "mailbox",
          "workflow-agent",
          "agent-runner",
          "email-agent-runner",
        ],
      });
      const expectedTargets = [
        { kind: "database", name: database.id },
        { kind: "mailbox", name: `mailbox:${TENANT}` },
        { kind: "workflow-agent", name: "workflow-maintenance-smoke" },
        { kind: "agent-runner", name: "maintenance-agent-runner" },
        { kind: "email-agent-runner", name: "maintenance-email-agent" },
      ];
      for (const target of expectedTargets) {
        assert.ok(
          started.objects.some(
            (entry) => entry.kind === target.kind && entry.name === target.name,
          ),
          `missing snapshot target ${target.kind}:${target.name}`,
        );
      }

      for (let target = 0; target < started.objects.length; target++) {
        let page = 0;
        while (true) {
          assert.ok(page < 10_000, "snapshot export exceeded local page bound");
          const response = await sendMaintenance({
            action: "export",
            snapshotId,
            target,
            page,
          });
          assert.equal(response.status, 200);
          const progress = await response.json();
          assert.equal(progress.page, page);
          assert.equal(typeof progress.done, "boolean");
          if (progress.done) break;
          page++;
        }
      }

      const finishResponse = await sendMaintenance({
        action: "finish",
        snapshotId,
      });
      assert.equal(finishResponse.status, 200);
      const completed = await finishResponse.json();
      assert.equal(completed.complete, true);
      assert.ok(completed.objects.every((target) => target.pages.length >= 1));

      const resources = await fixture.runtime.getR2Bucket(
        "RESSOURCES",
        "savia-flows",
      );
      const pages = new Map();
      for (
        let targetIndex = 0;
        targetIndex < completed.objects.length;
        targetIndex++
      ) {
        const target = completed.objects[targetIndex];
        for (let pageIndex = 0; pageIndex < target.pages.length; pageIndex++) {
          const page = target.pages[pageIndex];
          assert.equal(
            page.key,
            `__savia_backups/${snapshotId}/${targetIndex}/${pageIndex}.json`,
          );
          const object = await resources.get(page.key);
          assert.ok(object, `missing R2 snapshot page ${page.key}`);
          const text = await object.text();
          assert.equal(
            createHash("sha256").update(text).digest("hex"),
            page.sha256,
          );
          pages.set(page.key, JSON.parse(text));
        }
      }
      const databaseTarget = completed.objects.find(
        (target) => target.kind === "database" && target.name === database.id,
      );
      assert.ok(
        databaseTarget.pages.some((page) => {
          const saved = pages.get(page.key);
          return (
            saved.table === "backup_records" &&
            saved.rows.some(
              (row) =>
                row[0] === "record-1" &&
                row[1] === "durable backup" &&
                row[2].blob.join(",") === "1,2,255",
            )
          );
        }),
      );
      assert.ok(
        databaseTarget.pages.some((page) =>
          pages
            .get(page.key)
            .sqliteSequence?.some(
              (entry) => entry.name === "backup_sequence" && entry.seq === 87,
            ),
        ),
      );
      const mailboxTarget = completed.objects.find(
        (target) =>
          target.kind === "mailbox" && target.name === `mailbox:${TENANT}`,
      );
      assert.ok(
        mailboxTarget.pages.some((page) => {
          const saved = pages.get(page.key);
          return (
            saved.table === "messages" &&
            saved.rows.some((row) => row.includes("smoke-message-1"))
          );
        }),
      );
      const agentTarget = completed.objects.find(
        (target) => target.kind === "agent-runner",
      );
      assert.ok(
        agentTarget.pages.some((page) =>
          pages
            .get(page.key)
            .schema?.some((entry) => entry.name === "agent_runs"),
        ),
      );
      const workflowAgentTarget = completed.objects.find(
        (target) => target.kind === "workflow-agent",
      );
      assert.ok(
        workflowAgentTarget.pages.some((page) =>
          pages
            .get(page.key)
            .schema?.some((entry) => entry.name === "cf_agents_state"),
        ),
      );
      const emailAgentTarget = completed.objects.find(
        (target) => target.kind === "email-agent-runner",
      );
      assert.ok(
        emailAgentTarget.pages.some((page) =>
          pages
            .get(page.key)
            .entries?.some(
              (entry) => entry.key === "status" && entry.value === "error",
            ),
        ),
      );

      // Restore the agent snapshots under fresh logical names. WorkflowAgent
      // and AgentRunner initialize Agent SDK SQL on wake; restore must replace
      // only bootstrap state and retain the snapshot rows.
      const restoreNames = {
        database: "restore-database",
        "workflow-agent": "workflow-restore-smoke",
        "agent-runner": "restore-agent-runner",
        "email-agent-runner": "restore-email-agent",
      };
      await flowD1
        .prepare(
          "INSERT OR REPLACE INTO databases(id,name,organization_id) VALUES(?,?,?)",
        )
        .bind(restoreNames.database, "Restore database", TENANT)
        .run();
      await flowD1
        .prepare(
          "INSERT OR REPLACE INTO workflows(id,name,organization_id) VALUES(?,?,?)",
        )
        .bind(restoreNames["workflow-agent"], "Restore workflow", TENANT)
        .run();
      await flowD1.batch([
        flowD1
          .prepare(
            "INSERT OR IGNORE INTO durable_object_registry(kind,name) VALUES(?,?)",
          )
          .bind("workflow-agent", restoreNames["workflow-agent"]),
        flowD1
          .prepare(
            "INSERT OR IGNORE INTO durable_object_registry(kind,name) VALUES(?,?)",
          )
          .bind("agent-runner", restoreNames["agent-runner"]),
        flowD1
          .prepare(
            "INSERT OR IGNORE INTO durable_object_registry(kind,name) VALUES(?,?)",
          )
          .bind("email-agent-runner", restoreNames["email-agent-runner"]),
      ]);
      const restoreManifestObject = await resources.get(
        `__savia_backups/${snapshotId}/manifest.json`,
      );
      const restoreManifest = await restoreManifestObject.json();
      for (const target of restoreManifest.objects) {
        if (target.kind === "database" && target.name === databaseTarget.name)
          target.name = restoreNames.database;
        else if (Object.hasOwn(restoreNames, target.kind))
          target.name = restoreNames[target.kind];
      }
      await resources.put(
        `__savia_backups/${snapshotId}/manifest.json`,
        JSON.stringify(restoreManifest),
      );
      for (
        let targetIndex = 0;
        targetIndex < restoreManifest.objects.length;
        targetIndex++
      ) {
        const target = restoreManifest.objects[targetIndex];
        if (!Object.hasOwn(restoreNames, target.kind)) continue;
        for (let page = 0; page < target.pages.length; page++) {
          const response = await sendMaintenance({
            action: "restore",
            snapshotId,
            target: targetIndex,
            page,
          });
          assert.equal(
            response.status,
            200,
            `${target.kind} restore page ${page}: ${await response.clone().text()}`,
          );
        }
      }
      const workflowNamespace = await fixture.runtime.getDurableObjectNamespace(
        "WORKFLOW_AGENT",
        "savia-flows",
      );
      const restoredWorkflowAgent = await workflowNamespace
        .get(workflowNamespace.idFromName(restoreNames["workflow-agent"]))
        .backupPage();
      assert.ok(
        restoredWorkflowAgent.schema?.some(
          (entry) => entry.name === "gen_runs",
        ),
      );
      const databaseNamespace = await fixture.runtime.getDurableObjectNamespace(
        "DATABASE",
        "savia-flows",
      );
      const restoredDatabaseStub = databaseNamespace.get(
        databaseNamespace.idFromName("restore-database"),
      );
      const restoredDatabasePages = [];
      let restoredCursor;
      do {
        const page = await restoredDatabaseStub.backupPage(restoredCursor);
        restoredDatabasePages.push(page);
        restoredCursor = page.next;
      } while (restoredCursor);
      assert.ok(
        restoredDatabasePages.some(
          (page) =>
            page.table === "backup_records" &&
            page.rows.some((row) => row.includes("record-1")),
        ),
      );
      assert.ok(
        restoredDatabasePages.some(
          (page) =>
            page.table === "a_child" &&
            page.rows.some((row) => row.includes("child-1")),
        ),
      );
      assert.ok(
        restoredDatabasePages.some(
          (page) =>
            page.table === "z_parent" &&
            page.rows.some((row) => row.includes("parent-1")),
        ),
      );
      const restoredDatabase = restoredDatabasePages[0];
      assert.ok(
        restoredDatabase.sqliteSequence?.some(
          (entry) => entry.name === "backup_sequence" && entry.seq === 87,
        ),
      );
      const agentRunnerNamespace =
        await fixture.runtime.getDurableObjectNamespace(
          "AGENT_RUNNER",
          "savia-flows",
        );
      const restoredAgentRunner = await agentRunnerNamespace
        .get(agentRunnerNamespace.idFromName(restoreNames["agent-runner"]))
        .backupPage();
      assert.ok(
        restoredAgentRunner.schema?.some(
          (entry) => entry.name === "agent_runs",
        ),
      );
      const emailRunnerNamespace =
        await fixture.runtime.getDurableObjectNamespace(
          "EMAIL_AGENT_RUNNER",
          "savia-flows",
        );
      const restoredEmailRunner = await emailRunnerNamespace
        .get(
          emailRunnerNamespace.idFromName(restoreNames["email-agent-runner"]),
        )
        .backupPage();
      assert.ok(
        restoredEmailRunner.entries.some(
          (entry) => entry.key === "status" && entry.value === "error",
        ),
      );

      // Reopen the same local Miniflare state with maintenance disabled and
      // execution still paused, then prove SQLite allocates beyond the deleted
      // AUTOINCREMENT high-water mark after restore.
      await fixture.dispose();
      fixture = await createBrowserSmoke({
        port: 0,
        directory,
        secrets,
        flowsBindings: {
          SAVIA_FLOWS_EXECUTION_ENABLED: "false",
          SAVIA_FLOWS_MAINTENANCE: "false",
        },
      });
      const sequenceResponse = await fixture.runtime.dispatchFetch(
        `${ORIGIN}/v1/savia-flows/${TENANT}/databases/${restoreNames.database}/query?tenant=${TENANT}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sql: "INSERT INTO backup_sequence(label) VALUES ('after restore') RETURNING id",
          }),
        },
      );
      assert.equal(
        sequenceResponse.status,
        200,
        await sequenceResponse.clone().text(),
      );
      const sequenceResult = await sequenceResponse.json();
      assert.equal(sequenceResult.results[0].id, 88);
    } finally {
      await fixture?.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
