import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  objectSchema,
  screenNavigationIconSchema,
  screenNavigationSectionSchema,
  validateRecord,
  fieldEntries,
  type CrmObject,
} from "@savia/crm-shared/metadata";
import {
  getObject,
  assertLocalCollection,
  guard,
  transaction,
  audit,
  uniqueStatements,
  checkRelations,
} from "./services";
import { fail } from "./context";
export const migrationSchema = z
  .object({
    rename: z.record(z.string(), z.string()).default({}),
    drop: z.array(z.string()).default([]),
    coerce: z.array(z.string()).default([]),
  })
  .default({ rename: {}, drop: [], coerce: [] });
export type Migration = z.infer<typeof migrationSchema>;
async function validateMetadataRelations(
  db: D1Database,
  tenant: string,
  object: CrmObject,
) {
  for (const [, field] of fieldEntries(object))
    if (field.config?.relation && field.config.relation !== object.name)
      await getObject(db, tenant, String(field.config.relation));
}
export async function createObject(
  db: D1Database,
  tenant: string,
  input: unknown,
) {
  if ((input as any)?.config?.studio?.collection)
    return fail(
      "Los enlaces de colección se crean mediante el registro de fuentes.",
      422,
    );
  const object = { ...objectSchema.parse(input), version: 1 } as CrmObject;
  await validateMetadataRelations(db, tenant, object);
  if (
    await db
      .prepare("SELECT 1 FROM crm_objects WHERE tenant_id=? AND name=?")
      .bind(tenant, object.name)
      .first()
  )
    return fail("Ya existe un objeto con ese identificador.", 409);
  await transaction(db, [
    db
      .prepare(
        "INSERT INTO crm_objects(tenant_id,name,label,description,config,version) VALUES (?,?,?,?,?,1)",
      )
      .bind(
        tenant,
        object.name,
        object.label,
        object.description,
        JSON.stringify(object.config),
      ),
    db
      .prepare(
        "INSERT INTO crm_schema_versions(tenant_id,object_name,version,definition) VALUES (?,?,1,?)",
      )
      .bind(tenant, object.name, JSON.stringify(object)),
    audit(db, tenant, "object.created", object.name, null, object),
  ]);
  return object;
}
export async function previewSchema(
  db: D1Database,
  tenant: string,
  name: string,
  input: unknown,
  migrationInput?: unknown,
  restoreVersion?: number,
) {
  await assertLocalCollection(db, tenant, name);
  const previous = await getObject(db, tenant, name),
    next = objectSchema.parse({ ...(input as object), name }) as CrmObject,
    migration = migrationSchema.parse(migrationInput);
  if (next.config.studio?.collection)
    return fail(
      "Los enlaces de colección se modifican mediante su adaptador de origen.",
      422,
    );
  await validateMetadataRelations(db, tenant, next);
  const removed = Object.keys(previous.config.fields).filter(
    (key) => !next.config.fields[key],
  );
  for (const key of removed)
    if (
      !migration.drop.includes(key) &&
      !migration.rename[key] &&
      restoreVersion === undefined
    )
      return fail(`Declara qué hacer con el campo eliminado: ${key}.`, 422);
  for (const [from, to] of Object.entries(migration.rename))
    if (!previous.config.fields[from] || !next.config.fields[to] || from === to)
      return fail("Mapeo de renombrado inválido.", 422);
  if (
    new Set(Object.values(migration.rename)).size !==
    Object.values(migration.rename).length
  )
    return fail("Dos campos no pueden renombrarse al mismo destino.", 422);
  const { results: rows } = await db
    .prepare(
      "SELECT * FROM crm_records WHERE tenant_id=? AND object_name=? AND deleted_at IS NULL",
    )
    .bind(tenant, name)
    .all<any>();
  const archived =
    restoreVersion !== undefined
      ? (
          await db
            .prepare(
              "SELECT record_id,data FROM crm_schema_data WHERE tenant_id=? AND object_name=? AND version=?",
            )
            .bind(tenant, name, restoreVersion)
            .all<any>()
        ).results
      : [];
  const archiveMap = new Map(
    archived.map((r) => [r.record_id, JSON.parse(r.data)]),
  );
  const errors: { id: string; error: string }[] = [],
    changed: {
      row: any;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }[] = [];
  const uniques = new Map<string, string>();
  for (const row of rows) {
    const before = JSON.parse(row.data),
      mapped = { ...before };
    for (const [from, to] of Object.entries(migration.rename)) {
      if (from in mapped) {
        if (to in mapped && mapped[to] != null && mapped[to] !== mapped[from]) {
          errors.push({
            id: row.id,
            error: `El destino ${to} ya contiene otro valor.`,
          });
          continue;
        }
        mapped[to] = mapped[from];
        delete mapped[from];
      }
    }
    migration.drop.forEach((field) => delete mapped[field]);
    if (restoreVersion !== undefined) {
      for (const key of Object.keys(mapped))
        if (!next.config.fields[key]) delete mapped[key];
      for (const key of Object.keys(next.config.fields))
        if (!(key in mapped) && archiveMap.get(row.id)?.[key] !== undefined)
          mapped[key] = archiveMap.get(row.id)[key];
    }
    for (const key of migration.coerce) {
      const field = next.config.fields[key];
      if (!field) return fail("Campo de conversión desconocido.", 422);
      if (mapped[key] != null && mapped[key] !== "") {
        if (field.type === "Number" || field.type === "Currency")
          mapped[key] = Number(mapped[key]);
        else if (field.type === "Toggle") {
          if (
            ["true", "1", "sí", "si"].includes(
              String(mapped[key]).toLowerCase(),
            )
          )
            mapped[key] = true;
          else if (
            ["false", "0", "no"].includes(String(mapped[key]).toLowerCase())
          )
            mapped[key] = false;
        } else mapped[key] = String(mapped[key]);
      }
    }
    const check = validateRecord(next, mapped);
    Object.values(check.errors).forEach((error) =>
      errors.push({ id: row.id, error }),
    );
    for (const [key, f] of fieldEntries(next))
      if (
        f.config?.unique &&
        check.data[key] != null &&
        check.data[key] !== ""
      ) {
        const value =
            typeof check.data[key] === "string"
              ? String(check.data[key]).trim().toLocaleLowerCase()
              : JSON.stringify(check.data[key]),
          uniqueKey = key + ":" + value;
        if (uniques.has(uniqueKey))
          errors.push({
            id: row.id,
            error: `${f.label}: duplicado con ${uniques.get(uniqueKey)}.`,
          });
        else uniques.set(uniqueKey, row.id);
      }
    try {
      await checkRelations(db, tenant, next, check.data);
    } catch (e) {
      errors.push({ id: row.id, error: (e as Error).message });
    }
    changed.push({ row, before, after: check.data });
  }
  return {
    previous,
    next,
    migration,
    records: changed,
    valid: errors.length === 0,
    changed: changed.filter(
      (r) => JSON.stringify(r.before) !== JSON.stringify(r.after),
    ).length,
    total: rows.length,
    errors,
  };
}
export async function publishSchema(
  db: D1Database,
  tenant: string,
  name: string,
  input: unknown,
  migrationInput?: unknown,
  restoreVersion?: number,
) {
  await assertLocalCollection(db, tenant, name);
  const preview = await previewSchema(
      db,
      tenant,
      name,
      input,
      migrationInput,
      restoreVersion,
    ),
    { previous, next, records } = preview;
  if ((input as any).version !== previous.version)
    return fail(
      "Otra persona cambió la estructura. Recarga el diseñador.",
      409,
    );
  if (!preview.valid)
    return fail(
      "No se puede publicar: " +
        preview.errors
          .slice(0, 5)
          .map((e) => `${e.id}: ${e.error}`)
          .join("; "),
      409,
    );
  const nextVersion = (previous.version ?? 1) + 1,
    definition = { ...next, version: nextVersion };
  const g = guard(
    db,
    "SELECT version=? FROM crm_objects WHERE tenant_id=? AND name=?",
    [previous.version, tenant, name],
  );
  const count = guard(
    db,
    "SELECT count(*)=? FROM crm_records WHERE tenant_id=? AND object_name=? AND deleted_at IS NULL",
    [records.length, tenant, name],
  );
  const relationGuards: D1PreparedStatement[] = [];
  for (const record of records)
    relationGuards.push(
      ...(await checkRelations(db, tenant, next, record.after)),
    );
  const statements = [
    g.start,
    count.start,
    ...relationGuards,
    db
      .prepare(
        "INSERT OR IGNORE INTO crm_schema_versions(tenant_id,object_name,version,definition) VALUES (?,?,?,?)",
      )
      .bind(tenant, name, previous.version, JSON.stringify(previous)),
    db
      .prepare(
        "DELETE FROM crm_unique_values WHERE tenant_id=? AND object_name=?",
      )
      .bind(tenant, name),
  ];
  for (const record of records) {
    const rg = guard(
      db,
      "SELECT version=? FROM crm_records WHERE tenant_id=? AND id=?",
      [record.row.version, tenant, record.row.id],
    );
    statements.push(
      rg.start,
      db
        .prepare(
          "INSERT OR REPLACE INTO crm_schema_data(tenant_id,object_name,version,record_id,data) VALUES (?,?,?,?,?)",
        )
        .bind(
          tenant,
          name,
          previous.version,
          record.row.id,
          JSON.stringify(record.before),
        ),
      db
        .prepare(
          "UPDATE crm_records SET data=?,version=version+1,updated_at=? WHERE tenant_id=? AND id=?",
        )
        .bind(
          JSON.stringify(record.after),
          new Date().toISOString(),
          tenant,
          record.row.id,
        ),
      ...uniqueStatements(db, tenant, next, record.row.id, record.after),
      rg.end,
    );
  }
  statements.push(
    db
      .prepare(
        "UPDATE crm_objects SET label=?,description=?,config=?,version=? WHERE tenant_id=? AND name=?",
      )
      .bind(
        next.label,
        next.description,
        JSON.stringify(next.config),
        nextVersion,
        tenant,
        name,
      ),
    db
      .prepare(
        "INSERT INTO crm_schema_versions(tenant_id,object_name,version,definition) VALUES (?,?,?,?)",
      )
      .bind(tenant, name, nextVersion, JSON.stringify(definition)),
    audit(
      db,
      tenant,
      restoreVersion ? "object.restored" : "object.updated",
      name,
      null,
      {
        before: previous,
        after: definition,
        migration: preview.migration,
        restoreVersion,
      },
    ),
    count.end,
    g.end,
  );
  await transaction(db, statements);
  return definition;
}

