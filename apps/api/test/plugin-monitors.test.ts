import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "test.monitored-items",
  version: "1.0.0",
  label: "Monitored items",
  description: "Independent monitor contract fixture",
  requires: [],
  apiVersion: 1,
};
import store from "./fixtures/plugin-monitor-store.json";
import { runPluginMonitors } from "../src/studio/plugin-monitors";
import {
  upsertPrincipal,
  setPlatformAdministrator,
  grantMembership,
  findPrincipal,
  loadActor,
} from "../src/auth/identity-repository";
import {
  saveAccessRole,
  replaceAccessAssignments,
  loadAccessPolicy,
} from "../src/auth/access-repository";
import { McpAdapterError } from "../src/studio/mcp-adapter";
import { runScheduledNotifications } from "../src/notifications";
const db = env.DB,
  tenant = "tenant:8201",
  extensionId = manifest.id;
const now = Date.parse("2026-10-14T12:00:00Z");
let owner = "";
const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));
beforeAll(async () => {
  for (const [, sql] of migrations)
    for (const part of sql.split("--> statement-breakpoint")) {
      const s = part
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (s) await db.exec(s);
    }
  await db
    .prepare(
      "INSERT INTO tenants(id,id_slug,name,kind,is_active,created_at,updated_at) VALUES(8201,'monitor-test','Monitor test','commercial',1,'2026-10-14','2026-10-14')",
    )
    .run();
  owner = (
    await upsertPrincipal(db, {
      issuer: "monitor-test",
      subject: "owner",
      email: "monitor@example.test",
      displayName: "Monitor owner",
    })
  ).id;
  await setPlatformAdministrator(db, owner, true);
});
beforeEach(async () => {
  await setPlatformAdministrator(db, owner, true);
  await db.exec(
    "DELETE FROM studio_plugin_monitor_checks; DELETE FROM studio_plugin_monitor_cursor; DELETE FROM savia_flows_collection_event_outbox; DELETE FROM notification_deliveries; DELETE FROM notification_recipient_retries; DELETE FROM notification_events;",
  );
  await db
    .prepare("UPDATE identity_principal SET is_active=1 WHERE id=?")
    .bind(owner)
    .run();
  await db
    .prepare(
      "INSERT OR REPLACE INTO studio_extension_installations(tenant_id,id,version,enabled,manifest) VALUES(?,?,?,1,?)",
    )
    .bind(tenant, extensionId, manifest.version, JSON.stringify(manifest))
    .run();
  await db
    .prepare(
      "INSERT OR REPLACE INTO plugin_store_artifacts(tenant_id,id,version,manifest,entry_js,sha256,size_bytes,store_json) VALUES(?,?,?,?,?,?,?,?)",
    )
    .bind(
      tenant,
      extensionId,
      manifest.version,
      JSON.stringify(manifest),
      "export default {}",
      "test",
      1,
      JSON.stringify(store),
    )
    .run();
  await db
    .prepare(
      "INSERT OR REPLACE INTO studio_collection_sources(tenant_id,owner_principal_id,id,label,kind,config,encrypted_secret) VALUES(?,?,'fixture_source','Fixture','mcp',?,'encrypted-test-source')",
    )
    .bind(
      tenant,
      owner,
      JSON.stringify({
        endpoint: "https://mcp.public.dev/mcp",
        authMode: "oauth",
      }),
    )
    .run();
  const object = store.collections[0].object;
  await db
    .prepare(
      "INSERT OR REPLACE INTO studio_objects(tenant_id,name,label,config) VALUES(?,?,?,?)",
    )
    .bind(tenant, object.name, object.label, JSON.stringify(object.config))
    .run();
  await db
    .prepare("DELETE FROM studio_records WHERE tenant_id=?")
    .bind(tenant)
    .run();
  await db
    .prepare(
      "INSERT INTO studio_records(id,tenant_id,object_name,data,created_by) VALUES('saved',?,?,?,?)",
    )
    .bind(
      tenant,
      object.name,
      JSON.stringify({
        name: "Saved tender",
        source_id: "remote-1",
        process_id: "process-1",
        source_status: "Published",
        deadline: "2026-10-17T12:00:00Z",
        status: "interested",
        priority: "normal",
        notes: "Keep my notes",
        monitoring_enabled: true,
      }),
      owner,
    )
    .run();
});
const read = async () => ({
  data: [
    {
      id: "remote-1",
      estado_del_procedimiento: "Evaluation",
      fecha_de_recepcion_de: "2026-10-17T12:00:00Z",
    },
  ],
});
const events = async () =>
  (
    await db
      .prepare("SELECT payload FROM notification_events ORDER BY id")
      .all<{ payload: string }>()
  ).results.map((r) => JSON.parse(r.payload));
const record = async () =>
  JSON.parse(
    (await db
      .prepare(
        "SELECT data FROM studio_records WHERE id='saved' AND tenant_id=?",
      )
      .bind(tenant)
      .first<string>("data"))!,
  );
