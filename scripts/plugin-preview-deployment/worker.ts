import { createStudioApp } from "../../packages/studio-server/src/index";
import { extensionManifestSchema } from "../../packages/studio-shared/src/extension-package";
import { storeJsonSchema } from "../../packages/studio-shared/src/plugin-store";

type PluginInput = {
  id: string;
  version: string;
  previousVersion: string;
  manifest: Record<string, unknown>;
  storeJson: unknown;
  sha256: string;
};

type Installation = {
  version: string;
  enabled: number;
  manifest: string;
};

type RecoveryCheckpoint = {
  version: 1;
  createdAt: string;
  plugins: Array<{
    id: string;
    version: string;
    previousVersion: string;
    sha256: string;
    tenants: Array<{
      tenant: string;
      status: "update" | "skip" | "skip-disabled" | "skip-missing";
      previousInstallation?: Installation;
      previousArtifact?: {
        version: string;
        manifest: string;
        entryJsBase64: string;
        storeJson: string | null;
        sha256: string;
      };
    }>;
  }>;
};

function responseError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function manifestWithoutVersion(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = { ...(value as Record<string, unknown>) };
  delete result.version;
  return result;
}

function digest(bytes: Uint8Array): Promise<string> {
  const input = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return crypto.subtle
    .digest("SHA-256", input)
    .then((result) =>
      [...new Uint8Array(result)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
    );
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function tenants(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare("SELECT 'tenant:'||id AS scope FROM tenants ORDER BY scope")
    .all<{ scope: string }>();
  return result.results.map(({ scope }) => scope);
}

async function currentInstallation(
  db: D1Database,
  tenant: string,
  id: string,
): Promise<Installation | null> {
  return db
    .prepare(
      "SELECT version,enabled,manifest FROM studio_extension_installations WHERE tenant_id=? AND id=?",
    )
    .bind(tenant, id)
    .first<Installation>();
}

async function artifactAt(
  db: D1Database,
  tenant: string,
  id: string,
  version: string,
) {
  return db
    .prepare(
      "SELECT manifest,entry_js,store_json,sha256 FROM plugin_store_artifacts WHERE tenant_id=? AND id=? AND version=?",
    )
    .bind(tenant, id, version)
    .first<{
      manifest: string;
      entry_js: string;
      store_json: string | null;
      sha256: string;
    }>();
}

function validPlugin(plugin: PluginInput): boolean {
  return Boolean(
    plugin &&
    /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(plugin.id) &&
    /^\d+\.\d+\.\d+$/.test(plugin.version) &&
    /^\d+\.\d+\.\d+$/.test(plugin.previousVersion) &&
    /^[a-f0-9]{64}$/.test(plugin.sha256) &&
    plugin.manifest?.id === plugin.id &&
    plugin.manifest?.version === plugin.version,
  );
}

async function preflight(db: D1Database, input: unknown) {
  const plugins = (input as { plugins?: PluginInput[] } | null)?.plugins;
  if (
    !Array.isArray(plugins) ||
    plugins.length === 0 ||
    !plugins.every(validPlugin)
  )
    throw new Error("Invalid preview plugin plan.");
  if (new Set(plugins.map(({ id }) => id)).size !== plugins.length)
    throw new Error("Preview plugin plan repeats an id.");
  const allTenants = await tenants(db);
  const checkpoint: RecoveryCheckpoint = {
    version: 1,
    createdAt: new Date().toISOString(),
    plugins: [],
  };
  for (const plugin of plugins) {
    const tenantRows: RecoveryCheckpoint["plugins"][number]["tenants"] = [];
    for (const tenant of allTenants) {
      const installation = await currentInstallation(db, tenant, plugin.id);
      if (!installation) {
        tenantRows.push({ tenant, status: "skip-missing" });
        continue;
      }
      if (installation.enabled !== 1) {
        tenantRows.push({ tenant, status: "skip-disabled" });
        continue;
      }
      const artifact = await artifactAt(
        db,
        tenant,
        plugin.id,
        installation.version,
      );
      if (!artifact)
        throw new Error(
          `Installed artifact ${plugin.id}@${installation.version} is missing in ${tenant}.`,
        );
      const currentManifest = JSON.parse(artifact.manifest);
      const installedManifest = JSON.parse(installation.manifest);
      const candidateManifest = extensionManifestSchema.parse(plugin.manifest);
      const candidateStore =
        plugin.storeJson === null
          ? null
          : canonical(storeJsonSchema.parse(plugin.storeJson));
      const currentStore =
        artifact.store_json === null
          ? null
          : canonical(storeJsonSchema.parse(JSON.parse(artifact.store_json)));
      const isCurrent =
        installation.version === plugin.version &&
        artifact.sha256 === plugin.sha256 &&
        canonical(installedManifest) === canonical(candidateManifest) &&
        currentStore === candidateStore;
      if (isCurrent) {
        tenantRows.push({
          tenant,
          status: "skip",
          previousInstallation: installation,
          previousArtifact: {
            version: installation.version,
            manifest: artifact.manifest,
            entryJsBase64: base64Utf8(artifact.entry_js),
            storeJson: artifact.store_json,
            sha256: artifact.sha256,
          },
        });
        continue;
      }
      if (installation.version !== plugin.previousVersion)
        throw new Error(
          `Plugin ${plugin.id} in ${tenant} is at ${installation.version}; expected ${plugin.previousVersion} or the exact published digest.`,
        );
      if (
        canonical(manifestWithoutVersion(currentManifest)) !==
          canonical(manifestWithoutVersion(candidateManifest)) ||
        canonical(manifestWithoutVersion(installedManifest)) !==
          canonical(manifestWithoutVersion(candidateManifest))
      )
        throw new Error(
          `Plugin ${plugin.id} changes its manifest beyond the version in ${tenant}.`,
        );
      if (currentStore !== candidateStore)
        throw new Error(`Plugin ${plugin.id} changes store.json in ${tenant}.`);
      tenantRows.push({
        tenant,
        status: "update",
        previousInstallation: installation,
        previousArtifact: {
          version: installation.version,
          manifest: artifact.manifest,
          entryJsBase64: base64Utf8(artifact.entry_js),
          storeJson: artifact.store_json,
          sha256: artifact.sha256,
        },
      });
    }
    checkpoint.plugins.push({
      id: plugin.id,
      version: plugin.version,
      previousVersion: plugin.previousVersion,
      sha256: plugin.sha256,
      tenants: tenantRows,
    });
  }
  return checkpoint;
}

function studio(tenant: string) {
  return createStudioApp(tenant, {
    seedObjects: [],
    canManageExtension: () => true,
  });
}

async function studioCall(
  dbEnv: { DB: D1Database },
  tenant: string,
  path: string,
  init: RequestInit,
) {
  return studio(tenant).request(
    `https://preview-publisher.internal${path}`,
    init,
    dbEnv,
  );
}

async function publishOne(request: Request, dbEnv: { DB: D1Database }) {
  const form = await request.formData();
  const tenant = String(form.get("tenant") ?? "");
  const id = String(form.get("id") ?? "");
  const version = String(form.get("version") ?? "");
  const previousVersion = String(form.get("previousVersion") ?? "");
  const expectedDigest = String(form.get("sha256") ?? "");
  const file = form.get("file");
  if (
    !validPlugin({
      id,
      version,
      previousVersion,
      sha256: expectedDigest,
      manifest: { id, version },
      storeJson: null,
    })
  )
    throw new Error("Invalid plugin publication fields.");
  if (!(file instanceof File)) throw new Error("Plugin ZIP is missing.");
  if (!(await tenants(dbEnv.DB)).includes(tenant))
    throw new Error("Unknown preview tenant.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if ((await digest(bytes)) !== expectedDigest)
    throw new Error(
      `Plugin ${id}@${version} ZIP digest does not match the plan.`,
    );

  const installation = await currentInstallation(dbEnv.DB, tenant, id);
  if (!installation || installation.enabled !== 1)
    throw new Error(`Plugin ${id} is no longer enabled in ${tenant}.`);
  if (installation.version === version) {
    const existing = await artifactAt(dbEnv.DB, tenant, id, version);
    if (existing?.sha256 === expectedDigest)
      return { tenant, id, version, skipped: true };
    throw new Error(
      `Plugin ${id}@${version} has a different digest in ${tenant}.`,
    );
  }
  if (installation.version !== previousVersion)
    throw new Error(
      `Plugin ${id} changed concurrently in ${tenant}; expected ${previousVersion}, found ${installation.version}.`,
    );

  const uploadForm = new FormData();
  uploadForm.set(
    "file",
    new File([bytes], `${id}-${version}.zip`, { type: "application/zip" }),
  );
  const uploaded = await studioCall(dbEnv, tenant, "/api/plugin-store/upload", {
    method: "POST",
    body: uploadForm,
  });
  const uploadPayload = (await uploaded.json().catch(() => null)) as {
    data?: { id?: string; version?: string; sha256?: string };
    error?: string;
  } | null;
  if (
    !uploaded.ok ||
    uploadPayload?.data?.id !== id ||
    uploadPayload.data.version !== version ||
    uploadPayload.data.sha256 !== expectedDigest
  )
    throw new Error(
      uploadPayload?.error ??
        `Plugin ${id}@${version} upload was not verified in ${tenant}.`,
    );

  const beforeInstall = await currentInstallation(dbEnv.DB, tenant, id);
  if (
    !beforeInstall ||
    beforeInstall.enabled !== 1 ||
    beforeInstall.version !== previousVersion
  )
    throw new Error(
      `Plugin ${id} changed during upload in ${tenant}; refusing installation.`,
    );
  const installed = await studioCall(
    dbEnv,
    tenant,
    `/api/extensions/${encodeURIComponent(id)}/install?update=enabled`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version }),
    },
  );
  const installPayload = (await installed.json().catch(() => null)) as {
    data?: { version?: string; enabled?: boolean };
    error?: string;
  } | null;
  const after = await currentInstallation(dbEnv.DB, tenant, id);
  const published = await artifactAt(dbEnv.DB, tenant, id, version);
  if (
    !installed.ok ||
    installPayload?.data?.version !== version ||
    installPayload.data.enabled !== true ||
    after?.version !== version ||
    after.enabled !== 1 ||
    published?.sha256 !== expectedDigest
  )
    throw new Error(
      installPayload?.error ??
        `Plugin ${id}@${version} installation verification failed in ${tenant}.`,
    );
  return { tenant, id, version, updated: true };
}

