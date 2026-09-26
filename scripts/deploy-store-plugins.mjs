import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listPorts, publishPorts } from "./publish-store-plugins.mjs";

export function deploymentTargets(raw) {
  if (!raw?.trim()) return [];
  const targets = JSON.parse(raw);
  if (!Array.isArray(targets))
    throw new Error("SAVIA_PLUGIN_TARGETS must be an array.");
  for (const target of targets) {
    if (
      !target ||
      Boolean(target.tenant) === Boolean(target.domain) ||
      (target.tenant && typeof target.tenant !== "string") ||
      (target.domain && typeof target.domain !== "string") ||
      (target.ports !== undefined &&
        (!Array.isArray(target.ports) || !target.ports.length)) ||
      (target.artifactDirectory !== undefined &&
        typeof target.artifactDirectory !== "string")
    )
      throw new Error(
        "Each target requires exactly one tenant or domain and optional ports/artifactDirectory.",
      );
    listPorts(target.ports ?? null);
  }
  return targets;
}

export async function deployStorePlugins(env = process.env, io = {}) {
  const log = io.log ?? console.log;
  const targets = deploymentTargets(env.SAVIA_PLUGIN_TARGETS);
  if (!targets.length) {
    log(
      "Plugin deployment skipped: SAVIA_PLUGIN_TARGETS has no opted-in workspaces.",
    );
    return [];
  }
  const origin = new URL(env.SAVIA_API_URL).origin;
  if (!env.SAVIA_DEPLOY_EMAIL || !env.SAVIA_DEPLOY_PASSWORD)
    throw new Error(
      "Configured plugin targets require SAVIA_DEPLOY_EMAIL and SAVIA_DEPLOY_PASSWORD.",
    );
  const request = io.fetch ?? fetch;
  const session = await request(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({
      email: env.SAVIA_DEPLOY_EMAIL,
      password: env.SAVIA_DEPLOY_PASSWORD,
    }),
  });
  if (!session.ok)
    throw new Error(`Deployment sign-in failed (HTTP ${session.status}).`);
  const body = await session.json();
  if (body.twoFactorRedirect)
    throw new Error(
      "Deployment account requires interactive MFA; no plugins were deployed.",
    );
  const cookie = session.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  if (!cookie)
    throw new Error("Deployment sign-in did not return a session cookie.");
  const results = [];
  try {
    for (const target of targets) {
      const common = {
        apiUrl: origin,
        cookie,
        tenant: target.tenant,
        domain: target.domain,
        updateInstalled: true,
      };
      if (!target.artifactDirectory || target.ports) {
        results.push(
          ...(await (io.publish ?? publishPorts)(
            { ...common, ports: target.ports },
            { log },
          )),
        );
      }
      if (target.artifactDirectory) {
        const artifacts = readdirSync(target.artifactDirectory, {
          withFileTypes: true,
        })
          .filter((entry) => entry.isFile() && entry.name.endsWith(".zip"))
          .map((entry) => join(target.artifactDirectory, entry.name))
          .sort();
        if (!artifacts.length)
          throw new Error(`No ZIP artifacts in ${target.artifactDirectory}.`);
        results.push(
          ...(await (io.publish ?? publishPorts)(
            { ...common, artifacts },
            { log },
          )),
        );
      }
    }
    if (results.some((result) => result.error))
      throw new Error(
        "Plugin deployment failed; inspect the per-plugin results.",
      );
    return results;
  } finally {
    const signedOut = await request(`${origin}/api/auth/sign-out`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: { cookie, origin, "content-type": "application/json" },
      body: "{}",
    });
    if (!signedOut.ok)
      throw new Error(`Deployment sign-out failed (HTTP ${signedOut.status}).`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await deployStorePlugins();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