it("checks as creator, atomically refreshes source facts and delivers deduplicated notices", async () => {
  let calls = 0;
  const result = await runPluginMonitors(db, {
    now: () => now,
    read: async (request) => {
      calls++;
      expect(request.principalId).toBe(owner);
      expect(request.tenantId).toBe(tenant);
      expect(request.action.tool).toBe("read_item");
      expect(request.input.id_del_proceso).toBe("process-1");
      return read();
    },
  });
  expect(result.checked).toBe(1);
  expect(calls).toBe(1);
  expect(await record()).toMatchObject({
    source_status: "Evaluation",
    notes: "Keep my notes",
    status: "interested",
    monitoring_error: null,
  });
  const notices = await events();
  expect(notices).toHaveLength(2);
  expect(
    notices.every(
      (e) => e.audience.principals[0] === owner && e.scope.id === tenant,
    ),
  ).toBe(true);
  await runPluginMonitors(db, {
    now: () => now,
    read: async () => {
      throw Error("Not due");
    },
  });
  await runPluginMonitors(db, { now: () => now + 3600000, read });
  expect(await events()).toHaveLength(2);
  await runScheduledNotifications(db);
  expect(
    await db
      .prepare(
        "SELECT count(*) n FROM notification_deliveries WHERE recipient_id=?",
      )
      .bind(owner)
      .first<number>("n"),
  ).toBe(2);
});
it("leases overlapping ticks and does not duplicate remote work", async () => {
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    started = new Promise<void>((r) => {
      entered = r;
    });
  let calls = 0;
  const first = runPluginMonitors(db, {
    now: () => now,
    read: async () => {
      calls++;
      entered();
      await gate;
      return read();
    },
  });
  await started;
  const second = await runPluginMonitors(db, {
    now: () => now,
    read: async () => {
      calls++;
      return read();
    },
  });
  release();
  await first;
  expect(second.checked).toBe(0);
  expect(calls).toBe(1);
  expect(await events()).toHaveLength(2);
});
it("does not overwrite a user edit or emit notices from an obsolete snapshot", async () => {
  await runPluginMonitors(db, {
    now: () => now,
    read: async () => {
      const data = await record();
      data.notes = "Concurrent edit";
      await db
        .prepare(
          "UPDATE studio_records SET data=?,version=version+1 WHERE tenant_id=? AND id='saved'",
        )
        .bind(JSON.stringify(data), tenant)
        .run();
      return read();
    },
  });
  expect(await record()).toMatchObject({
    notes: "Concurrent edit",
    source_status: "Published",
  });
  expect(await events()).toHaveLength(0);
});
it("honors pause, disabled plugins and revoked owners including changes during a read", async () => {
  for (const mode of ["pause", "disable", "revoke"]) {
    await db.exec(
      "DELETE FROM studio_plugin_monitor_checks; DELETE FROM studio_plugin_monitor_cursor;",
    );
    await db
      .prepare(
        "UPDATE studio_extension_installations SET enabled=1 WHERE tenant_id=?",
      )
      .bind(tenant)
      .run();
    await db
      .prepare("UPDATE identity_principal SET is_active=1 WHERE id=?")
      .bind(owner)
      .run();
    const data = await record();
    data.monitoring_enabled = mode !== "pause";
    await db
      .prepare(
        "UPDATE studio_records SET data=? WHERE tenant_id=? AND id='saved'",
      )
      .bind(JSON.stringify(data), tenant)
      .run();
    let calls = 0;
    await runPluginMonitors(db, {
      now: () => now,
      read: async () => {
        calls++;
        if (mode === "disable")
          await db
            .prepare(
              "UPDATE studio_extension_installations SET enabled=0 WHERE tenant_id=?",
            )
            .bind(tenant)
            .run();
        if (mode === "revoke")
          await db
            .prepare("UPDATE identity_principal SET is_active=0 WHERE id=?")
            .bind(owner)
            .run();
        return read();
      },
    });
    expect(calls).toBe(mode === "pause" ? 0 : 1);
    expect(await events()).toHaveLength(0);
    expect((await record()).source_status).toBe("Published");
  }
});
it("keeps missing records unchanged and reports credential errors once per outage", async () => {
  await runPluginMonitors(db, {
    now: () => now,
    read: async () => ({ data: [] }),
  });
  expect((await record()).source_status).toBe("Published");
  expect((await record()).monitoring_error).toBe("record_missing");
  expect(await events()).toHaveLength(0);
  const denied = async () => {
    throw new McpAdapterError(401, "Private upstream message must not appear");
  };
  await runPluginMonitors(db, { now: () => now + 3600000, read: denied });
  await runPluginMonitors(db, { now: () => now + 7200000, read: denied });
  expect(await events()).toHaveLength(1);
  expect(JSON.stringify(await events())).not.toContain("Private upstream");
  expect((await record()).monitoring_error).toBe("authorization_required");
});

