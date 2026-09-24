import { readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packageStorePlugin } from "./pack-store-plugin.mjs";

const workspaceRoot = resolve(import.meta.dirname, "..");

function fail(message) {
  throw new Error(`No se pudieron publicar los plugins: ${message}`);
}

/** `v1/dynamic-crm/:tenant` o `v1/data-domains/:domain` según destino. */
export function apiPrefix(apiUrl, { tenant, domain }) {
  const base = apiUrl.replace(/\/$/, "");
  if (tenant) return `${base}/v1/dynamic-crm/${encodeURIComponent(tenant)}/api`;
  if (domain)
    return `${base}/v1/data-domains/${encodeURIComponent(domain)}/api`;
  fail("indica --tenant (p. ej. agency:101) o --domain.");
}

export function parseArguments(argv) {
  const options = {
    ports: null,
    install: false,
    dryRun: false,
    tenant: null,
    domain: null,
    apiUrl: process.env.SAVIA_API_URL,
    cookie: process.env.SAVIA_SESSION_COOKIE,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) fail(`falta valor para ${arg}.`);
      return value;
    };
    if (arg === "--api-url") options.apiUrl = next();
    else if (arg === "--tenant") options.tenant = next();
    else if (arg === "--domain") options.domain = next();
    else if (arg === "--cookie") options.cookie = next();
    else if (arg === "--ports")
      options.ports = next()
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
    else if (arg === "--install") options.install = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else fail(`argumento desconocido: ${arg}.`);
  }
  if (!options.apiUrl) fail("indica --api-url o SAVIA_API_URL.");
  if (!options.tenant && !options.domain)
    fail("indica --tenant (p. ej. agency:101) o --domain.");
  if (!options.dryRun && !options.cookie)
    fail(
      "indica --cookie o SAVIA_SESSION_COOKIE con el header Cookie completo " +
        "de una sesión de administrador del espacio (DevTools → Application → Cookies).",
    );
  return options;
}

export function listPorts(only) {
  const dir = join(workspaceRoot, "store-ports");
  const all = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (!only) return all;
  for (const name of only) {
    if (!all.includes(name)) fail(`port desconocido: ${name}.`);
  }
  return only;
}

async function apiFetch(url, cookie, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.body instanceof FormData
        ? {}
        : { "content-type": "application/json" }),
      // La API reenvía la cookie al servicio de auth tal cual.
      cookie,
      ...init.headers,
    },
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // respuesta no JSON (p. ej. HTML de login expirado)
  }
  return { status: response.status, payload, text };
}

export async function publishPorts(options, io = {}) {
  const log = io.log ?? console.log;
  const prefix = apiPrefix(options.apiUrl, options);
  const results = [];
  for (const port of listPorts(options.ports)) {
    const entry = {
      port,
      id: null,
      version: null,
      sha256: null,
      uploaded: false,
      installed: false,
      error: null,
    };
    let artifactPath = null;
    try {
      const packed = packageStorePlugin({
        portDir: join("store-ports", port),
        outputPath: join(tmpdir(), `savia-publish-${Date.now()}-${port}.zip`),
      });
      artifactPath = packed.artifactPath;
      entry.id = packed.manifest.id;
      entry.version = packed.manifest.version;
      entry.sha256 = packed.sha256;
      if (options.dryRun) {
        entry.uploaded = "dry-run";
        log(`OK ${port} ${entry.id}@${entry.version} (dry-run)`);
        results.push(entry);
        continue;
      }
      const form = new FormData();
      form.set(
        "file",
        new File([readFileSync(artifactPath)], `${port}.store.zip`, {
          type: "application/zip",
        }),
      );
      const uploaded = await apiFetch(
        `${prefix}/plugin-store/upload`,
        options.cookie,
        { method: "POST", body: form },
      );
      if (uploaded.status !== 200) {
        throw new Error(
          typeof uploaded.payload?.error === "string"
            ? uploaded.payload.error
            : `upload HTTP ${uploaded.status}`,
        );
      }
      entry.uploaded = true;
      if (uploaded.payload?.data?.deduped) entry.uploaded = "deduped";
      if (options.install) {
        const installed = await apiFetch(
          `${prefix}/extensions/${encodeURIComponent(entry.id)}/install`,
          options.cookie,
          { method: "POST" },
        );
        if (installed.status !== 200) {
          throw new Error(
            typeof installed.payload?.error === "string"
              ? installed.payload.error
              : `install HTTP ${installed.status}`,
          );
        }
        entry.installed = true;
      }
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (artifactPath) {
        try {
          rmSync(artifactPath, { force: true });
        } catch {}
      }
    }
    log(
      `${entry.error ? "FAIL" : "OK"} ${port} ${entry.id ?? ""}@${entry.version ?? ""}` +
        (entry.uploaded === true
          ? " subido"
          : entry.uploaded
            ? ` (${entry.uploaded})`
            : "") +
        (entry.installed ? " instalado" : "") +
        (entry.error ? ` :: ${entry.error}` : ""),
    );
    results.push(entry);
  }
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const results = await publishPorts(options);
    const failed = results.filter((result) => result.error);
    if (failed.length) {
      console.error(`${failed.length} ports fallaron.`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
