import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";

// Import only missing values. Existing production values and unrelated rows win.
// The envelope matches Savia Request's AES-GCM iv.ciphertext storage format.
// Without `tenant` the platform catalog (flow_variables) is targeted, exactly
// as before. With `tenant` (e.g. "agency:101") only that tenant's overlays
// (tenant_flow_variables) are written; flows resolve with the same
// overlay-then-catalog fallback the worker uses, and tombstoned flows reject.
const TENANT_PATTERN = /^[A-Za-z0-9:_.-]{1,120}$/;
export async function importVariables({ query, flows, encryptionKey, tenant }) {
  const scope = tenant === undefined || tenant === null ? "" : String(tenant);
  if (scope && !TENANT_PATTERN.test(scope)) throw new Error("Invalid tenant");
  const material = Buffer.from(encryptionKey ?? "", "base64");
  if (material.length !== 32)
    throw new Error("Encryption key must contain 32 bytes");
  const key = await webcrypto.subtle.importKey(
    "raw",
    material,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  if (!Array.isArray(flows) || !flows.length)
    throw new Error("Expected nonempty flow list");
  const ids = new Set();
  for (const flow of flows) {
    if (
      !flow ||
      typeof flow.flowId !== "string" ||
      !flow.flowId ||
      ids.has(flow.flowId) ||
      !Array.isArray(flow.variables)
    )
      throw new Error("Invalid flow");
    ids.add(flow.flowId);
    const keys = new Set();
    for (const variable of flow.variables) {
      if (
        !variable ||
        typeof variable.key !== "string" ||
        !variable.key ||
        keys.has(variable.key) ||
        typeof variable.value !== "string" ||
        typeof variable.secret !== "boolean"
      )
        throw new Error("Invalid variable");
      keys.add(variable.key);
    }
    if (
      !(
        await query(
          scope
            ? "SELECT 1 FROM tenant_flows WHERE tenant_id=? AND flow_id=? AND COALESCE(json_extract(definition, '$.deleted'),0)=0 UNION ALL SELECT 1 FROM flows WHERE id=? AND COALESCE(json_extract(definition, '$.deleted'),0)=0 AND NOT EXISTS(SELECT 1 FROM tenant_flows WHERE tenant_id=? AND flow_id=?)"
            : "SELECT id FROM flows WHERE id=? AND COALESCE(json_extract(definition, '$.deleted'),0)=0",
          scope
            ? [scope, flow.flowId, flow.flowId, scope, flow.flowId]
            : [flow.flowId],
        )
      ).length
    )
      throw new Error(`Missing flow: ${flow.flowId}`);
  }
  const summary = { flows: flows.length, imported: 0, preserved: 0 };
  if (scope) summary.tenant = scope;
  const now = () => new Date().toISOString();
  for (const flow of flows) {
    for (const variable of flow.variables) {
      if (!variable.value) continue;
      const [existing] = await query(
        scope
          ? "SELECT value,secret FROM tenant_flow_variables WHERE tenant_id=? AND flow_id=? AND key=?"
          : "SELECT value,secret FROM flow_variables WHERE flow_id=? AND key=?",
        scope
          ? [scope, flow.flowId, variable.key]
          : [flow.flowId, variable.key],
      );
      if (existing?.value) {
        summary.preserved++;
        continue;
      }
      const secret = variable.secret || Boolean(existing?.secret);
      let value = variable.value;
      if (secret) {
        const iv = webcrypto.getRandomValues(new Uint8Array(12));
        const encrypted = await webcrypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          key,
          new TextEncoder().encode(value),
        );
        value =
          Buffer.from(iv).toString("base64") +
          "." +
          Buffer.from(encrypted).toString("base64");
      }
      const result = await query(
        scope
          ? "INSERT INTO tenant_flow_variables(tenant_id,flow_id,key,value,secret,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,flow_id,key) DO UPDATE SET value=excluded.value,secret=excluded.secret,updated_at=excluded.updated_at WHERE tenant_flow_variables.value='' RETURNING key"
          : "INSERT INTO flow_variables(flow_id,key,value,secret) VALUES(?,?,?,?) ON CONFLICT(flow_id,key) DO UPDATE SET value=excluded.value,secret=excluded.secret WHERE flow_variables.value='' RETURNING key",
        scope
          ? [scope, flow.flowId, variable.key, value, secret ? 1 : 0, now()]
          : [flow.flowId, variable.key, value, secret ? 1 : 0],
      );
      if (result.length) summary.imported++;
      else summary.preserved++;
    }
  }
  return summary;
}

async function main() {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const database = process.env.CLOUDFLARE_DATABASE_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !database || !token)
    throw new Error("Missing Cloudflare configuration");
  let flows;
  try {
    flows = JSON.parse(process.env.SAVIA_REQUEST_IMPORT_VARIABLES_JSON ?? "");
  } catch {
    throw new Error("Invalid import payload");
  }
  const query = async (sql, params = []) => {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ sql, params }),
      },
    );
    const body = await response.json();
    // API diagnostics can echo query parameters; never log them for this operation.
    if (
      !response.ok ||
      body.success !== true ||
      body.result?.some((result) => result.success === false)
    )
      throw new Error(`D1 import request failed (HTTP ${response.status})`);
    return body.result?.[0]?.results ?? [];
  };
  console.log(
    JSON.stringify(
      await importVariables({
        query,
        flows,
        encryptionKey: process.env.SAVIA_REQUEST_ENCRYPTION_KEY,
        tenant: process.env.SAVIA_REQUEST_TENANT || undefined,
      }),
    ),
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
