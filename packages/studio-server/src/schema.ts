import { summaryConfigurationStatements } from "./record-summaries";
import { recordIndexStatements } from "./record-performance";
import { dialectFor } from "@savia/db/dialect";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  objectSchema,
  recordPerformanceSchema,
  screenNavigationIconSchema,
  screenNavigationSectionSchema,
  validateRecord,
  fieldEntries,
  type StudioObject,
} from "@savia/studio-shared/metadata";
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
import type { ScreenDeletionPreview } from "@savia/studio-shared/screen-deletion";
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
  object: StudioObject,
) {
  for (const [, field] of fieldEntries(object))
    if (field.config?.relation && field.config.relation !== object.name)
      await getObject(db, tenant, String(field.config.relation));
}
function recordSummaryConfigurationLock(
  db: D1Database,
  changed: boolean,
): D1PreparedStatement[] {
  return changed && dialectFor(db).name === "postgres"
    ? [db.prepare("LOCK TABLE studio_records IN SHARE ROW EXCLUSIVE MODE")]
    : [];
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
  const object = { ...objectSchema.parse(input), version: 1 } as StudioObject;
  await validateMetadataRelations(db, tenant, object);
  if (
    await db
      .prepare("SELECT 1 FROM studio_objects WHERE tenant_id=? AND name=?")
      .bind(tenant, object.name)
      .first()
  )
    return fail("Ya existe un objeto con ese identificador.", 409);
  await transaction(db, [
    ...recordSummaryConfigurationLock(
      db,
      Boolean(object.config.performance?.summaries.length),
    ),
    db
      .prepare(
        "INSERT INTO studio_objects(tenant_id,name,label,description,config,version) VALUES (?,?,?,?,?,1)",
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
        "INSERT INTO studio_schema_versions(tenant_id,object_name,version,definition) VALUES (?,?,1,?)",
      )
      .bind(tenant, object.name, JSON.stringify(object)),
    audit(db, tenant, "object.created", object.name, null, object),
    ...(await recordIndexStatements(
      db,
      tenant,
      object.name,
      [],
      object.config.performance?.indexes,
    )),
    ...(object.config.performance?.summaries.length
      ? summaryConfigurationStatements(
          db,
          tenant,
          object.name,
          object.config.performance.summaries,
        )
      : []),
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
    next = objectSchema.parse({ ...(input as object), name }) as StudioObject,
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
      "SELECT * FROM studio_records WHERE tenant_id=? AND object_name=? AND deleted_at IS NULL",
    )
    .bind(tenant, name)
    .all<any>();
  const archived =
    restoreVersion !== undefined
      ? (
          await db
            .prepare(
              "SELECT record_id,data FROM studio_schema_data WHERE tenant_id=? AND object_name=? AND version=?",
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
        if (["Number", "Currency", "Percentage", "Rating"].includes(field.type))
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
    "SELECT version=? FROM studio_objects WHERE tenant_id=? AND name=?",
    [previous.version, tenant, name],
  );
  const count = guard(
    db,
    "SELECT count(*)=? FROM studio_records WHERE tenant_id=? AND object_name=? AND deleted_at IS NULL",
    [records.length, tenant, name],
  );
  const relationGuards: D1PreparedStatement[] = [];
  for (const record of records)
    relationGuards.push(
      ...(await checkRelations(db, tenant, next, record.after)),
    );
  const statements = [
    ...recordSummaryConfigurationLock(
      db,
      JSON.stringify(previous.config.performance?.summaries ?? []) !==
        JSON.stringify(next.config.performance?.summaries ?? []),
    ),
    g.start,
    count.start,
    ...relationGuards,
    db
      .prepare(
        "INSERT INTO studio_schema_versions(tenant_id,object_name,version,definition) VALUES (?,?,?,?) ON CONFLICT DO NOTHING",
      )
      .bind(tenant, name, previous.version, JSON.stringify(previous)),
    db
      .prepare(
        "DELETE FROM studio_unique_values WHERE tenant_id=? AND object_name=?",
      )
      .bind(tenant, name),
  ];
  for (const record of records) {
    const rg = guard(
      db,
      "SELECT version=? FROM studio_records WHERE tenant_id=? AND id=?",
      [record.row.version, tenant, record.row.id],
    );
    statements.push(
      rg.start,
      db
        .prepare(
          "INSERT INTO studio_schema_data(tenant_id,object_name,version,record_id,data) VALUES (?,?,?,?,?) ON CONFLICT(tenant_id,object_name,version,record_id) DO UPDATE SET data=excluded.data",
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
          "UPDATE studio_records SET data=?,version=version+1,updated_at=? WHERE tenant_id=? AND id=?",
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
        "UPDATE studio_objects SET label=?,description=?,config=?,version=? WHERE tenant_id=? AND name=?",
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
        "INSERT INTO studio_schema_versions(tenant_id,object_name,version,definition) VALUES (?,?,?,?)",
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
  statements.push(
    ...(await recordIndexStatements(
      db,
      tenant,
      name,
      previous.config.performance?.indexes,
      next.config.performance?.indexes,
    )),
  );
  if (
    JSON.stringify(previous.config.performance?.summaries ?? []) !==
    JSON.stringify(next.config.performance?.summaries ?? [])
  )
    statements.push(
      ...summaryConfigurationStatements(
        db,
        tenant,
        name,
        next.config.performance?.summaries ?? [],
      ),
    );
  await transaction(db, statements);
  return definition;
}

export const recordPerformanceUpdateSchema = z
  .object({
    version: z.number().int().positive(),
    performance: recordPerformanceSchema,
  })
  .strict();

/** Change physical read configuration without rewriting collection records. */
export async function configureObjectPerformance(
  db: D1Database,
  tenant: string,
  name: string,
  input: unknown,
) {
  await assertLocalCollection(db, tenant, name);
  const body = recordPerformanceUpdateSchema.parse(input);
  const previous = await getObject(db, tenant, name);
  if (body.version !== previous.version)
    return fail(
      "Otra persona cambió la estructura. Recarga el diseñador.",
      409,
    );
  const next = objectSchema.parse({
    ...previous,
    version: body.version + 1,
    config: { ...previous.config, performance: body.performance },
  }) as StudioObject;
  const lock = guard(
    db,
    "SELECT version=? FROM studio_objects WHERE tenant_id=? AND name=?",
    [body.version, tenant, name],
  );
  const statements = [
    ...recordSummaryConfigurationLock(
      db,
      JSON.stringify(previous.config.performance?.summaries ?? []) !==
        JSON.stringify(next.config.performance?.summaries ?? []),
    ),
    lock.start,
    ...(await recordIndexStatements(
      db,
      tenant,
      name,
      previous.config.performance?.indexes,
      next.config.performance?.indexes,
    )),
    ...(JSON.stringify(previous.config.performance?.summaries ?? []) !==
    JSON.stringify(next.config.performance?.summaries ?? [])
      ? summaryConfigurationStatements(
          db,
          tenant,
          name,
          next.config.performance?.summaries ?? [],
        )
      : []),
    db
      .prepare(
        "UPDATE studio_objects SET config=?,version=? WHERE tenant_id=? AND name=?",
      )
      .bind(JSON.stringify(next.config), next.version, tenant, name),
    audit(db, tenant, "object.performance_updated", name, null, {
      before: previous.config.performance,
      after: next.config.performance,
    }),
    lock.end,
  ];
  await transaction(db, statements);
  return next;
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
    "SELECT version=? FROM studio_objects WHERE tenant_id=? AND name=?",
    [object.version ?? 1, tenant, name],
  );
  await transaction(db, [
    g.start,
    db
      .prepare(
        "UPDATE studio_objects SET label=?, config=?, version=? WHERE tenant_id=? AND name=?",
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
  } as StudioObject;
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
    .prepare("SELECT name FROM studio_objects WHERE tenant_id=?")
    .bind(tenant)
    .all<{ name: string }>();
  const known = new Set(results.map((row) => row.name));
  const reorderable = unique.filter((name) => known.has(name));
  const updated: StudioObject[] = [];
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
  object: StudioObject,
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
      "SELECT count(*) AS total FROM studio_records WHERE tenant_id=? AND object_name=?",
    )
    .bind(tenant, object.name)
    .first<{ total: number }>();
  if ((records?.total ?? 0) > 0 && !options.allowRecords)
    return fail(
      "Esta pantalla tiene registros. Confirma la eliminación de los datos para continuar.",
      409,
    );
  const { results } = await db
    .prepare("SELECT name,config FROM studio_objects WHERE tenant_id=?")
    .bind(tenant)
    .all<{ name: string; config: string }>();
  for (const row of results) {
    if (row.name === object.name) continue;
    const config = JSON.parse(row.config) as StudioObject["config"];
    for (const field of Object.values(config.fields ?? {})) {
      if (field.config?.relation === object.name)
        return fail(
          `Quita la relación en «${row.name}» antes de eliminar esta pantalla.`,
          409,
        );
    }
  }
  if (await tableExists(db, "studio_collection_relations")) {
    const incoming = await db
      .prepare(
        "SELECT source_object FROM studio_collection_relations WHERE tenant_id=? AND target_object=? AND source_object<>? LIMIT 1",
      )
      .bind(tenant, object.name, object.name)
      .first<{ source_object: string }>();
    if (incoming)
      return fail(
        `Quita la relación en «${incoming.source_object}» antes de eliminar esta pantalla.`,
        409,
      );
  }
  return records?.total ?? 0;
}

async function tableExists(db: D1Database, name: string) {
  return Boolean(
    await db
      .prepare(dialectFor(db).tableExists(name).sql)
      .bind(...dialectFor(db).tableExists(name).parameters)
      .first(),
  );
}

const MAX_SCREEN_DELETION_SCOPE = 100;

type DeletionObjectRow = {
  name: string;
  label: string;
  description: string;
  config: string;
  version: number;
};

type CollectionRelationRow = {
  id: string;
  source_object: string;
  target_object: string;
  storage: string;
  version: number;
};

function screenDeletionBlocker(row: DeletionObjectRow): string | null {
  const config = JSON.parse(row.config) as StudioObject["config"];
  if (config.studio?.collection)
    return "Desvincula la colección desde Fuentes y colecciones antes de eliminar la pantalla.";
  if (
    ["managed-agency", "managed-customer"].includes(
      config.studio?.business ?? "",
    )
  )
    return "Esta pantalla administrada no se puede eliminar aquí.";
  return null;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function screenDeletionSnapshot(
  db: D1Database,
  tenant: string,
  root: string,
) {
  const { results: objectRows } = await db
    .prepare(
      `SELECT name,label,description,${dialectFor(db).name === "postgres" ? "config::text" : "config"} AS config,version FROM studio_objects WHERE tenant_id=? ORDER BY name`,
    )
    .bind(tenant)
    .all<DeletionObjectRow>();
  const objects = new Map(objectRows.map((row) => [row.name, row]));
  const rootObject = objects.get(root);
  if (!rootObject) return fail("El objeto no existe.", 404);
  const hasRelations = await tableExists(db, "studio_collection_relations");
  const hasLinks = await tableExists(db, "studio_record_links");
  const relations = hasRelations
    ? (
        await db
          .prepare(
            "SELECT id,source_object,target_object,storage,version FROM studio_collection_relations WHERE tenant_id=? ORDER BY id",
          )
          .bind(tenant)
          .all<CollectionRelationRow>()
      ).results
    : [];
  const inboundByTarget = new Map<string, Set<string>>();
  for (const row of objectRows) {
    const config = JSON.parse(row.config) as StudioObject["config"];
    for (const field of Object.values(config.fields ?? {})) {
      const relation = field.config?.relation;
      if (typeof relation !== "string") continue;
      const incoming = inboundByTarget.get(relation) ?? new Set<string>();
      incoming.add(row.name);
      inboundByTarget.set(relation, incoming);
    }
  }
  for (const relation of relations) {
    const incoming =
      inboundByTarget.get(relation.target_object) ?? new Set<string>();
    incoming.add(relation.source_object);
    inboundByTarget.set(relation.target_object, incoming);
  }

  const closure = new Set<string>([root]);
  const queue = [root];
  while (queue.length) {
    const current = queue.shift()!;
    for (const dependent of inboundByTarget.get(current) ?? []) {
      if (!objects.has(dependent) || closure.has(dependent)) continue;
      closure.add(dependent);
      if (closure.size > MAX_SCREEN_DELETION_SCOPE)
        return fail(
          `La eliminación alcanza más de ${MAX_SCREEN_DELETION_SCOPE} pantallas; reduce las dependencias antes de continuar.`,
          413,
        );
      queue.push(dependent);
    }
  }
  const names = [...closure].sort();
  const screens = [];
  const recordRevisions = new Map<string, number>();
  for (const name of names) {
    const row = objects.get(name)!;
    const result = await db
      .prepare(
        "SELECT count(*) AS total FROM studio_records WHERE tenant_id=? AND object_name=?",
      )
      .bind(tenant, name)
      .first<{ total: number }>();
    screens.push({
      name,
      label: row.label,
      recordCount: Number(result?.total ?? 0),
      blockedReason: screenDeletionBlocker(row),
    });
    const revision = await db
      .prepare(
        "SELECT revision FROM studio_record_counts WHERE tenant_id=? AND object_name=?",
      )
      .bind(tenant, name)
      .first<{ revision: number }>();
    recordRevisions.set(name, Number(revision?.revision ?? 0));
  }
  const closureNames = new Set(names);
  const scopedRelations = relations.filter(
    (relation) =>
      closureNames.has(relation.source_object) ||
      closureNames.has(relation.target_object),
  );
  const relationLinkCounts: Array<[string, number]> = [];
  if (hasLinks) {
    for (const relation of scopedRelations) {
      const count = await db
        .prepare(
          "SELECT count(*) AS total FROM studio_record_links WHERE tenant_id=? AND relation_id=?",
        )
        .bind(tenant, relation.id)
        .first<{ total: number }>();
      relationLinkCounts.push([relation.id, Number(count?.total ?? 0)]);
    }
  }
  const token = await sha256({
    tenant,
    root,
    closure: names,
    // Include all tenant object configs so a newly added inbound dependency invalidates confirmation.
    objectScope: objectRows.map((row) => [
      row.name,
      row.label,
      row.config,
      row.version,
    ]),
    screens: screens.map((screen) => [
      screen.name,
      screen.recordCount,
      recordRevisions.get(screen.name),
    ]),
    relations,
    links: relationLinkCounts,
  });
  return {
    preview: {
      root,
      screens,
      totalRecords: screens.reduce(
        (total, screen) => total + screen.recordCount,
        0,
      ),
      token,
    } satisfies ScreenDeletionPreview,
    objectRows,
    relations,
    closureNames: names,
    recordRevisions,
    relationLinkCounts,
    hasRelations,
    hasLinks,
  };
}

export async function previewScreenDeletion(
  db: D1Database,
  tenant: string,
  name: string,
): Promise<ScreenDeletionPreview> {
  return (await screenDeletionSnapshot(db, tenant, name)).preview;
}

async function deleteObjectDataStatements(
  db: D1Database,
  tenant: string,
  name: string,
) {
  const statements: D1PreparedStatement[] = [];
  if (await tableExists(db, "studio_record_links")) {
    statements.push(
      db
        .prepare(
          "DELETE FROM studio_record_links WHERE tenant_id=? AND (source_id IN (SELECT id FROM studio_records WHERE tenant_id=? AND object_name=?) OR target_id IN (SELECT id FROM studio_records WHERE tenant_id=? AND object_name=?))",
        )
        .bind(tenant, tenant, name, tenant, name),
    );
  }
  if (await tableExists(db, "studio_collection_relations")) {
    if (await tableExists(db, "studio_record_links"))
      statements.push(
        db
          .prepare(
            "DELETE FROM studio_record_links WHERE tenant_id=? AND relation_id IN (SELECT id FROM studio_collection_relations WHERE tenant_id=? AND (source_object=? OR target_object=?))",
          )
          .bind(tenant, tenant, name, name),
      );
    statements.push(
      db
        .prepare(
          "DELETE FROM studio_collection_relations WHERE tenant_id=? AND (source_object=? OR target_object=?)",
        )
        .bind(tenant, name, name),
    );
  }
  for (const table of [
    "studio_business_links",
    "studio_file_drafts",
    "studio_files",
    "studio_notes",
    "studio_tasks",
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
        "DELETE FROM studio_automation_runs WHERE tenant_id=? AND object_name=?",
      )
      .bind(tenant, name),
    db
      .prepare(
        "DELETE FROM studio_automations WHERE tenant_id=? AND object_name=?",
      )
      .bind(tenant, name),
    db
      .prepare("DELETE FROM studio_views WHERE tenant_id=? AND object_name=?")
      .bind(tenant, name),
    db
      .prepare(
        "DELETE FROM studio_schema_data WHERE tenant_id=? AND object_name=?",
      )
      .bind(tenant, name),
    db
      .prepare(
        "DELETE FROM studio_schema_versions WHERE tenant_id=? AND object_name=?",
      )
      .bind(tenant, name),
    db
      .prepare(
        "DELETE FROM studio_unique_values WHERE tenant_id=? AND object_name=?",
      )
      .bind(tenant, name),
    db
      .prepare("DELETE FROM studio_records WHERE tenant_id=? AND object_name=?")
      .bind(tenant, name),
    ...((await tableExists(db, "studio_record_history"))
      ? [
          db
            .prepare(
              "DELETE FROM studio_record_history WHERE tenant_id=? AND object_name=?",
            )
            .bind(tenant, name),
        ]
      : []),
    ...((await tableExists(db, "studio_record_read_cache"))
      ? [
          db
            .prepare(
              "DELETE FROM studio_record_read_cache WHERE tenant_id=? AND object_name=?",
            )
            .bind(tenant, name),
        ]
      : []),
    ...((await tableExists(db, "studio_record_counts"))
      ? [
          db
            .prepare(
              "DELETE FROM studio_record_counts WHERE tenant_id=? AND object_name=?",
            )
            .bind(tenant, name),
        ]
      : []),
    ...((await tableExists(db, "studio_record_summary_definitions"))
      ? [
          db
            .prepare(
              "DELETE FROM studio_record_summary_definitions WHERE tenant_id=? AND object_name=?",
            )
            .bind(tenant, name),
        ]
      : []),
    ...((await tableExists(db, "studio_record_summary_groups"))
      ? [
          db
            .prepare(
              "DELETE FROM studio_record_summary_groups WHERE tenant_id=? AND object_name=?",
            )
            .bind(tenant, name),
        ]
      : []),
    ...((await tableExists(db, "studio_solution_objects"))
      ? [
          db
            .prepare(
              "DELETE FROM studio_solution_objects WHERE tenant_id=? AND object_name=?",
            )
            .bind(tenant, name),
        ]
      : []),
  );
  return statements;
}

export async function deleteObject(
  db: D1Database,
  tenant: string,
  name: string,
  options: {
    deleteRecords?: boolean;
    deleteRelated?: boolean;
    deletionToken?: string;
  } = {},
) {
  if (options.deleteRelated || options.deletionToken) {
    const cascade = Boolean(options.deleteRelated);
    if (cascade && (!options.deleteRecords || !options.deletionToken))
      return fail(
        "Confirma la eliminación de los registros y proporciona la vista previa vigente.",
        422,
      );
    if (!options.deletionToken)
      return fail("Se necesita la vista previa de eliminación.", 422);
    const snapshot = await screenDeletionSnapshot(db, tenant, name);
    if (snapshot.preview.token !== options.deletionToken)
      return fail(
        "La vista previa cambió. Recárgala antes de confirmar la eliminación.",
        409,
      );
    if (!cascade && snapshot.preview.screens.length > 1)
      return fail(
        "Hay pantallas dependientes. Confirma su eliminación desde la vista previa o quita sus relaciones.",
        409,
      );
    const blocked = snapshot.preview.screens.find(
      (screen) => screen.blockedReason,
    );
    if (blocked)
      return fail(
        `No se puede eliminar «${blocked.label}»: ${blocked.blockedReason}`,
        409,
      );
    if (
      !cascade &&
      !options.deleteRecords &&
      (snapshot.preview.screens[0]?.recordCount ?? 0) > 0
    )
      return fail(
        "Esta pantalla tiene registros. Confirma la eliminación de los datos para continuar.",
        409,
      );
    const {
      closureNames: allClosureNames,
      objectRows,
      relations,
      hasRelations,
      hasLinks,
      recordRevisions,
      relationLinkCounts,
    } = snapshot;
    const closureNames = cascade ? allClosureNames : [name];
    const byName = new Map(objectRows.map((row) => [row.name, row]));
    const statements: D1PreparedStatement[] = [];
    const guardEnds: D1PreparedStatement[] = [];
    if (dialectFor(db).name === "postgres") {
      statements.push(
        db.prepare("LOCK TABLE studio_objects IN SHARE ROW EXCLUSIVE MODE"),
        db.prepare("LOCK TABLE studio_records IN SHARE ROW EXCLUSIVE MODE"),
      );
      if (hasRelations)
        statements.push(
          db.prepare(
            "LOCK TABLE studio_collection_relations IN SHARE ROW EXCLUSIVE MODE",
          ),
        );
      if (hasLinks)
        statements.push(
          db.prepare(
            "LOCK TABLE studio_record_links IN SHARE ROW EXCLUSIVE MODE",
          ),
        );
    }
    const objectCount = guard(
      db,
      "SELECT count(*)=? FROM studio_objects WHERE tenant_id=?",
      [objectRows.length, tenant],
    );
    statements.push(objectCount.start);
    guardEnds.push(objectCount.end);
    for (const row of objectRows) {
      const versionGuard = guard(
        db,
        dialectFor(db).name === "postgres"
          ? "SELECT version=? AND label=? AND config::jsonb=?::jsonb FROM studio_objects WHERE tenant_id=? AND name=?"
          : "SELECT version=? AND label=? AND config=? FROM studio_objects WHERE tenant_id=? AND name=?",
        [row.version, row.label, row.config, tenant, row.name],
      );
      statements.push(versionGuard.start);
      guardEnds.push(versionGuard.end);
    }
    for (const screen of snapshot.preview.screens) {
      const recordGuard = guard(
        db,
        "SELECT count(*)=? FROM studio_records WHERE tenant_id=? AND object_name=?",
        [screen.recordCount, tenant, screen.name],
      );
      statements.push(recordGuard.start);
      guardEnds.push(recordGuard.end);
      const revisionGuard = guard(
        db,
        "SELECT COALESCE((SELECT revision FROM studio_record_counts WHERE tenant_id=? AND object_name=?),0)=?",
        [tenant, screen.name, recordRevisions.get(screen.name) ?? 0],
      );
      statements.push(revisionGuard.start);
      guardEnds.push(revisionGuard.end);
    }
    if (hasRelations) {
      const relationCount = guard(
        db,
        "SELECT count(*)=? FROM studio_collection_relations WHERE tenant_id=?",
        [relations.length, tenant],
      );
      statements.push(relationCount.start);
      guardEnds.push(relationCount.end);
      for (const relation of relations) {
        const relationGuard = guard(
          db,
          "SELECT count(*)=1 FROM studio_collection_relations WHERE tenant_id=? AND id=? AND source_object=? AND target_object=? AND version=?",
          [
            tenant,
            relation.id,
            relation.source_object,
            relation.target_object,
            relation.version,
          ],
        );
        statements.push(relationGuard.start);
        guardEnds.push(relationGuard.end);
      }
      if (hasLinks)
        for (const [relationId, count] of relationLinkCounts) {
          const linkGuard = guard(
            db,
            "SELECT count(*)=? FROM studio_record_links WHERE tenant_id=? AND relation_id=?",
            [count, tenant, relationId],
          );
          statements.push(linkGuard.start);
          guardEnds.push(linkGuard.end);
        }
    }
    const dropIndexes = await Promise.all(
      closureNames.map((objectName) => {
        const object = byName.get(objectName)!;
        const config = JSON.parse(object.config) as StudioObject["config"];
        return recordIndexStatements(
          db,
          tenant,
          objectName,
          config.performance?.indexes,
          [],
        );
      }),
    );
    statements.push(...dropIndexes.flat());
    for (const objectName of closureNames) {
      statements.push(
        ...(await deleteObjectDataStatements(db, tenant, objectName)),
      );
      statements.push(
        db
          .prepare("DELETE FROM studio_objects WHERE tenant_id=? AND name=?")
          .bind(tenant, objectName),
        audit(db, tenant, "object.deleted", objectName, null, {
          label: byName.get(objectName)!.label,
          deletedRecords:
            snapshot.preview.screens.find(
              (screen) => screen.name === objectName,
            )?.recordCount ?? 0,
          cascadeRoot: name,
        }),
      );
    }
    statements.push(...guardEnds);
    await transaction(db, statements);
    return {
      name,
      deleted: true,
      deletedRecords: options.deleteRecords ? snapshot.preview.totalRecords : 0,
      deletedObjects: closureNames,
    };
  }
  const object = await getObject(db, tenant, name);
  const recordCount = await assertObjectCanBeDeleted(db, tenant, object, {
    allowRecords: options.deleteRecords,
  });
  const cascadeData = Boolean(options.deleteRecords && recordCount > 0);
  const dropIndexes = await recordIndexStatements(
    db,
    tenant,
    name,
    object.config.performance?.indexes,
    [],
  );
  const statements = [
    ...dropIndexes,
    ...(await deleteObjectDataStatements(db, tenant, name)),
    db
      .prepare("DELETE FROM studio_objects WHERE tenant_id=? AND name=?")
      .bind(tenant, name),
    audit(db, tenant, "object.deleted", name, null, {
      label: object.label,
      deletedRecords: cascadeData ? recordCount : 0,
    }),
  ];
  if (!cascadeData) {
    const empty = guard(
      db,
      "SELECT count(*)=0 FROM studio_records WHERE tenant_id=? AND object_name=?",
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
    deletedObjects: [name],
  };
}