export const screenMetaSchema = z.object({
  label: z.string().trim().min(1).max(100).optional(),
  hidden: z.boolean().optional(),
  order: z.number().int().min(0).max(9999).optional(),
  createMode: z.enum(["modal", "drawer", "drawer-long", "page"]).optional(),
  editMode: z.enum(["modal", "drawer", "drawer-long", "page"]).optional(),
  section: screenNavigationSectionSchema.optional(),
  icon: screenNavigationIconSchema.optional(),
});

export const screenMetaPatchSchema = screenMetaSchema.extend({
  version: z.number().int().positive().optional(),
});

export async function patchScreenMeta(
  db: D1Database,
  tenant: string,
  name: string,
  screen: z.infer<typeof screenMetaSchema>,
  expectedVersion?: number,
) {
  const object = await getObject(db, tenant, name);
  if (
    object.config.studio?.collection &&
    (screen.hidden !== undefined ||
      screen.order !== undefined ||
      screen.section !== undefined ||
      screen.icon !== undefined)
  )
    return fail(
      "Las pantallas enlazadas a una fuente deben desvincularse antes de cambiar su menú.",
      422,
    );
  if (
    ["managed-agency", "managed-customer"].includes(
      object.config.studio?.business ?? "",
    ) &&
    (screen.hidden !== undefined ||
      screen.order !== undefined ||
      screen.section !== undefined ||
      screen.icon !== undefined)
  )
    return fail("Esta pantalla administrada no se puede reordenar aquí.", 422);
  if (
    expectedVersion !== undefined &&
    (object.version ?? 1) !== expectedVersion
  )
    return fail("La pantalla cambió; recarga antes de guardar.", 409);
  const { label, ...parsedScreen } = screenMetaSchema.parse(screen);
  const nextConfig =
    Object.keys(parsedScreen).length === 0
      ? object.config
      : {
          ...object.config,
          studio: {
            ...object.config.studio,
            screen: {
              ...object.config.studio?.screen,
              ...parsedScreen,
            },
          },
        };
  const nextVersion = (object.version ?? 1) + 1;
  const g = guard(
    db,
    "SELECT version=? FROM crm_objects WHERE tenant_id=? AND name=?",
    [object.version ?? 1, tenant, name],
  );
  await transaction(db, [
    g.start,
    db
      .prepare(
        "UPDATE crm_objects SET label=?, config=?, version=? WHERE tenant_id=? AND name=?",
      )
      .bind(
        label ?? object.label,
        JSON.stringify(nextConfig),
        nextVersion,
        tenant,
        name,
      ),
    audit(db, tenant, "object.screen_updated", name, null, {
      screen: parsedScreen,
      ...(label !== undefined ? { label } : {}),
    }),
    g.end,
  ]);
  return {
    ...object,
    label: label ?? object.label,
    config: nextConfig,
    version: nextVersion,
  } as CrmObject;
}

