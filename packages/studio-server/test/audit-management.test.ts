import { migrationStatements } from "./migration-statements";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import { createStudioApp } from "../src/index";

let platform: Awaited<
  ReturnType<typeof getPlatformProxy<{ DB: D1Database; POC_LOCAL: string }>>
>;

function request(tenant: string, path: string, method = "GET") {
  return createStudioApp(tenant).request(
    `http://localhost/api${path}`,
    { method },
    platform.env,
  );
}

async function insertAudit(
  tenant: string,
  id: string,
  object: string,
  action = "record.updated",
  detail: unknown = {},
  createdAt = "2026-09-28T12:00:00.000Z",
) {
  await platform.env.DB.prepare(
    "INSERT INTO studio_audit(id,tenant_id,action,object_name,record_id,detail,created_at) VALUES (?,?,?,?,?,?,?)",
  )
    .bind(id, tenant, action, object, null, JSON.stringify(detail), createdAt)
    .run();
}

function parseCsv(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = csv.startsWith("\uFEFF") ? csv.slice(1) : csv;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\r" && input[index + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index++;
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  for (const migration of readdirSync("migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort())
    for (const sql of migrationStatements(
      readFileSync(`migrations/${migration}`, "utf8"),
    ))
      await platform.env.DB.prepare(sql).run();
});

afterAll(async () => {
  await platform?.dispose();
});

describe("tenant audit management", () => {
  it("deletes only the requested tenant event and applies the object filter to bulk deletion", async () => {
    await insertAudit("audit-delete-b", "foreign-event", "quotes");
    await insertAudit("audit-delete-a", "selected-event", "quotes");
    await insertAudit("audit-delete-a", "retained-event", "policies");

    const foreignDelete = await request(
      "audit-delete-a",
      "/audit/foreign-event",
      "DELETE",
    );
    expect(foreignDelete.status).toBe(404);
    expect(
      await platform.env.DB.prepare(
        "SELECT count(*) AS total FROM studio_audit WHERE tenant_id=? AND id=?",
      )
        .bind("audit-delete-b", "foreign-event")
        .first(),
    ).toMatchObject({ total: 1 });

    const bulk = await request(
      "audit-delete-a",
      "/audit?object=quotes",
      "DELETE",
    );
    expect(bulk.status).toBe(200);
    expect(await bulk.json()).toMatchObject({ ok: true, deleted: 1 });
    expect(
      await platform.env.DB.prepare(
        "SELECT id FROM studio_audit WHERE tenant_id=? ORDER BY id",
      )
        .bind("audit-delete-a")
        .all(),
    ).toMatchObject({ results: [{ id: "retained-event" }] });
    expect(
      await platform.env.DB.prepare(
        "SELECT count(*) AS total FROM studio_audit WHERE tenant_id=? AND object_name=?",
      )
        .bind("audit-delete-b", "quotes")
        .first(),
    ).toMatchObject({ total: 1 });

    const one = await request(
      "audit-delete-a",
      "/audit/retained-event",
      "DELETE",
    );
    expect(one.status).toBe(200);
    expect(await one.json()).toMatchObject({ ok: true });
    expect(
      (await request("audit-delete-a", "/audit/retained-event", "DELETE"))
        .status,
    ).toBe(404);
  });

  it("exports every scoped event with valid escaping and formula protection", async () => {
    const tenant = "audit-csv";
    for (let index = 0; index < 205; index++) {
      const id = `csv-${String(index).padStart(3, "0")}`;
      await insertAudit(
        tenant,
        id,
        "csv_fixture",
        index === 204 ? '=HYPERLINK("https://bad.test")' : "record.updated",
        index === 0 ? { note: 'comma, newline\n and "quotes"' } : { index },
      );
    }
    await insertAudit(tenant, "other-object", "another_fixture");

    const response = await request(
      tenant,
      "/audit/export.csv?object=csv_fixture",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("audit.csv");
    const rows = parseCsv(await response.text());
    expect(rows[0]).toEqual([
      "id",
      "action",
      "object_name",
      "record_id",
      "created_at",
      "detail",
    ]);
    expect(rows).toHaveLength(206);
    expect(rows[1][0]).toBe("csv-204");
    expect(rows[1][1]).toBe('\'=HYPERLINK("https://bad.test")');
    const first = rows.find((row) => row[0] === "csv-000");
    expect(first).toBeDefined();
    expect(JSON.parse(first![5])).toEqual({
      note: 'comma, newline\n and "quotes"',
    });
  });
});
