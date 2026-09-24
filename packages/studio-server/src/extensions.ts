import { dialectFor } from "@savia/db/dialect";
import { z } from "zod";
import {
  canonicalJson,
  compareSolutionVersions,
} from "@savia/studio-shared/solution-package";
import {
  createExtensionObjectRequirements,
  createExtensionRegistry,
  type ExtensionObjectRequirement,
  type ExtensionManifest,
  type ExtensionRegistry,
} from "@savia/studio-shared/extension-package";
import type { ExtensionActionExecutor } from "@savia/studio-shared/extension-runtime";
import { type Env, fail } from "./context";
import type { ExtensionConnectionRepository } from "./extension-connections";
import { prepareExtensionObjectProvisioning } from "./extension-object-requirements";
import type { ExtensionSettingsRepository } from "./extension-settings";
import {
  storeConfigFor,
  storeObjectRequirements,
  storePluginCatalog,
  storePluginManifest,
} from "./plugin-store";
import { audit, guard, transaction } from "./services";
import type { Hono } from "hono";
import type { ExtensionSummaryProvider } from "./extension-summaries";

const emptyExtensionRegistry = createExtensionRegistry([]);

export type ExtensionOptions = {
  extensionRegistry?: ExtensionRegistry;
  extensionSummaryProviders?: readonly ExtensionSummaryProvider[];
  extensionObjectRequirements?: readonly ExtensionObjectRequirement[];
  connectionRepository?: ExtensionConnectionRepository;
  settingsRepository?: ExtensionSettingsRepository;
  actionExecutor?: ExtensionActionExecutor;
  canManageExtension?: (input: {
    tenantId: string;
    principalId: string;
    extensionId: string;
  }) => Promise<boolean> | boolean;
};

type StoredInstallation = {
  id: string;
  version: string;
  enabled: number;
  manifest: string;
};

export type ExtensionInstallation = {
  version: string;
  enabled: boolean;
};

function registryFor(options: ExtensionOptions): ExtensionRegistry {
  return options.extensionRegistry ?? emptyExtensionRegistry;
}

export function extensionObjectRequirementsFor(options: ExtensionOptions) {
  return createExtensionObjectRequirements(
    registryFor(options),
    options.extensionObjectRequirements ?? [],
  );
}

export async function isExtensionAvailable(
  db: D1Database,
  tenant: string,
  id: string,
  registry?: ExtensionRegistry,
): Promise<boolean> {
  const resolvedRegistry = registryFor({ extensionRegistry: registry });
  if (resolvedRegistry.get(id)) {
    if (resolvedRegistry.isBuiltIn(id)) return true;
    return Boolean(
      await db
        .prepare(
          "SELECT 1 FROM crm_extension_installations WHERE tenant_id=? AND id=? AND enabled=1",
        )
        .bind(tenant, id)
        .first(),
    );
  }
  // Plugin del store por tenant: vive en D1, no en el registry compilado.
  try {
    const installed = await db
      .prepare(
        "SELECT 1 FROM studio_extension_installations WHERE tenant_id=? AND id=? AND enabled=1",
      )
      .bind(tenant, id)
      .first();
    if (!installed) return false;
    return (await storePluginManifest(db, tenant, id)) !== null;
  } catch {
    return false;
  }
}

export async function enabledExtensionIds(
  db: D1Database,
  tenant: string,
  registry?: ExtensionRegistry,
): Promise<string[]> {
  const resolvedRegistry = registryFor({ extensionRegistry: registry });
  const rows = await db
    .prepare(
      "SELECT id FROM studio_extension_installations WHERE tenant_id=? AND enabled=1 ORDER BY id",
    )
    .bind(tenant)
    .all<{ id: string }>();
  return [
    ...new Set([
      ...resolvedRegistry.ids().filter((id) => resolvedRegistry.isBuiltIn(id)),
      ...rows.results
        .filter((row) => resolvedRegistry.get(row.id))
        .map((row) => row.id),
      // Plugins del store habilitados (viven en D1, no en el registry).
      ...(await storeEnabledIds(db, tenant)),
    ]),
  ].sort((left, right) => left.localeCompare(right));
}