export async function reorderScreens(
  db: D1Database,
  tenant: string,
  names: string[],
) {
  if (!names.length) return [];
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    unique.push(name);
  }
  const { results } = await db
    .prepare("SELECT name FROM crm_objects WHERE tenant_id=?")
    .bind(tenant)
    .all<{ name: string }>();
  const known = new Set(results.map((row) => row.name));
  const reorderable = unique.filter((name) => known.has(name));
  const updated: CrmObject[] = [];
  for (let index = 0; index < reorderable.length; index++) {
    try {
      updated.push(
        await patchScreenMeta(db, tenant, reorderable[index], { order: index }),
      );
    } catch (error) {
      if (error instanceof HTTPException && error.status === 422) continue;
      throw error;
    }
  }
  return updated;
}

async function assertObjectCanBeDeleted(
  db: D1Database,
  tenant: string,
  object: CrmObject,
  options: { allowRecords?: boolean } = {},
) {
  if (object.config.studio?.collection)
    return fail(
      "Desvincula la colección desde Fuentes y colecciones antes de eliminar la pantalla.",
      422,
    );
  if (
    ["managed-agency", "managed-customer"].includes(
      object.config.studio?.business ?? "",
    )
  )
    return fail("Esta pantalla administrada no se puede eliminar aquí.", 422);
  const records = await db
    .prepare(
      "SELECT count(*) AS total FROM crm_records WHERE tenant_id=? AND object_name=?",
    )
    .bind(tenant, object.name)
    .first<{ total: number }>();
  if ((records?.total ?? 0) > 0 && !options.allowRecords)
    return fail(
      "Esta pantalla tiene registros. Confirma la eliminación de los datos para continuar.",
      409,
    );
  const { results } = await db
    .prepare("SELECT name,config FROM crm_objects WHERE tenant_id=?")
    .bind(tenant)
    .all<{ name: string; config: string }>();
  for (const row of results) {
    if (row.name === object.name) continue;
    const config = JSON.parse(row.config) as CrmObject["config"];
    for (const field of Object.values(config.fields ?? {})) {
      if (field.config?.relation === object.name)
        return fail(
          `Quita la relación en «${row.name}» antes de eliminar esta pantalla.`,
          409,
        );
    }
  }
  return records?.total ?? 0;
}

