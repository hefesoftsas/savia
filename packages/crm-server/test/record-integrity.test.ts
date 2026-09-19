import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import { makeConfig, type CrmObject } from "@savia/crm-shared/metadata";
import { createObject, publishSchema } from "../src/schema";
import {
  createRecord,
  deleteRecord,
  getObject,
  getRecord,
  restoreRecord,
} from "../src/services";
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
const tenant = "integrity";
beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  db = platform.env.DB;
  for (const name of readdirSync("migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort())
    for (const sql of readFileSync(`migrations/${name}`, "utf8")
      .split(/;(?!(?:\s*END\b))/i)
      .filter((s) => s.trim()))
      await db.prepare(sql).run();
});
afterAll(async () => {
  await platform?.dispose();
});
async function object(
  name: string,
  fields: CrmObject["config"]["fields"] = {
    name: { type: "Textbox", label: "Nombre" },
  },
) {
  return createObject(db, tenant, {
    name,
    label: name,
    config: makeConfig(fields),
  });
}
// Run a real concurrent write after the service's reads but before its atomic D1 batch.
function racing(write: () => Promise<unknown>): D1Database {
  return {
    prepare: db.prepare.bind(db),
    batch: async (statements: D1PreparedStatement[]) => {
      await write();
      return db.batch(statements);
    },
  } as D1Database;
}
describe("Record and metadata integrity under interleaved writes", () => {
  it("clears multiple incoming fields once and rebuilds their unique indexes", async () => {
    await object("clear_target");
    await object("clear_source", {
      name: { type: "Textbox", label: "Nombre", config: { unique: true } },
      primary: {
        type: "Dropdown",
        label: "Principal",
        config: { relation: "clear_target", onDelete: "clear", unique: true },
      },
      secondary: {
        type: "Dropdown",
        label: "Secundaria",
        config: { relation: "clear_target", onDelete: "clear" },
      },
      many: {
        type: "Dropdown",
        label: "Varias",
        config: { relation: "clear_target", onDelete: "clear", multiple: true },
      },
    });
    const target = await createRecord(db, tenant, "clear_target", {
        name: "A",
      }),
      other = await createRecord(db, tenant, "clear_target", { name: "B" });
    const source = await createRecord(db, tenant, "clear_source", {
      name: "Origen",
      primary: target.id,
      secondary: target.id,
      many: [target.id, other.id],
    });
    await deleteRecord(db, tenant, "clear_target", target.id, { version: 1 });
    const result = await getRecord(db, tenant, "clear_source", source.id);
    expect(result).toMatchObject({
      primary: null,
      secondary: null,
      many: [other.id],
      _version: 2,
    });
    const unique = await db
      .prepare(
        "SELECT field_name,value FROM crm_unique_values WHERE record_id=?",
      )
      .bind(source.id)
      .all<any>();
    expect(unique.results).toEqual([{ field_name: "name", value: "origen" }]);
    const audits = await db
      .prepare(
        "SELECT count(*) as count FROM crm_audit WHERE record_id=? AND action='relation.cleared'",
      )
      .bind(source.id)
      .first<{ count: number }>();
    expect(audits?.count).toBe(1);
  });
  it("rejects deletion if a new reference is inserted after the incoming scan", async () => {
    await object("race_target");
    await object("race_source", {
      target: {
        type: "Dropdown",
        label: "Destino",
        config: { relation: "race_target", onDelete: "clear" },
      },
    });
    const target = await createRecord(db, tenant, "race_target", {
      name: "Conservar",
    });
    await expect(
      deleteRecord(
        racing(() =>
          createRecord(db, tenant, "race_source", { target: target.id }),
        ),
        tenant,
        "race_target",
        target.id,
        { version: 1 },
      ),
    ).rejects.toThrow("Los datos cambiaron");
    expect(
      (await getRecord(db, tenant, "race_target", target.id))._version,
    ).toBe(1);
  });
  it("rejects deletion when existing metadata adds a relation during the scan", async () => {
    await object("meta_target");
    const sourceObject = await object("meta_source", {
      target: { type: "Textbox", label: "Destino" },
    });
    const target = await createRecord(db, tenant, "meta_target", {
      name: "Conservar",
    });
    await createRecord(db, tenant, "meta_source", { target: target.id });
    const next = {
      ...sourceObject,
      config: makeConfig({
        target: {
          type: "Dropdown",
          label: "Destino",
          config: { relation: "meta_target", onDelete: "restrict" },
        },
      }),
    };
    await expect(
      deleteRecord(
        racing(() => publishSchema(db, tenant, "meta_source", next)),
        tenant,
        "meta_target",
        target.id,
        { version: 1 },
      ),
    ).rejects.toThrow("Los datos cambiaron");
    expect(
      (await getRecord(db, tenant, "meta_target", target.id))._version,
    ).toBe(1);
  });
  it("rejects deletion if a new object with a reference is introduced during the scan", async () => {
    await object("new_schema_target");
    const target = await createRecord(db, tenant, "new_schema_target", {
      name: "Conservar",
    });
    await expect(
      deleteRecord(
        racing(async () => {
          await object("new_schema_source", {
            target: {
              type: "Dropdown",
              label: "Destino",
              config: { relation: "new_schema_target" },
            },
          });
          await createRecord(db, tenant, "new_schema_source", {
            target: target.id,
          });
        }),
        tenant,
        "new_schema_target",
        target.id,
        { version: 1 },
      ),
    ).rejects.toThrow("Los datos cambiaron");
    expect(
      (await getRecord(db, tenant, "new_schema_target", target.id))._version,
    ).toBe(1);
  });
  it("rolls back metadata publication if a newly referenced target is deleted before commit", async () => {
    await object("publish_target");
    const sourceObject = await object("publish_source", {
      target: { type: "Textbox", label: "Destino" },
    });
    const target = await createRecord(db, tenant, "publish_target", {
        name: "A",
      }),
      source = await createRecord(db, tenant, "publish_source", {
        target: target.id,
      });
    const next = {
      ...sourceObject,
      config: makeConfig({
        target: {
          type: "Dropdown",
          label: "Destino",
          config: { relation: "publish_target" },
        },
      }),
    };
    await expect(
      publishSchema(
        racing(() =>
          deleteRecord(db, tenant, "publish_target", target.id, { version: 1 }),
        ),
        tenant,
        "publish_source",
        next,
      ),
    ).rejects.toThrow("Los datos cambiaron");
    expect((await getObject(db, tenant, "publish_source")).version).toBe(1);
    expect(
      (await getRecord(db, tenant, "publish_source", source.id))._version,
    ).toBe(1);
  });
  it("keeps a record in trash if metadata changes during its restore", async () => {
    const original = await object("restore_race");
    const record = await createRecord(db, tenant, "restore_race", {
      name: "Archivado",
    });
    await deleteRecord(db, tenant, "restore_race", record.id, { version: 1 });
    const next = {
      ...original,
      config: makeConfig({
        name: { type: "Textbox", label: "Nombre" },
        required: { type: "Textbox", label: "Dato nuevo", required: true },
      }),
    };
    await expect(
      restoreRecord(
        racing(() => publishSchema(db, tenant, "restore_race", next)),
        tenant,
        "restore_race",
        record.id,
        2,
      ),
    ).rejects.toThrow("Los datos cambiaron");
    const stored = await db
      .prepare("SELECT deleted_at,version FROM crm_records WHERE id=?")
      .bind(record.id)
      .first<any>();
    expect(stored.deleted_at).toBeTruthy();
    expect(stored.version).toBe(2);
  });
});