async function storeEnabledIds(
  db: D1Database,
  tenant: string,
): Promise<string[]> {
  try {
    const rows = await db
      .prepare(
        `SELECT i.id AS id FROM crm_extension_installations i
         INNER JOIN plugin_store_artifacts s ON s.tenant_id=i.tenant_id AND s.id=i.id
         WHERE i.tenant_id=? AND i.enabled=1 GROUP BY i.id`,
      )
      .bind(tenant)
      .all<{ id: string }>();
    return rows.results.map((row) => row.id);
  } catch {
    return [];
  }
}

async function installation(
  db: D1Database,
  tenant: string,
  id: string,
): Promise<StoredInstallation | null> {
  return db
    .prepare(
      "SELECT id,version,enabled,manifest FROM studio_extension_installations WHERE tenant_id=? AND id=?",
    )
    .bind(tenant, id)
    .first<StoredInstallation>();
}

async function assertDependencies(
  db: D1Database,
  tenant: string,
  manifest: ExtensionManifest,
  registry: ExtensionRegistry,
) {
  for (const dependency of manifest.requires)
    if (!(await isExtensionAvailable(db, tenant, dependency, registry)))
      fail(`Dependencia no disponible: ${dependency}.`, 409);
}

async function assertCanDisable(db: D1Database, tenant: string, id: string) {
  const dependentExtension = await db
    .prepare(
      `SELECT e.id FROM studio_extension_installations e,${dialectFor(db).jsonEach("e.manifest", "$.requires", "d")} WHERE e.tenant_id=? AND e.enabled=1 AND e.id!=? AND d.value=? LIMIT 1`,
    )
    .bind(tenant, id, id)
    .first<{ id: string }>();
  if (dependentExtension)
    fail(
      `Desactiva primero la extensión dependiente ${dependentExtension.id}.`,
      409,
    );
  const dependentSolution = await db
    .prepare(
      `SELECT s.id FROM studio_solution_installations s,${dialectFor(db).jsonEach("s.manifest", "$.requires", "d")} WHERE s.tenant_id=? AND s.enabled=1 AND d.value=? LIMIT 1`,
    )
    .bind(tenant, id)
    .first<{ id: string }>();
  if (dependentSolution)
    fail(
      `Desactiva primero el paquete dependiente ${dependentSolution.id}.`,
      409,
    );
}

function activeDependencyGuards(
  db: D1Database,
  tenant: string,
  manifest: ExtensionManifest,
  registry: ExtensionRegistry,
) {
  return manifest.requires
    .filter((id) => !registry.isBuiltIn(id))
    .map((id) =>
      guard(
        db,
        "SELECT enabled=1 FROM studio_extension_installations WHERE tenant_id=? AND id=?",
        [tenant, id],
      ),
    );
}

function noActiveDependentsGuards(db: D1Database, tenant: string, id: string) {
  return [
    guard(
      db,
      `SELECT count(*)=0 FROM studio_extension_installations e,${dialectFor(db).jsonEach("e.manifest", "$.requires", "d")} WHERE e.tenant_id=? AND e.enabled=1 AND e.id!=? AND d.value=?`,
      [tenant, id, id],
    ),
    guard(
      db,
      `SELECT count(*)=0 FROM studio_solution_installations s,${dialectFor(db).jsonEach("s.manifest", "$.requires", "d")} WHERE s.tenant_id=? AND s.enabled=1 AND d.value=?`,
      [tenant, id],
    ),
  ];
}

function publicInstallation(
  row: StoredInstallation | null,
): ExtensionInstallation | null {
  return row ? { version: row.version, enabled: row.enabled === 1 } : null;
}