async function tableExists(db: D1Database, name: string) {
  return Boolean(
    await db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
      )
      .bind(name)
      .first(),
  );
}

async function deleteObjectDataStatements(
  db: D1Database,
  tenant: string,
  name: string,
) {
  const statements: D1PreparedStatement[] = [];
  if (await tableExists(db, "crm_record_links")) {
    statements.push(
      db
        .prepare(
          "DELETE FROM crm_record_links WHERE tenant_id=? AND (source_id IN (SELECT id FROM crm_records WHERE tenant_id=? AND object_name=?) OR target_id IN (SELECT id FROM crm_records WHERE tenant_id=? AND object_name=?))",
        )
        .bind(tenant, tenant, name, tenant, name),
    );
  }
  if (await tableExists(db, "crm_collection_relations")) {
    statements.push(
      db
        .prepare(
          "DELETE FROM crm_record_links WHERE tenant_id=? AND relation_id IN (SELECT id FROM crm_collection_relations WHERE tenant_id=? AND (source_object=? OR target_object=?))",
        )
        .bind(tenant, tenant, name, name),
      db
        .prepare(
          "DELETE FROM crm_collection_relations WHERE tenant_id=? AND (source_object=? OR target_object=?)",
        )
        .bind(tenant, name, name),
    );
  }
  for (const table of [
    "crm_business_links",
    "crm_file_drafts",
    "crm_files",
    "crm_notes",
    "crm_tasks",
  ] as const) {
    if (await tableExists(db, table))
      statements.push(
        db
          .prepare(`DELETE FROM ${table} WHERE tenant_id=? AND object_name=?`)
          .bind(tenant, name),
      );
  }
  statements.push(
    db
      .prepare(
        "DELETE FROM crm_automation_runs WHERE tenant_id=? AND object_name=?",
      )
      .bind(tenant, name),
    db
      .prepare(
        "DELETE FROM crm_automations WHERE tenant_id=? AND object_name=?",
      )
      .bind(tenant, name),
    db
      .prepare("DELETE FROM crm_views WHERE tenant_id=? AND object_name=?")
      .bind(tenant, name),
    db
      .prepare(
        "DELETE FROM crm_schema_data WHERE tenant_id=? AND object_name=?",
      )
      .bind(tenant, name),
    db
      .prepare(
        "DELETE FROM crm_schema_versions WHERE tenant_id=? AND object_name=?",
      )
      .bind(tenant, name),
    db
      .prepare(
        "DELETE FROM crm_unique_values WHERE tenant_id=? AND object_name=?",
      )
      .bind(tenant, name),
    db
      .prepare("DELETE FROM crm_records WHERE tenant_id=? AND object_name=?")
      .bind(tenant, name),
  );
  return statements;
}

