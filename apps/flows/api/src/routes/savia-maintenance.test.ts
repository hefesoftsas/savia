import { env as workerEnv, runInDurableObject } from "cloudflare:test";
import { Hono } from "hono";
import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiContext, Bindings } from "../context";
import {
  exportWorkflowBackupPage,
  restoreWorkflowBackupPage,
  type WorkflowBackupCursor,
  type WorkflowBackupPage,
} from "../services/durable-backup";
import { saviaMaintenanceRoutes } from "./savia-maintenance";

vi.mock("../durable-objects/agent-utils", () => ({
  getWorkflowAgentByName: vi.fn(),
  getAgentByName: vi.fn(),
}));

import { getWorkflowAgentByName } from "../durable-objects/agent-utils";

const secret = "savia-flows-maintenance-route-test-secret-32-bytes";
const workerBindings = workerEnv as unknown as Bindings;
let workflowId = "";

const inventoryDb = {
  prepare(query: string) {
    return {
      bind() {
        return this;
      },
      async all() {
        if (query.includes("FROM workflows"))
          return { results: [{ id: workflowId }] };
        return { results: [] };
      },
      async first() {
        return null;
      },
    };
  },
} as unknown as D1Database;

const routeEnv = {
  ...workerBindings,
  DB: inventoryDb,
  SAVIA_FLOWS_BRIDGE_SECRET: secret,
  SAVIA_FLOWS_EXECUTION_ENABLED: "false",
  SAVIA_FLOWS_MAINTENANCE: "true",
  SAVIA_FLOWS_POLICY_GENERATION: "1",
  SAVIA_FLOWS_QUOTAS_ENABLED: "false",
  CLOUDFLARE_ENV: "test",
} as Bindings;

const app = new Hono<ApiContext>().route(
  "/internal/savia/maintenance",
  saviaMaintenanceRoutes,
);

async function token() {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("savia")
    .setAudience("savia-flows-maintenance")
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(new TextEncoder().encode(secret));
}

async function action(body: Record<string, unknown>) {
  return app.request(
    "/internal/savia/maintenance",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-savia-flows-maintenance": await token(),
      },
      body: JSON.stringify(body),
    },
    routeEnv,
  );
}