it("discards results if the exact owner's source is revoked or replaced during a read", async () => {
  for (const mutation of ["delete", "revoke", "replace"]) {
    await db.exec(
      "DELETE FROM studio_plugin_monitor_checks; DELETE FROM studio_plugin_monitor_cursor; DELETE FROM notification_events;",
    );
    await db
      .prepare(
        "INSERT OR REPLACE INTO studio_collection_sources(tenant_id,owner_principal_id,id,label,kind,config,encrypted_secret) VALUES(?,?,'fixture_source','Fixture','mcp',?,'encrypted-test-source')",
      )
      .bind(
        tenant,
        owner,
        JSON.stringify({
          endpoint: "https://mcp.public.dev/mcp",
          authMode: "oauth",
        }),
      )
      .run();
    await runPluginMonitors(db, {
      now: () => now,
      read: async () => {
        if (mutation === "delete")
          await db
            .prepare(
              "DELETE FROM studio_collection_sources WHERE tenant_id=? AND owner_principal_id=?",
            )
            .bind(tenant, owner)
            .run();
        else
          await db
            .prepare(
              "UPDATE studio_collection_sources SET encrypted_secret=? WHERE tenant_id=? AND owner_principal_id=?",
            )
            .bind(
              mutation === "revoke" ? null : "replacement-grant",
              tenant,
              owner,
            )
            .run();
        return read();
      },
    });
    expect((await record()).source_status).toBe("Published");
    expect((await record()).monitoring_error).toBe("authorization_required");
    expect(
      (await events()).every(
        (e) =>
          e.title ===
          store.monitors[0].notifications.connectionTitle.replace(
            "{name}",
            "Saved tender",
          ),
      ),
    ).toBe(true);
  }
});

it("fences credential revocation at commit and rolls back facts, observation and notices", async () => {
  let revokeAtCommit = false;
  const fencedDb = new Proxy(db, {
    get(target, key) {
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
          if (revokeAtCommit) {
            revokeAtCommit = false;
            await db
              .prepare(
                "UPDATE studio_collection_sources SET encrypted_secret=NULL WHERE tenant_id=? AND owner_principal_id=?",
              )
              .bind(tenant, owner)
              .run();
          }
          return target.batch(statements);
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await runPluginMonitors(fencedDb, {
    now: () => now,
    read: async () => {
      revokeAtCommit = true;
      return read();
    },
  });
  expect((await record()).source_status).toBe("Published");
  expect(await events()).toHaveLength(0);
  expect(
    await db
      .prepare(
        "SELECT observation FROM studio_plugin_monitor_checks WHERE tenant_id=?",
      )
      .bind(tenant)
      .first("observation"),
  ).toBeNull();
});

it("does not send a hidden lookup field to the provider when row access lacks required fields", async () => {
  const restricted = (
    await upsertPrincipal(db, {
      issuer: "monitor-test",
      subject: "restricted",
      email: "restricted@example.test",
      displayName: "Restricted",
    })
  ).id;
  await grantMembership(db, restricted, 8201, "viewer");
  const actor = await loadActor(db, (await findPrincipal(db, owner))!);
  const role = await saveAccessRole(db, actor, {
    scope: "tenant:8201",
    name: "monitor-hidden-fields",
    label: "Restricted",
    description: "",
    enabled: true,
    expectedRevision: (await loadAccessPolicy(db, actor, "tenant:8201"))
      .revision,
    grants: [
      {
        resource: "collection:procurement_opportunities",
        action: "read",
        predicate: { all: true },
        fields: ["name", "notes"],
      },
      {
        resource: "collection:procurement_opportunities",
        action: "update",
        predicate: { all: true },
        fields: Object.keys(store.collections[0].object.config.fields),
      },
    ],
  });
  await replaceAccessAssignments(db, actor, {
    scope: "tenant:8201",
    principalId: restricted,
    roleIds: [role.id],
    expectedRevision: role.revision,
  });
  await db
    .prepare(
      "UPDATE studio_records SET created_by=? WHERE tenant_id=? AND id='saved'",
    )
    .bind(restricted, tenant)
    .run();
  await db
    .prepare(
      "INSERT INTO studio_collection_sources(tenant_id,owner_principal_id,id,label,kind,config,encrypted_secret) SELECT tenant_id,?,id,label,kind,config,encrypted_secret FROM studio_collection_sources WHERE tenant_id=? AND owner_principal_id=?",
    )
    .bind(restricted, tenant, owner)
    .run();
  let calls = 0;
  await runPluginMonitors(db, {
    now: () => now,
    read: async () => {
      calls++;
      return read();
    },
  });
  expect(calls).toBe(0);
  expect(await events()).toHaveLength(0);
  expect((await record()).source_status).toBe("Published");
});