function deleteObjectMetadataStatements(
  db: D1Database,
  tenant: string,
  name: string,
) {
  return [
    db
      .prepare(
        "DELETE FROM crm_automation_runs WHERE tenant_id=? AND object_name=?",
      )
      .bind(tenant, name),
    db
      .prepare(
        "DELETE FROM crm_automations WHERE tenant_id=? AND object_name=?",
      )
      .bind(tenant, name),
    db
      .prepare("DELETE FROM crm_views WHERE tenant_id=? AND object_name=?")
      .bind(tenant, name),
    db
      .prepare(
        "DELETE FROM crm_schema_data WHERE tenant_id=? AND object_name=?",
      )
      .bind(tenant, name),
    db
      .prepare(
        "DELETE FROM crm_schema_versions WHERE tenant_id=? AND object_name=?",
      )
      .bind(tenant, name),
    db
      .prepare(
        "DELETE FROM crm_unique_values WHERE tenant_id=? AND object_name=?",
      )
      .bind(tenant, name),
  ];
}

export async function deleteObject(
  db: D1Database,
  tenant: string,
  name: string,
  options: { deleteRecords?: boolean } = {},
) {
  const object = await getObject(db, tenant, name);
  const recordCount = await assertObjectCanBeDeleted(db, tenant, object, {
    allowRecords: options.deleteRecords,
  });
  const cascadeData = Boolean(options.deleteRecords && recordCount > 0);
  const statements = [
    ...(cascadeData
      ? await deleteObjectDataStatements(db, tenant, name)
      : deleteObjectMetadataStatements(db, tenant, name)),
    db
      .prepare("DELETE FROM crm_objects WHERE tenant_id=? AND name=?")
      .bind(tenant, name),
    audit(db, tenant, "object.deleted", name, null, {
      label: object.label,
      deletedRecords: cascadeData ? recordCount : 0,
    }),
  ];
  if (!cascadeData) {
    const empty = guard(
      db,
      "SELECT count(*)=0 FROM crm_records WHERE tenant_id=? AND object_name=?",
      [tenant, name],
    );
    await transaction(db, [empty.start, ...statements, empty.end]);
  } else {
    await transaction(db, statements);
  }
  return {
    name,
    deleted: true,
    deletedRecords: cascadeData ? recordCount : 0,
  };
}
