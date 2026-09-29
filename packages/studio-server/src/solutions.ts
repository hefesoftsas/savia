import { dialectFor } from "@savia/db/dialect";
import type { Hono } from "hono";
import { z } from "zod";
import { bodyLimit } from "hono/body-limit";
import {
  solutionPackageSchema,
  canonicalJson,
  compareSolutionVersions,
  type SolutionPackage,
} from "@savia/studio-shared/solution-package";
import type {
  ExtensionObjectRequirement,
  ExtensionRegistry,
} from "@savia/studio-shared/extension-package";
import { type Env, fail } from "./context";
import { audit, guard, transaction } from "./services";
import { isExtensionAvailable } from "./extensions";
import { storeObjectRequirements, storePluginManifest } from "./plugin-store";

export type SolutionOptions = {
  solutionCatalog?: readonly unknown[];
  extensionRegistry?: ExtensionRegistry;
  extensionObjectRequirements?: readonly ExtensionObjectRequirement[];
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
type SolutionObject = SolutionPackage["objects"][number];
type ActivationDependency = {
  id: string;
  label: string;
  version: string;
  action: "install" | "enable" | "already_available" | "built_in";
  kind: "extension" | "solution";
  requires: string[];
};
const definition = (o: SolutionObject) => ({
  name: o.name,
  label: o.label,
  ...(o.labels ? { labels: o.labels } : {}),
  description: o.description ?? "",
  ...(o.descriptions ? { descriptions: o.descriptions } : {}),
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
      "SELECT id,version,enabled,manifest FROM studio_solution_installations WHERE tenant_id=? AND id=?",
    )
    .bind(tenant, manifest.id)
    .first<Installation>();
  const { results: rows } = await db
    .prepare(
      "SELECT o.name,o.label,o.description,o.config,o.version,p.solution_id,p.definition FROM studio_objects o LEFT JOIN studio_solution_objects p ON p.tenant_id=o.tenant_id AND p.object_name=o.name WHERE o.tenant_id=?",
    )
    .bind(tenant)
    .all<StoredObject>();
  const current = new Map(rows.map((row) => [row.name, row]));
  const { results: ownershipRows } = await db
    .prepare(
      "SELECT object_name,solution_id FROM studio_solution_objects WHERE tenant_id=?",
    )
    .bind(tenant)
    .all<{ object_name: string; solution_id: string }>();
  const ownership = new Map(
    ownershipRows.map((row) => [row.object_name, row.solution_id]),
  );
  const conflicts: string[] = [];
  const dependencies: string[] = [];
  const claims = new Set<string>();
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
  const objects: {
    name: string;
    label: string;
    action: "create" | "update" | "keep";
  }[] = [];
  for (const object of manifest.objects) {
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
    if (row && row.solution_id !== manifest.id) {
      const provisioned =
        row.solution_id === null &&
        (await isExactRequiredExtensionObject(
          db,
          tenant,
          manifest,
          object,
          row,
          options,
        ));
      if (provisioned) claims.add(object.name);
      else
        conflicts.push(
          `El objeto ${object.name} ya existe y no pertenece a este paquete.`,
        );
    }
    if (
      row &&
      row.solution_id === manifest.id &&
      installed?.version !== manifest.version
    ) {
      const stored = JSON.parse(row.definition!);
      // Translations ride in the stored definition; columns alone cannot
      // rebuild them, so reuse them here to avoid false customization flags.
      const actual = definition({
        ...row,
        ...(stored?.labels ? { labels: stored.labels } : {}),
        ...(stored?.descriptions ? { descriptions: stored.descriptions } : {}),
        config: JSON.parse(row.config) as SolutionObject["config"],
      } as SolutionObject);
      if (canonicalJson(actual) !== canonicalJson(stored))
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
    objects.push({ name: object.name, label: object.label, action });
  }
  return {
    manifest,
    installed,
    current,
    claims,
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

async function isExactRequiredExtensionObject(
  db: D1Database,
  tenant: string,
  manifest: SolutionPackage,
  object: SolutionObject,
  row: StoredObject,
  options: SolutionOptions,
) {
  for (const extensionId of manifest.requires) {
    const installed = await db
      .prepare(
        "SELECT 1 FROM studio_extension_installations WHERE tenant_id=? AND id=? AND enabled=1",
      )
      .bind(tenant, extensionId)
      .first();
    if (!installed) continue;
    const provisions = await db
      .prepare(
        "SELECT detail FROM studio_audit WHERE tenant_id=? AND action='extension.collection.provisioned' AND object_name=?",
      )
      .bind(tenant, object.name)
      .all<{ detail: string }>();
    const provisionedByDependency = provisions.results.some((entry) => {
      try {
        return JSON.parse(entry.detail).extensionId === extensionId;
      } catch {
        return false;
      }
    });
    if (!provisionedByDependency) continue;
    const requirements = [
      ...(options.extensionObjectRequirements ?? []).filter(
        (requirement) => requirement.id === extensionId,
      ),
      ...(await storeObjectRequirements(db, tenant, extensionId)),
    ];
    const requirement = requirements.find(
      (candidate) => candidate.object.name === object.name,
    );
    if (
      requirement &&
      requirement.object.label === object.label &&
      requirement.object.description === object.description &&
      canonicalJson(requirement.object.config) ===
        canonicalJson(object.config) &&
      row.label === object.label &&
      row.description === object.description &&
      canonicalJson(JSON.parse(row.config)) === canonicalJson(object.config)
    )
      return true;
  }
  return false;
}

async function activationPlan(
  db: D1Database,
  tenant: string,
  manifest: SolutionPackage,
  options: SolutionOptions,
) {
  const dependencies: ActivationDependency[] = [];
  const conflicts: string[] = [];
  const visiting = new Set<string>();
  const planned = new Map<string, ActivationDependency>();
  const registry = options.extensionRegistry;
  const add = (dependency: ActivationDependency) => {
    if (planned.has(dependency.id)) return;
    planned.set(dependency.id, dependency);
    dependencies.push(dependency);
  };

  async function visit(id: string, chain: string[]) {
    const storedManifest = await storePluginManifest(db, tenant, id);
    const registered = storedManifest ? undefined : registry?.get(id);
    const extensionManifest = storedManifest ?? registered?.manifest;
    const builtIn = !storedManifest && registered?.builtIn === true;
    if (builtIn) {
      add({
        id,
        label: extensionManifest!.label,
        version: extensionManifest!.version,
        action: "built_in",
        kind: "extension",
        requires: extensionManifest!.requires,
      });
      return;
    }

    const installed = await db
      .prepare(
        "SELECT version,enabled FROM studio_extension_installations WHERE tenant_id=? AND id=?",
      )
      .bind(tenant, id)
      .first<{ version: string; enabled: number }>();
    if (installed?.enabled === 1) {
      add({
        id,
        label: extensionManifest?.label ?? id,
        version: installed.version,
        action: "already_available",
        kind: "extension",
        requires: extensionManifest?.requires ?? [],
      });
      return;
    }

    if (!extensionManifest) {
      if (await isSolutionEnabled(db, tenant, id)) {
        const solution = await db
          .prepare(
            "SELECT version,manifest FROM studio_solution_installations WHERE tenant_id=? AND id=? AND enabled=1",
          )
          .bind(tenant, id)
          .first<{ version: string; manifest: string }>();
        let label = id;
        try {
          label = solutionPackageSchema.parse(JSON.parse(solution!.manifest)).label;
        } catch {
          // The enabled solution remains usable even if its display metadata is invalid.
        }
        add({
          id,
          label,
          version: solution?.version ?? "",
          action: "already_available",
          kind: "solution",
          requires: [],
        });
        return;
      }
      conflicts.push(`Dependencia no disponible: ${id}.`);
      return;
    }

    if (visiting.has(id)) {
      conflicts.push(`Dependencia circular: ${[...chain, id].join(" → ")}.`);
      return;
    }
    if (planned.has(id)) return;

    visiting.add(id);
    for (const dependency of extensionManifest.requires) {
      await visit(dependency, [...chain, id]);
    }
    visiting.delete(id);
    add({
      id,
      label: extensionManifest.label,
      version: extensionManifest.version,
      action: installed ? "enable" : "install",
      kind: "extension",
      requires: extensionManifest.requires,
    });
  }

  for (const id of manifest.requires) await visit(id, [manifest.id]);
  return { dependencies, conflicts };
}

async function activationPreview(
  db: D1Database,
  tenant: string,
  input: unknown,
  options: SolutionOptions,
) {
  const inspected = await inspect(db, tenant, input, options);
  const plan = await activationPlan(db, tenant, inspected.manifest, options);
  const resolvable = new Set(
    plan.dependencies.map((dependency) => dependency.id),
  );
  const conflicts = inspected.preview.conflicts.filter((conflict) => {
    const match = /^Dependencia no disponible: (.+)\.$/.exec(conflict);
    return !match || !resolvable.has(match[1]);
  });
  conflicts.push(...plan.conflicts);
  return {
    label: inspected.manifest.label,
    ...inspected.preview,
    conflicts: [...new Set(conflicts)],
    canInstall: conflicts.length === 0,
    canActivate: conflicts.length === 0,
    dependencies: plan.dependencies,
  };
}

function internalRouteRequest(
  app: Hono<Env>,
  url: string,
  headers: Headers,
  env: Env["Bindings"],
  path: string,
) {
  return app.request(
    new Request(new URL(path, url), {
      method: "POST",
      headers,
    }),
    undefined,
    env,
  );
}

export async function installSolution(
  db: D1Database,
  tenant: string,
  input: unknown,
  options: SolutionOptions = {},
) {
  const { manifest, installed, current, claims, dependencies, preview } =
    await inspect(db, tenant, input, options);
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
      ? "SELECT manifest=? AND enabled=? FROM studio_solution_installations WHERE tenant_id=? AND id=?"
      : "SELECT count(*)=0 FROM studio_solution_installations WHERE tenant_id=? AND id=?",
    installed
      ? [installed.manifest, installed.enabled, tenant, manifest.id]
      : [tenant, manifest.id],
  );
  for (const id of dependencies)
    addGuard(
      "SELECT enabled=1 FROM studio_solution_installations WHERE tenant_id=? AND id=?",
      [tenant, id],
    );
  for (const id of manifest.requires) {
    const storedExtension = await storePluginManifest(db, tenant, id);
    const registeredExtension = options.extensionRegistry?.get(id);
    if (storedExtension || (registeredExtension && !registeredExtension.builtIn))
      addGuard(
        "SELECT enabled=1 FROM studio_extension_installations WHERE tenant_id=? AND id=?",
        [tenant, id],
      );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO studio_solution_installations(tenant_id,id,version,enabled,manifest) VALUES (?,?,?,1,?) ON CONFLICT(tenant_id,id) DO UPDATE SET version=excluded.version,manifest=excluded.manifest,updated_at=${dialectFor(db).utcNow()}`,
      )
      .bind(tenant, manifest.id, manifest.version, JSON.stringify(manifest)),
  );
  for (const entry of preview.objects) {
    const object = manifest.objects.find((o) => o.name === entry.name)!;
    const row = current.get(entry.name);
    if (entry.action === "keep") {
      if (claims.has(entry.name)) {
        addGuard(
          "SELECT count(*)=0 FROM studio_solution_objects WHERE tenant_id=? AND object_name=?",
          [tenant, entry.name],
        );
        addGuard(
          "SELECT version=? AND config=? AND label=? AND description=? FROM studio_objects WHERE tenant_id=? AND name=?",
          [
            row!.version,
            row!.config,
            row!.label,
            row!.description,
            tenant,
            entry.name,
          ],
        );
        statements.push(
          db
            .prepare(
              "INSERT INTO studio_solution_objects(tenant_id,solution_id,object_name,definition) VALUES (?,?,?,?)",
            )
            .bind(
              tenant,
              manifest.id,
              entry.name,
              canonicalJson(definition(object)),
            ),
        );
      }
      continue;
    }
    if (row)
      addGuard(
        "SELECT solution_id=? FROM studio_solution_objects WHERE tenant_id=? AND object_name=?",
        [manifest.id, tenant, entry.name],
      );
    else
      addGuard(
        "SELECT count(*)=0 FROM studio_solution_objects WHERE tenant_id=? AND object_name=?",
        [tenant, entry.name],
      );
    if (row)
      addGuard(
        "SELECT version=? AND config=? AND label=? AND description=? FROM studio_objects WHERE tenant_id=? AND name=?",
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
        "SELECT count(*)=0 FROM studio_objects WHERE tenant_id=? AND name=?",
        [tenant, entry.name],
      );
    const version = (row?.version ?? 0) + 1;
    statements.push(
      db
        .prepare(
          "INSERT INTO studio_objects(tenant_id,name,label,description,config,version) VALUES (?,?,?,?,?,?) ON CONFLICT(tenant_id,name) DO UPDATE SET label=excluded.label,description=excluded.description,config=excluded.config,version=excluded.version",
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
          "INSERT INTO studio_schema_versions(tenant_id,object_name,version,definition) VALUES (?,?,?,?)",
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
          "INSERT INTO studio_solution_objects(tenant_id,solution_id,object_name,definition) VALUES (?,?,?,?) ON CONFLICT(tenant_id,object_name) DO UPDATE SET definition=excluded.definition",
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
      "SELECT id,version,enabled,manifest FROM studio_solution_installations WHERE tenant_id=? ORDER BY id",
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
  app.post("/api/solutions/activation-preview", async (c) =>
    c.json({
      data: await activationPreview(
        c.env.DB,
        c.get("tenant"),
        await c.req.json(),
        options,
      ),
    }),
  );
  app.post("/api/solutions/activate", async (c) => {
    const db = c.env.DB;
    const tenant = c.get("tenant");
    const input = await c.req.json();
    const preview = await activationPreview(db, tenant, input, options);
    if (!preview.canActivate)
      return c.json({ error: preview.conflicts.join(" "), data: preview }, 409);

    const completed: { id: string; status: string }[] = [];
    for (const dependency of preview.dependencies) {
      if (dependency.kind !== "extension") continue;
      if (dependency.action === "already_available") {
        completed.push({ id: dependency.id, status: "already_available" });
        continue;
      }
      if (dependency.action === "built_in") {
        completed.push({ id: dependency.id, status: "built_in" });
        continue;
      }
      try {
        const response = await internalRouteRequest(
          app,
          c.req.url,
          new Headers(c.req.raw.headers),
          c.env,
          `/api/extensions/${encodeURIComponent(dependency.id)}/install`,
        );
        if (!response.ok) {
          const body = await response.text();
          return c.json(
            {
              error: `Could not ${dependency.action} dependency ${dependency.label}.`,
              detail: body,
              partial: {
                solutionId: preview.id,
                completedDependencies: completed,
                failedDependency: dependency.id,
                retryable: true,
              },
            },
            response.status as 400 | 401 | 403 | 404 | 409 | 422 | 500,
          );
        }
        completed.push({
          id: dependency.id,
          status: dependency.action === "enable" ? "enabled" : "installed",
        });
      } catch (error) {
        return c.json(
          {
            error: `Could not ${dependency.action} dependency ${dependency.label}.`,
            detail: error instanceof Error ? error.message : String(error),
            partial: {
              solutionId: preview.id,
              completedDependencies: completed,
              failedDependency: dependency.id,
              retryable: true,
            },
          },
          500,
        );
      }
    }

    let result: Awaited<ReturnType<typeof installSolution>>;
    try {
      result = await installSolution(db, tenant, input, options);
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
          partial: {
            solutionId: preview.id,
            completedDependencies: completed,
            retryable: true,
          },
        },
        409,
      );
    }
    if (!result.enabled) {
      try {
        const response = await app.request(
          new Request(new URL(`/api/solutions/${encodeURIComponent(preview.id)}`, c.req.url), {
            method: "PATCH",
            headers: new Headers(c.req.raw.headers),
            body: JSON.stringify({ enabled: true }),
          }),
          undefined,
          c.env,
        );
        if (!response.ok) {
          return c.json(
            {
              error: `Dependencies are ready, but ${preview.label} could not be enabled.`,
              detail: await response.text(),
              partial: {
                solutionId: preview.id,
                completedDependencies: completed,
                solutionInstalled: true,
                retryable: true,
              },
            },
            response.status as 400 | 401 | 403 | 404 | 409 | 422 | 500,
          );
        }
        result = { ...result, enabled: true };
      } catch (error) {
        return c.json(
          {
            error: `Dependencies are ready, but ${preview.label} could not be enabled.`,
            detail: error instanceof Error ? error.message : String(error),
            partial: {
              solutionId: preview.id,
              completedDependencies: completed,
              solutionInstalled: true,
              retryable: true,
            },
          },
          500,
        );
      }
    }
    return c.json({
      data: { ...result, dependencies: completed },
    });
  });
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
      "SELECT manifest FROM studio_solution_installations WHERE tenant_id=? AND id=?",
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
        "SELECT id,version,enabled,manifest FROM studio_solution_installations WHERE tenant_id=? AND id=?",
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
          `SELECT s.id FROM studio_solution_installations s,${dialectFor(db).jsonEach("s.manifest", "$.requires", "d")} WHERE s.tenant_id=? AND s.enabled=1 AND s.id!=? AND d.value=? LIMIT 1`,
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
        "SELECT manifest=? AND enabled=? FROM studio_solution_installations WHERE tenant_id=? AND id=?",
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
              "SELECT enabled=1 FROM studio_extension_installations WHERE tenant_id=? AND id=?",
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
              "SELECT enabled=1 FROM studio_solution_installations WHERE tenant_id=? AND id=?",
              [tenant, dependency],
            ),
          );
      }
    else
      checks.push(
        guard(
          db,
          `SELECT count(*)=0 FROM studio_solution_installations s,${dialectFor(db).jsonEach("s.manifest", "$.requires", "d")} WHERE s.tenant_id=? AND s.enabled=1 AND s.id!=? AND d.value=?`,
          [tenant, id, id],
        ),
      );
    await transaction(db, [
      ...checks.map((g) => g.start),
      db
        .prepare(
          `UPDATE studio_solution_installations SET enabled=?,updated_at=${dialectFor(db).utcNow()} WHERE tenant_id=? AND id=?`,
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
