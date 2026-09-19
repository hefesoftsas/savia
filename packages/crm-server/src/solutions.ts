import { dialectFor } from "@savia/db/dialect";
import type { Hono } from "hono";
import { z } from "zod";
import { bodyLimit } from "hono/body-limit";
import {
  solutionPackageSchema,
  canonicalJson,
  compareSolutionVersions,
  type SolutionPackage,
} from "@savia/crm-shared/solution-package";
import type { ExtensionRegistry } from "@savia/crm-shared/extension-package";
import { type Env, fail } from "./context";
import { audit, guard, transaction } from "./services";
import { isExtensionAvailable } from "./extensions";

export type SolutionOptions = {
  solutionCatalog?: readonly unknown[];
  extensionRegistry?: ExtensionRegistry;
  beforeInstall?: (manifest: SolutionPackage) => Promise<void>;
};
type Installation = {
  id: string;
  version: string;
  enabled: number;
  manifest: string;
};
type StoredObject = {
  name: string;
  label: string;
  description: string;
  config: string;
  version: number;
  solution_id: string | null;
  definition: string | null;
};
const definition = (o: SolutionPackage["objects"][number]) => ({
  name: o.name,
  label: o.label,
  description: o.description ?? "",
  config: o.config,
});

export { isSolutionEnabled, disabledSolutionObjects } from "./solution-state";
import { isSolutionEnabled, disabledSolutionObjects } from "./solution-state";

async function inspect(
  db: D1Database,
  tenant: string,
  input: unknown,
  options: SolutionOptions,
) {
  const manifest = solutionPackageSchema.parse(input);
  const installed = await db
    .prepare(
      "SELECT id,version,enabled,manifest FROM crm_solution_installations WHERE tenant_id=? AND id=?",
    )
    .bind(tenant, manifest.id)
    .first<Installation>();
  const { results: rows } = await db
    .prepare(
      "SELECT o.name,o.label,o.description,o.config,o.version,p.solution_id,p.definition FROM crm_objects o LEFT JOIN crm_solution_objects p ON p.tenant_id=o.tenant_id AND p.object_name=o.name WHERE o.tenant_id=?",
    )
    .bind(tenant)
    .all<StoredObject>();
  const current = new Map(rows.map((row) => [row.name, row]));
  const { results: ownershipRows } = await db
    .prepare(
      "SELECT object_name,solution_id FROM crm_solution_objects WHERE tenant_id=?",
    )
    .bind(tenant)
    .all<{ object_name: string; solution_id: string }>();
  const ownership = new Map(
    ownershipRows.map((row) => [row.object_name, row.solution_id]),
  );
  const conflicts: string[] = [];
  const dependencies: string[] = [];
  for (const id of manifest.requires) {
    if (await isExtensionAvailable(db, tenant, id, options.extensionRegistry))
      continue;
    if (id === manifest.id || !(await isSolutionEnabled(db, tenant, id)))
      conflicts.push(`Dependencia no disponible: ${id}.`);
    else dependencies.push(id);
  }
  if (installed) {
    const order = compareSolutionVersions(manifest.version, installed.version);
    if (order < 0) conflicts.push("No se puede instalar una versión anterior.");
    if (
      order === 0 &&
      canonicalJson(JSON.parse(installed.manifest)) !== canonicalJson(manifest)
    )
      conflicts.push(
        "Esta versión ya está instalada con otro contenido. Publica una versión nueva.",
      );
    const previous = solutionPackageSchema.parse(
      JSON.parse(installed.manifest),
    );
    for (const object of previous.objects)
      if (!manifest.objects.some((o) => o.name === object.name))
        conflicts.push(`La actualización elimina el objeto ${object.name}.`);
  }
  const disabled = await disabledSolutionObjects(db, tenant);
  const objects = manifest.objects.map((object) => {
    const row = current.get(object.name);
    let action: "create" | "update" | "keep" = row ? "keep" : "create";
    const owner = ownership.get(object.name);
    if (!row && owner === manifest.id)
      conflicts.push(
        `El objeto ${object.name} del paquete fue eliminado. Debes restaurarlo antes de instalar o actualizar.`,
      );
    if (!row && owner && owner !== manifest.id)
      conflicts.push(
        `El objeto ${object.name} pertenece al paquete ${owner}, aunque su definición fue eliminada.`,
      );
    if (row && row.solution_id !== manifest.id)
      conflicts.push(
        `El objeto ${object.name} ya existe y no pertenece a este paquete.`,
      );
    if (
      row &&
      row.solution_id === manifest.id &&
      installed?.version !== manifest.version
    ) {
      const actual = definition({ ...row, config: JSON.parse(row.config) });
      if (canonicalJson(actual) !== canonicalJson(JSON.parse(row.definition!)))
        conflicts.push(
          `El objeto ${object.name} tiene personalizaciones. Conserva o integra esos cambios antes de actualizar.`,
        );
      if (canonicalJson(actual) !== canonicalJson(definition(object))) {
        action = "update";
        const before = actual.config.fields;
        for (const [name, field] of Object.entries(before))
          if (
            canonicalJson(field) !==
            canonicalJson(object.config.fields[name] ?? null)
          )
            conflicts.push(
              `La actualización modifica o elimina el campo ${object.name}.${name}; requiere una migración específica.`,
            );
        for (const [name, field] of Object.entries(object.config.fields))
          if (
            !before[name] &&
            (field.required ||
              field.config?.unique ||
              field.config?.requiredWhen)
          )
            conflicts.push(
              `El campo nuevo ${object.name}.${name} debe ser opcional y no único.`,
            );
      }
    }
    for (const field of Object.values(object.config.fields)) {
      const relation = field.config?.relation;
      const relationOwner = relation ? ownership.get(relation) : undefined;
      if (
        relation &&
        relationOwner &&
        relationOwner !== manifest.id &&
        !manifest.requires.includes(relationOwner)
      )
        conflicts.push(
          `La relación ${object.name} → ${relation} requiere declarar la dependencia ${relationOwner}.`,
        );
      if (
        relation &&
        !manifest.objects.some((o) => o.name === relation) &&
        (!current.has(String(relation)) || disabled.has(String(relation)))
      )
        conflicts.push(`Relación no disponible: ${object.name} → ${relation}.`);
    }
    return { name: object.name, label: object.label, action };
  });
  return {
    manifest,
    installed,
    current,
    dependencies,
    preview: {
      id: manifest.id,
      version: manifest.version,
      objects,
      conflicts,
      canInstall: conflicts.length === 0,
    },
  };
}