export function registerExtensions(
  app: Hono<Env>,
  options: ExtensionOptions = {},
) {
  const registry = registryFor(options);
  const objectRequirements = extensionObjectRequirementsFor(options);

  async function effectiveObjectRequirements(
    db: D1Database,
    tenant: string,
    extensionId: string,
  ) {
    if (objectRequirements.has(extensionId)) return objectRequirements;
    const declared = await storeObjectRequirements(db, tenant, extensionId);
    if (!declared.length) return objectRequirements;
    return new Map([
      ...objectRequirements,
      ...declared.map((requirement) => [requirement.id, requirement] as const),
    ]);
  }

  async function resolveExtension(
    db: D1Database,
    tenant: string,
    id: string,
  ): Promise<{ manifest: ExtensionManifest; builtIn: boolean } | null> {
    // Lo subido por el tenant prevalece sobre lo compilado: permite
    // migrar un plugin fuera del release sin cambiar su id.
    const stored = await storePluginManifest(db, tenant, id);
    if (stored) return { manifest: stored, builtIn: false };
    const compiled = registry.get(id);
    if (compiled)
      return {
        manifest: compiled.manifest,
        builtIn: compiled.builtIn === true,
      };
    return null;
  }

  async function assertStoreManager(
    db: D1Database,
    tenant: string,
    principalId: string,
    extensionId: string,
  ): Promise<void> {
    // Solo lo subido al store exige administración; las compiladas
    // conservan su conducta histórica.
    if (!options.canManageExtension) return;
    if (
      registry.get(extensionId) &&
      !(await storePluginManifest(db, tenant, extensionId))
    )
      return;
    const allowed = await options.canManageExtension({
      tenantId: tenant,
      principalId: principalId,
      extensionId,
    });
    if (!allowed)
      fail("Se requiere permiso de administración del espacio.", 403);
  }

  app.get("/api/extensions", async (c) => {
    const tenant = c.get("tenant");
    const rows = await c.env.DB.prepare(
      "SELECT id,version,enabled,manifest FROM studio_extension_installations WHERE tenant_id=?",
    )
      .bind(tenant)
      .all<StoredInstallation>();
    const installed = new Map(rows.results.map((row) => [row.id, row]));
    const catalog = await storePluginCatalog(c.env.DB, tenant);
    const shadowed = new Set(catalog.map((manifest) => manifest.id));
    const compiledEntries = registry.ids().map((id) => {
      const extension = registry.get(id)!;
      return {
        manifest: extension.manifest,
        builtIn: extension.builtIn === true,
        installed: publicInstallation(installed.get(id) ?? null),
      };
    });
    // Lo subido al store reemplaza a lo compilado con el mismo id.
    const storeEntries = [];
    for (const manifest of catalog) {
      const config = await storeConfigFor(c.env.DB, tenant, manifest.id);
      storeEntries.push({
        manifest,
        builtIn: false,
        store: true as const,
        shadowed: registry.get(manifest.id) !== undefined,
        screens: config?.screens ?? [],
        widgets: config?.widgets ?? [],
        installed: publicInstallation(installed.get(manifest.id) ?? null),
      });
    }
    return c.json({
      data: [
        ...compiledEntries.filter((entry) => !shadowed.has(entry.manifest.id)),
        ...storeEntries,
      ],
    });
  });

  app.post("/api/extensions/:id/install", async (c) => {
    const tenant = c.get("tenant");
    const id = c.req.param("id");
    const extension = await resolveExtension(c.env.DB, tenant, id);
    if (!extension) return fail("La extensión no existe en este espacio.", 404);
    if (extension.builtIn)
      return c.json({
        data: {
          id,
          version: extension.manifest.version,
          enabled: true,
          builtIn: true,
        },
      });
    await assertStoreManager(c.env.DB, tenant, c.get("principalId"), id);
    await assertDependencies(c.env.DB, tenant, extension.manifest, registry);
    const current = await installation(c.env.DB, tenant, id);
    const manifest = canonicalJson(extension.manifest);
    if (current) {
      const order = compareSolutionVersions(
        extension.manifest.version,
        current.version,
      );
      if (order < 0)
        return fail("No se puede instalar una versión anterior.", 409);
      if (
        order === 0 &&
        canonicalJson(JSON.parse(current.manifest)) !== manifest
      )
        return fail(
          "Esta versión ya está instalada con otro contenido. Publica una versión nueva.",
          409,
        );
      if (order === 0 && current.enabled === 1) {
        const provisioning = await prepareExtensionObjectProvisioning(
          c.env.DB,
          tenant,
          await effectiveObjectRequirements(c.env.DB, tenant, id),
          id,
        );
        if (provisioning.starts.length)
          await transaction(c.env.DB, [
            ...provisioning.starts,
            ...provisioning.writes,
            ...provisioning.ends,
          ]);
        return c.json({
          data: { id, version: current.version, enabled: true, builtIn: false },
        });
      }
    }
    const currentGuard = current
      ? guard(
          c.env.DB,
          "SELECT version=? AND enabled=? AND manifest=? FROM studio_extension_installations WHERE tenant_id=? AND id=?",
          [current.version, current.enabled, current.manifest, tenant, id],
        )
      : guard(
          c.env.DB,
          "SELECT count(*)=0 FROM studio_extension_installations WHERE tenant_id=? AND id=?",
          [tenant, id],
        );
    const dependencyGuards = activeDependencyGuards(
      c.env.DB,
      tenant,
      extension.manifest,
      registry,
    );
    const provisioning = await prepareExtensionObjectProvisioning(
      c.env.DB,
      tenant,
      await effectiveObjectRequirements(c.env.DB, tenant, id),
      id,
    );
    await transaction(c.env.DB, [
      currentGuard.start,
      ...dependencyGuards.map((dependency) => dependency.start),
      ...provisioning.starts,
      ...provisioning.writes,
      c.env.DB.prepare(
        `INSERT INTO studio_extension_installations(tenant_id,id,version,enabled,manifest) VALUES (?,?,?,1,?) ON CONFLICT(tenant_id,id) DO UPDATE SET version=excluded.version,enabled=1,manifest=excluded.manifest,updated_at=${dialectFor(c.env.DB).utcNow()}`,
      ).bind(tenant, id, extension.manifest.version, manifest),
      audit(
        c.env.DB,
        tenant,
        current ? "extension.enabled" : "extension.installed",
        id,
        null,
        { version: extension.manifest.version },
      ),
      ...provisioning.ends,
      ...dependencyGuards.map((dependency) => dependency.end),
      currentGuard.end,
    ]);
    return c.json({
      data: {
        id,
        version: extension.manifest.version,
        enabled: true,
        builtIn: false,
      },
    });
  });

  app.patch("/api/extensions/:id", async (c) => {
    const input = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(await c.req.json());
    const tenant = c.get("tenant");
    const id = c.req.param("id");
    const extension = await resolveExtension(c.env.DB, tenant, id);
    if (!extension) return fail("La extensión no existe en este espacio.", 404);
    if (extension.builtIn)
      return c.json({
        data: {
          id,
          version: extension.manifest.version,
          enabled: true,
          builtIn: true,
        },
      });
    const current = await installation(c.env.DB, tenant, id);
    if (!current)
      return fail("La extensión no está instalada en este espacio.", 404);
    await assertStoreManager(c.env.DB, tenant, c.get("principalId"), id);
    if (input.enabled)
      await assertDependencies(c.env.DB, tenant, extension.manifest, registry);
    else await assertCanDisable(c.env.DB, tenant, id);
    if ((current.enabled === 1) === input.enabled)
      return c.json({
        data: {
          id,
          version: current.version,
          enabled: input.enabled,
          builtIn: false,
        },
      });
    const currentGuard = guard(
      c.env.DB,
      "SELECT version=? AND enabled=? AND manifest=? FROM studio_extension_installations WHERE tenant_id=? AND id=?",
      [current.version, current.enabled, current.manifest, tenant, id],
    );
    const stateGuards = input.enabled
      ? activeDependencyGuards(c.env.DB, tenant, extension.manifest, registry)
      : noActiveDependentsGuards(c.env.DB, tenant, id);
    await transaction(c.env.DB, [
      currentGuard.start,
      ...stateGuards.map((state) => state.start),
      c.env.DB.prepare(
        `UPDATE studio_extension_installations SET enabled=?,updated_at=${dialectFor(c.env.DB).utcNow()} WHERE tenant_id=? AND id=?`,
      ).bind(input.enabled ? 1 : 0, tenant, id),
      audit(
        c.env.DB,
        tenant,
        input.enabled ? "extension.enabled" : "extension.disabled",
        id,
        null,
        { version: current.version },
      ),
      ...stateGuards.map((state) => state.end),
      currentGuard.end,
    ]);
    return c.json({
      data: {
        id,
        version: current.version,
        enabled: input.enabled,
        builtIn: false,
      },
    });
  });
}
