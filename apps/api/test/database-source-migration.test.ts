import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import migration from "../../../packages/db/migrations/0055_collection_database_sources.sql?raw";
it("preserves legacy credentials, owners and timestamps when expanding source kinds", async () => {
  await env.DB.exec(
    "CREATE TABLE crm_collection_sources (tenant_id TEXT NOT NULL,owner_principal_id TEXT NOT NULL,id TEXT NOT NULL,label TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('jsonapi','postgres')),config TEXT NOT NULL,encrypted_secret TEXT,created_at TEXT NOT NULL,PRIMARY KEY(tenant_id,owner_principal_id,id))",
  );
  await env.DB.prepare(
    "INSERT INTO crm_collection_sources VALUES (?,?,?,?,?,?,?,?)",
  )
    .bind(
      "tenant",
      "owner",
      "erp",
      "ERP",
      "postgres",
      '{"host":"db"}',
      "encrypted-value",
      "2026-01-01",
    )
    .run();
  for (const part of migration.split("--> statement-breakpoint")) {
    const statement = part
      .replace(/^--.*$/gm, "")
      .replace(/\s+/g, " ")
      .trim();
    if (statement) await env.DB.exec(statement);
  }
  const row = await env.DB.prepare(
    "SELECT * FROM crm_collection_sources WHERE id='erp'",
  ).first();
  expect(row).toMatchObject({
    tenant_id: "tenant",
    owner_principal_id: "owner",
    kind: "postgres",
    encrypted_secret: "encrypted-value",
    created_at: "2026-01-01",
    config: '{"host":"db"}',
  });
  for (const kind of ["mysql", "mssql", "mongodb"])
    await env.DB.prepare(
      "INSERT INTO crm_collection_sources VALUES (?,?,?,?,?,?,?,?)",
    )
      .bind("tenant", "owner", kind, kind, kind, "{}", null, "2026-01-02")
      .run();
  expect(
    (
      (await env.DB.prepare(
        "SELECT count(*) AS count FROM crm_collection_sources",
      ).first()) as any
    ).count,
  ).toBe(4);
});