export async function installSolution(
  db: D1Database,
  tenant: string,
  input: unknown,
  options: SolutionOptions = {},
) {
  const { manifest, installed, current, dependencies, preview } = await inspect(
    db,
    tenant,
    input,
    options,
  );
  if (!preview.canInstall) return fail(preview.conflicts.join(" "), 409);
  await options.beforeInstall?.(manifest);
  if (installed?.version === manifest.version)
    return {
      id: manifest.id,
      version: manifest.version,
      enabled: !!installed.enabled,
    };
  const statements: D1PreparedStatement[] = [],
    ends: D1PreparedStatement[] = [];
  const addGuard = (query: string, args: unknown[]) => {
    const g = guard(db, query, args);
    statements.push(g.start);
    ends.push(g.end);
  };
  addGuard(
    installed
      ? "SELECT manifest=? AND enabled=? FROM crm_solution_installations WHERE tenant_id=? AND id=?"
      : "SELECT count(*)=0 FROM crm_solution_installations WHERE tenant_id=? AND id=?",
    installed
      ? [installed.manifest, installed.enabled, tenant, manifest.id]
      : [tenant, manifest.id],
  );
  for (const id of dependencies)
    addGuard(
      "SELECT enabled=1 FROM crm_solution_installations WHERE tenant_id=? AND id=?",
      [tenant, id],
    );
  for (const id of manifest.requires)
    if (
      options.extensionRegistry?.get(id) &&
      !options.extensionRegistry.isBuiltIn(id)
    )
      addGuard(
        "SELECT enabled=1 FROM crm_extension_installations WHERE tenant_id=? AND id=?",
        [tenant, id],
      );
  statements.push(
    db
      .prepare(
        `INSERT INTO crm_solution_installations(tenant_id,id,version,enabled,manifest) VALUES (?,?,?,1,?) ON CONFLICT(tenant_id,id) DO UPDATE SET version=excluded.version,manifest=excluded.manifest,updated_at=${dialectFor(db).utcNow()}`,
      )
      .bind(tenant, manifest.id, manifest.version, JSON.stringify(manifest)),
  );
  for (const entry of preview.objects) {
    const object = manifest.objects.find((o) => o.name === entry.name)!;
    const row = current.get(entry.name);
    if (entry.action === "keep") continue;
    if (row)
      addGuard(
        "SELECT solution_id=? FROM crm_solution_objects WHERE tenant_id=? AND object_name=?",
        [manifest.id, tenant, entry.name],
      );
    else
      addGuard(
        "SELECT count(*)=0 FROM crm_solution_objects WHERE tenant_id=? AND object_name=?",
        [tenant, entry.name],
      );
    if (row)
      addGuard(
        "SELECT version=? AND config=? AND label=? AND description=? FROM crm_objects WHERE tenant_id=? AND name=?",
        [
          row.version,
          row.config,
          row.label,
          row.description,
          tenant,
          entry.name,
        ],
      );
    else
      addGuard(
        "SELECT count(*)=0 FROM crm_objects WHERE tenant_id=? AND name=?",
        [tenant, entry.name],
      );
    const version = (row?.version ?? 0) + 1;
    statements.push(
      db
        .prepare(
          "INSERT INTO crm_objects(tenant_id,name,label,description,config,version) VALUES (?,?,?,?,?,?) ON CONFLICT(tenant_id,name) DO UPDATE SET label=excluded.label,description=excluded.description,config=excluded.config,version=excluded.version",
        )
        .bind(
          tenant,
          object.name,
          object.label,
          object.description,
          JSON.stringify(object.config),
          version,
        ),
    );
    statements.push(
      db
        .prepare(
          "INSERT INTO crm_schema_versions(tenant_id,object_name,version,definition) VALUES (?,?,?,?)",
        )
        .bind(
          tenant,
          object.name,
          version,
          JSON.stringify({ ...definition(object), version }),
        ),
    );
    statements.push(
      db
        .prepare(
          "INSERT INTO crm_solution_objects(tenant_id,solution_id,object_name,definition) VALUES (?,?,?,?) ON CONFLICT(tenant_id,object_name) DO UPDATE SET definition=excluded.definition",
        )
        .bind(
          tenant,
          manifest.id,
          object.name,
          canonicalJson(definition(object)),
        ),
    );
  }
  statements.push(
    audit(
      db,
      tenant,
      installed ? "solution.updated" : "solution.installed",
      manifest.id,
      null,
      { version: manifest.version },
    ),
    ...ends,
  );
  await transaction(db, statements);
  return {
    id: manifest.id,
    version: manifest.version,
    enabled: installed ? !!installed.enabled : true,
  };
}