describe("Savia maintenance mixed WorkflowAgent snapshots", () => {
  beforeEach(() => {
    vi.mocked(getWorkflowAgentByName).mockReset();
  });

  it("restores SQL schema and sequence across global SQL/KV pages, then replays the final page", async () => {
    const suffix = crypto.randomUUID();
    workflowId = `maintenance-route-${suffix}`;
    const snapshotId = `maintenance-${suffix}`;
    const source = workerBindings.WORKFLOW_AGENT.get(
      workerBindings.WORKFLOW_AGENT.idFromName(workflowId),
    );
    const target = workerBindings.WORKFLOW_AGENT.get(
      workerBindings.WORKFLOW_AGENT.idFromName(`${workflowId}-restore`),
    );

    await runInDurableObject(source, async (_instance, state) => {
      state.storage.sql.exec(
        "CREATE TABLE route_records (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL)",
      );
      state.storage.sql.exec("CREATE TABLE route_audit (record_id INTEGER)");
      state.storage.sql.exec(
        "CREATE INDEX route_records_label_idx ON route_records(label)",
      );
      state.storage.sql.exec(
        "CREATE TRIGGER route_records_audit AFTER INSERT ON route_records BEGIN INSERT INTO route_audit VALUES (new.id); END",
      );
      for (let index = 1; index <= 260; index++)
        state.storage.sql.exec(
          "INSERT INTO route_records(id,label) VALUES (?,?)",
          index,
          `record-${index}`,
        );
      await state.storage.put("execbuf:preserved", {
        result: new Uint8Array([0, 127, 255]),
      });
      await state.storage.put("fform:settings", new Map([["enabled", true]]));
      for (let index = 0; index < 135; index++)
        await state.storage.put(
          `form:route:${index.toString().padStart(3, "0")}`,
          { index },
        );
    });

    let restoreTarget = false;
    vi.mocked(getWorkflowAgentByName).mockImplementation(async (_env, name) => {
      const stub = name === workflowId && restoreTarget ? target : source;
      return {
        flushForBackup: async () => undefined,
        backupPage: async (cursor?: WorkflowBackupCursor) =>
          runInDurableObject(stub, (_instance, state) =>
            exportWorkflowBackupPage(state.storage, cursor),
          ),
        restoreBackupPage: async (
          page: WorkflowBackupPage,
          checkpoint: { snapshotId: string; page: number; sha256: string },
        ) =>
          runInDurableObject(stub, (_instance, state) =>
            restoreWorkflowBackupPage(state.storage, page, checkpoint),
          ),
      } as never;
    });

    const pageKeys: string[] = [];
    try {
      const start = await action({ action: "start", snapshotId });
      expect(start.status).toBe(200);
      const started = (await start.json()) as {
        version: number;
        coverage: { storage: Record<string, string[]> };
      };
      expect(started.version).toBe(3);
      expect(started.coverage.storage["workflow-agent"]).toEqual([
        "sqlite",
        "kv",
      ]);

      let done = false;
      let pageIndex = 0;
      while (!done) {
        const response = await action({
          action: "export",
          snapshotId,
          target: 0,
        });
        expect(response.status).toBe(200);
        const result = (await response.json()) as {
          done: boolean;
          page: number;
        };
        expect(result.page).toBe(pageIndex++);
        done = result.done;
      }
      const finish = await action({ action: "finish", snapshotId });
      expect(finish.status).toBe(200);
      const completed = (await finish.json()) as {
        complete: boolean;
        objects: { pages: { key: string; sha256: string }[] }[];
      };
      expect(completed.complete).toBe(true);
      const pages = completed.objects[0].pages;
      pageKeys.push(...pages.map((page) => page.key));
      expect(pages.length).toBeGreaterThan(3);
      const envelopes = await Promise.all(
        pages.map(async ({ key }) => {
          const object = await workerBindings.RESSOURCES.get(key);
          if (!object) throw new Error(`Missing exported page ${key}`);
          return JSON.parse(await object.text()) as WorkflowBackupPage;
        }),
      );
      const sqlPages = envelopes.filter((page) => page.storage === "sql");
      const kvPages = envelopes.filter((page) => page.storage === "kv");
      expect(sqlPages.length).toBeGreaterThan(1);
      expect(kvPages.length).toBeGreaterThan(1);
      expect(kvPages.map((page) => page.segmentPage)).toEqual(
        kvPages.map((_page, index) => index),
      );
      expect(sqlPages.at(-1)?.next).toEqual({ storage: "kv", page: 0 });
      expect(kvPages.at(-1)?.next).toBeNull();

      restoreTarget = true;
      for (let index = 0; index < pages.length; index++) {
        const restored = await action({
          action: "restore",
          snapshotId,
          target: 0,
          page: index,
        });
        expect(restored.status).toBe(200);
      }
      const lastPageReplay = await action({
        action: "restore",
        snapshotId,
        target: 0,
        page: pages.length - 1,
      });
      expect(lastPageReplay.status).toBe(200);
      const firstSqlReplay = await action({
        action: "restore",
        snapshotId,
        target: 0,
        page: 0,
      });
      expect(firstSqlReplay.status).toBe(200);

      await runInDurableObject(target, async (_instance, state) => {
        const count = state.storage.sql
          .exec("SELECT COUNT(*) AS count FROM route_records")
          .one().count;
        expect(Number(count)).toBe(260);
        expect(
          state.storage.sql
            .exec(
              "SELECT name FROM sqlite_master WHERE type='index' AND name='route_records_label_idx'",
            )
            .toArray(),
        ).toHaveLength(1);
        state.storage.sql.exec(
          "INSERT INTO route_records(label) VALUES (?)",
          "after-restore",
        );
        expect(
          state.storage.sql
            .exec("SELECT id FROM route_records WHERE label='after-restore'")
            .one().id,
        ).toBe(261);
        expect(
          state.storage.sql
            .exec("SELECT COUNT(*) AS count FROM route_audit")
            .one().count,
        ).toBe(261);
        expect(await state.storage.get("execbuf:preserved")).toEqual({
          result: new Uint8Array([0, 127, 255]),
        });
        expect(await state.storage.get("fform:settings")).toEqual(
          new Map([["enabled", true]]),
        );
        expect(await state.storage.get("form:route:134")).toEqual({
          index: 134,
        });
      });
    } finally {
      if (pageKeys.length) await workerBindings.RESSOURCES.delete(pageKeys);
      await workerBindings.RESSOURCES.delete(
        `__savia_backups/${snapshotId}/manifest.json`,
      );
    }
  });
});
