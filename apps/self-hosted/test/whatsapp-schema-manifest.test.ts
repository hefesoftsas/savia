import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { SqliteDatabase } from "../src/sqlite.js";

const whatsappTables = [
  "tenant_whatsapp_assistant_bindings",
  "whatsapp_inbox",
  "whatsapp_delivery_receipts",
  "whatsapp_channel_settings",
  "whatsapp_channel_contacts",
  "whatsapp_channel_history",
  "whatsapp_channel_actions",
  "whatsapp_channel_resources",
  "whatsapp_channel_dispatches",
];

it("keeps WhatsApp PostgreSQL inventory aligned with the migrated tables", async () => {
  const root = resolve(import.meta.dirname, "../../..");
  const manifest = JSON.parse(
    readFileSync(resolve(root, "packages/db/postgres/manifest.json"), "utf8"),
  );
  const database = new SqliteDatabase(":memory:");
  try {
    await database.migrate(resolve(root, "packages/db/migrations"));
    for (const name of whatsappTables) {
      const table = manifest.tables.find(
        (entry: { name: string }) => entry.name === name,
      );
      expect(table, name).toBeDefined();
      const columns = await database
        .prepare(`PRAGMA table_info(${name})`)
        .all();
      const normalize = (column: Record<string, unknown>) => ({
        ...column,
        type: column.type === "BIGINT" ? "INTEGER" : column.type,
      });
      expect(columns.results.map(normalize), name).toEqual(
        table.columns.map(normalize),
      );
      const sql = await database
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
        .bind(name)
        .first<string>("sql");
      expect(sql?.match(/\bCHECK\s*\(/gi)?.length ?? 0, name).toBe(
        table.checkCount,
      );
    }

    expect(manifest.objects).toContainEqual({
      type: "index",
      name: "whatsapp_inbox_active_contact_unique",
      table: "whatsapp_inbox",
    });
    const indexSql = await database
      .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?")
      .bind("whatsapp_inbox_active_contact_unique")
      .first<string>("sql");
    expect(indexSql?.replace(/\s+/g, " ").toLowerCase()).toContain(
      "where state in ('generating', 'responding')",
    );

    const now = new Date().toISOString();
    await database
      .prepare(
        `INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at,kind)
         VALUES(900000,'schema-whatsapp-tenant','Schema WhatsApp tenant',1,?,?,'commercial')`,
      )
      .bind(now, now)
      .run();
    await database
      .prepare(
        `INSERT INTO identity_principal
           (id,issuer,subject,email,display_name,is_active,created_at,updated_at)
         VALUES('schema-whatsapp-owner','schema-test','whatsapp-schema','schema-whatsapp@example.test',
           'Synthetic schema owner',1,?,?)`,
      )
      .bind(now, now)
      .run();
    await database
      .prepare(
        `INSERT INTO tenant_whatsapp_connections
           (id,tenant_id,created_by_principal_id,nango_connection_id,nango_integration_id,status,
            phone_number_id,waba_id,created_at,updated_at)
         VALUES('schema-whatsapp-connection',900000,'schema-whatsapp-owner','schema-nango',
           'schema-whatsapp','connected','15550009000','15550009001',?,?)`,
      )
      .bind(now, now)
      .run();

    const insertInbox = async (
      messageId: string,
      contact: string,
      state: "pending" | "generating",
    ) =>
      database
        .prepare(
          `INSERT INTO whatsapp_inbox
             (message_id,phone_number_id,waba_id,contact_phone,normalized_contact,message_text,
              provider_timestamp,tenant_id,connection_id,state,received_at)
           VALUES(?,'15550009000','15550009001',?,?, 'synthetic message', ?,900000,
             'schema-whatsapp-connection',?,?)`,
        )
        .bind(messageId, contact, contact, now, state, now)
        .run();

    await insertInbox("wamid-schema-a1", "15550009002", "generating");
    await insertInbox("wamid-schema-a2", "15550009002", "pending");
    await expect(
      database
        .prepare(
          "UPDATE whatsapp_inbox SET state='generating' WHERE message_id=?",
        )
        .bind("wamid-schema-a2")
        .run(),
    ).rejects.toThrow(/UNIQUE/);
    await insertInbox("wamid-schema-b1", "15550009003", "generating");
    await database
      .prepare("UPDATE whatsapp_inbox SET state='completed' WHERE message_id=?")
      .bind("wamid-schema-a1")
      .run();
    await database
      .prepare(
        "UPDATE whatsapp_inbox SET state='generating' WHERE message_id=?",
      )
      .bind("wamid-schema-a2")
      .run();
  } finally {
    database.close();
  }
});
