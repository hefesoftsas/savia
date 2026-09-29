import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";

const baseline = Object.entries(
  import.meta.glob<string>(
    "../../../packages/db/migrations/000{1_initial,2_bootstrap}.sql",
    {
      eager: true,
      import: "default",
      query: "?raw",
    },
  ),
).sort(([a], [b]) => a.localeCompare(b));

beforeAll(async () => {
  expect(baseline).toHaveLength(2);
  for (const [, sql] of baseline) {
    for (const statement of sql.split("--> statement-breakpoint")) {
      const normalized = statement
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (normalized) await env.DB.exec(normalized);
    }
  }
});

it("stores supported database source kinds with their owner and encrypted secret", async () => {
  await env.DB.prepare(
    "INSERT INTO identity_principal(id,issuer,subject,email,display_name,created_at,updated_at) VALUES('source-owner','savia:better-auth','source-owner','source@example.test','Source Owner','2026-09-29','2026-09-29')",
  ).run();

  for (const kind of ["jsonapi", "postgres", "mysql", "mssql", "mongodb"]) {
    await env.DB.prepare(
      "INSERT INTO studio_collection_sources(tenant_id,owner_principal_id,id,label,kind,config,encrypted_secret,created_at) VALUES(?,?,?,?,?,?,?,?)",
    )
      .bind(
        "tenant:0",
        "source-owner",
        kind,
        kind,
        kind,
        "{}",
        "ciphertext",
        "2026-09-29",
      )
      .run();
  }

  expect(
    await env.DB.prepare(
      "SELECT kind,owner_principal_id,encrypted_secret,created_at FROM studio_collection_sources ORDER BY kind",
    ).all(),
  ).toMatchObject({
    results: [
      {
        kind: "jsonapi",
        owner_principal_id: "source-owner",
        encrypted_secret: "ciphertext",
      },
      {
        kind: "mongodb",
        owner_principal_id: "source-owner",
        encrypted_secret: "ciphertext",
      },
      {
        kind: "mssql",
        owner_principal_id: "source-owner",
        encrypted_secret: "ciphertext",
      },
      {
        kind: "mysql",
        owner_principal_id: "source-owner",
        encrypted_secret: "ciphertext",
      },
      {
        kind: "postgres",
        owner_principal_id: "source-owner",
        encrypted_secret: "ciphertext",
      },
    ],
  });
  await expect(
    env.DB.prepare(
      "INSERT INTO studio_collection_sources(tenant_id,owner_principal_id,id,label,kind,config) VALUES('tenant:0','source-owner','unsupported','Unsupported','oracle','{}')",
    ).run(),
  ).rejects.toThrow();
  await expect(
    env.DB.prepare(
      "INSERT INTO studio_collection_sources(tenant_id,owner_principal_id,id,label,kind,config) VALUES('tenant:0','source-owner','invalid-json','Invalid JSON','postgres','not-json')",
    ).run(),
  ).rejects.toThrow();
});