export function registerSolutions(
  app: Hono<Env>,
  options: SolutionOptions = {},
) {
  app.use(
    "/api/solutions/*",
    bodyLimit({
      maxSize: 2 * 1024 * 1024,
      onError: (c) => c.json({ error: "Máximo 2 MB por paquete." }, 413),
    }),
  );
  app.get("/api/solutions", async (c) => {
    const { results } = await c.env.DB.prepare(
      "SELECT id,version,enabled,manifest FROM crm_solution_installations WHERE tenant_id=? ORDER BY id",
    )
      .bind(c.get("tenant"))
      .all<Installation>();
    const catalog = new Map(
      (options.solutionCatalog ?? []).map((input) => {
        const m = solutionPackageSchema.parse(input);
        return [m.id, m];
      }),
    );
    for (const row of results)
      if (!catalog.has(row.id)) catalog.set(row.id, JSON.parse(row.manifest));
    return c.json({
      data: [...catalog.values()].map((manifest) => {
        const row = results.find((r) => r.id === manifest.id);
        return {
          manifest,
          installed: row
            ? { version: row.version, enabled: !!row.enabled }
            : null,
        };
      }),
    });
  });
  app.post("/api/solutions/preview", async (c) =>
    c.json({
      data: (
        await inspect(c.env.DB, c.get("tenant"), await c.req.json(), options)
      ).preview,
    }),
  );
  app.post("/api/solutions/install", async (c) =>
    c.json({
      data: await installSolution(
        c.env.DB,
        c.get("tenant"),
        await c.req.json(),
        options,
      ),
    }),
  );
  app.get("/api/solutions/:id/export", async (c) => {
    const row = await c.env.DB.prepare(
      "SELECT manifest FROM crm_solution_installations WHERE tenant_id=? AND id=?",
    )
      .bind(c.get("tenant"), c.req.param("id"))
      .first<{ manifest: string }>();
    if (!row) return fail("El paquete no está instalado en este espacio.", 404);
    c.header(
      "content-disposition",
      'attachment; filename="solution.savia.json"',
    );
    c.header("cache-control", "no-store");
    return c.json(JSON.parse(row.manifest));
  });
  app.patch("/api/solutions/:id", async (c) => {
    const { enabled } = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(await c.req.json());
    const db = c.env.DB,
      tenant = c.get("tenant"),
      id = c.req.param("id");
    const row = await db
      .prepare(
        "SELECT id,version,enabled,manifest FROM crm_solution_installations WHERE tenant_id=? AND id=?",
      )
      .bind(tenant, id)
      .first<Installation>();
    if (!row) return fail("El paquete no está instalado en este espacio.", 404);
    const manifest = solutionPackageSchema.parse(JSON.parse(row.manifest));
    if (enabled)
      for (const dependency of manifest.requires)
        if (
          !(await isExtensionAvailable(
            db,
            tenant,
            dependency,
            options.extensionRegistry,
          )) &&
          !(await isSolutionEnabled(db, tenant, dependency))
        )
          return fail(`Dependencia no disponible: ${dependency}.`, 409);
    if (!enabled) {
      const dependent = await db
        .prepare(
          `SELECT s.id FROM crm_solution_installations s,${dialectFor(db).jsonEach("s.manifest", "$.requires", "d")} WHERE s.tenant_id=? AND s.enabled=1 AND s.id!=? AND d.value=? LIMIT 1`,
        )
        .bind(tenant, id, id)
        .first<{ id: string }>();
      if (dependent)
        return fail(
          `Desactiva primero el paquete dependiente ${dependent.id}.`,
          409,
        );
    }
    const checks = [
      guard(
        db,
        "SELECT manifest=? AND enabled=? FROM crm_solution_installations WHERE tenant_id=? AND id=?",
        [row.manifest, row.enabled, tenant, id],
      ),
    ];
    if (enabled)
      for (const dependency of manifest.requires) {
        const extension = options.extensionRegistry?.get(dependency);
        if (extension && !extension.builtIn)
          checks.push(
            guard(
              db,
              "SELECT enabled=1 FROM crm_extension_installations WHERE tenant_id=? AND id=?",
              [tenant, dependency],
            ),
          );
        else if (
          !(await isExtensionAvailable(
            db,
            tenant,
            dependency,
            options.extensionRegistry,
          ))
        )
          checks.push(
            guard(
              db,
              "SELECT enabled=1 FROM crm_solution_installations WHERE tenant_id=? AND id=?",
              [tenant, dependency],
            ),
          );
      }
    else
      checks.push(
        guard(
          db,
          `SELECT count(*)=0 FROM crm_solution_installations s,${dialectFor(db).jsonEach("s.manifest", "$.requires", "d")} WHERE s.tenant_id=? AND s.enabled=1 AND s.id!=? AND d.value=?`,
          [tenant, id, id],
        ),
      );
    await transaction(db, [
      ...checks.map((g) => g.start),
      db
        .prepare(
          `UPDATE crm_solution_installations SET enabled=?,updated_at=${dialectFor(db).utcNow()} WHERE tenant_id=? AND id=?`,
        )
        .bind(enabled ? 1 : 0, tenant, id),
      audit(
        db,
        tenant,
        enabled ? "solution.enabled" : "solution.disabled",
        id,
        null,
        { version: row.version },
      ),
      ...checks.map((g) => g.end),
    ]);
    return c.json({ data: { id, version: row.version, enabled } });
  });
}