async function rollback(dbEnv: { DB: D1Database }, input: unknown) {
  const checkpoint = (input as { checkpoint?: RecoveryCheckpoint } | null)
    ?.checkpoint;
  if (!checkpoint || !Array.isArray(checkpoint.plugins))
    throw new Error("Invalid recovery checkpoint.");
  const restored: Array<{ tenant: string; id: string; version: string }> = [];
  const unchanged: Array<{ tenant: string; id: string; version: string }> = [];
  const skipped: Array<{ tenant: string; id: string; reason: string }> = [];
  const failures: string[] = [];
  for (const plugin of checkpoint.plugins) {
    for (const target of plugin.tenants ?? []) {
      if (target.status !== "update") continue;
      try {
        if (!target.previousInstallation)
          throw new Error(
            "recovery checkpoint is missing prior installation metadata",
          );
        const installation = await currentInstallation(
          dbEnv.DB,
          target.tenant,
          plugin.id,
        );
        if (
          installation?.enabled === 1 &&
          installation.version === target.previousInstallation.version
        ) {
          const previousArtifact = await artifactAt(
            dbEnv.DB,
            target.tenant,
            plugin.id,
            target.previousInstallation.version,
          );
          if (
            previousArtifact?.sha256 === target.previousArtifact?.sha256 &&
            canonical(JSON.parse(installation.manifest)) ===
              canonical(JSON.parse(target.previousInstallation.manifest))
          ) {
            unchanged.push({
              tenant: target.tenant,
              id: plugin.id,
              version: installation.version,
            });
            continue;
          }
        }
        if (
          !installation ||
          installation.enabled !== 1 ||
          installation.version !== plugin.version
        ) {
          skipped.push({
            tenant: target.tenant,
            id: plugin.id,
            reason: "installation changed or was disabled concurrently",
          });
          continue;
        }
        const candidate = await artifactAt(
          dbEnv.DB,
          target.tenant,
          plugin.id,
          plugin.version,
        );
        if (!candidate || candidate.sha256 !== plugin.sha256) {
          skipped.push({
            tenant: target.tenant,
            id: plugin.id,
            reason: "published artifact changed concurrently",
          });
          continue;
        }
        const response = await studioCall(
          dbEnv,
          target.tenant,
          `/api/extensions/${encodeURIComponent(plugin.id)}/install?update=enabled`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              version: target.previousInstallation.version,
              allowDowngrade: true,
            }),
          },
        );
        const payload = (await response.json().catch(() => null)) as {
          data?: { version?: string; enabled?: boolean };
          error?: string;
        } | null;
        const after = await currentInstallation(
          dbEnv.DB,
          target.tenant,
          plugin.id,
        );
        if (
          !response.ok ||
          after?.version !== target.previousInstallation.version ||
          after.enabled !== 1 ||
          payload?.data?.enabled !== true
        )
          throw new Error(
            payload?.error ?? `verification failed (HTTP ${response.status})`,
          );
        restored.push({
          tenant: target.tenant,
          id: plugin.id,
          version: after.version,
        });
      } catch (error) {
        failures.push(
          `${plugin.id} in ${target.tenant}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  return { restored, unchanged, skipped, failures };
}

export default {
  async fetch(
    request: Request,
    env: { DB: D1Database; DEPLOYMENT_SESSION: string },
  ) {
    if (
      !env.DEPLOYMENT_SESSION ||
      request.headers.get("authorization") !==
        `Bearer ${env.DEPLOYMENT_SESSION}`
    )
      return new Response("Unauthorized", { status: 401 });
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health")
      return Response.json({ status: "ok" });
    if (request.method === "GET" && url.pathname === "/tenants")
      return Response.json({ tenants: await tenants(env.DB) });
    if (request.method === "POST" && url.pathname === "/preflight") {
      try {
        return Response.json({
          checkpoint: await preflight(env.DB, await request.json()),
        });
      } catch (error) {
        return responseError(
          error instanceof Error ? error.message : String(error),
          409,
        );
      }
    }
    if (request.method === "POST" && url.pathname === "/publish") {
      try {
        return Response.json(await publishOne(request, env));
      } catch (error) {
        return responseError(
          error instanceof Error ? error.message : String(error),
          409,
        );
      }
    }
    if (request.method === "POST" && url.pathname === "/rollback") {
      try {
        const result = await rollback(env, await request.json());
        return Response.json(result, {
          status: result.failures.length ? 500 : 200,
        });
      } catch (error) {
        return responseError(
          error instanceof Error ? error.message : String(error),
          409,
        );
      }
    }
    return new Response("Not found", { status: 404 });
  },
};
