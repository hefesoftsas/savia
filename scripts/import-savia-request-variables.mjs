import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";

// Import only missing values. Existing production values and unrelated rows win.
// The envelope matches Savia Request's AES-GCM iv.ciphertext storage format.
export async function importVariables({ query, flows, encryptionKey }) {
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
          "SELECT id FROM flows WHERE id=? AND COALESCE(json_extract(definition, '$.deleted'),0)=0",
          [flow.flowId],
        )
      ).length
    )
      throw new Error(`Missing flow: ${flow.flowId}`);
  }
  const summary = { flows: flows.length, imported: 0, preserved: 0 };
  for (const flow of flows) {
    for (const variable of flow.variables) {
      if (!variable.value) continue;
      const [existing] = await query(
        "SELECT value,secret FROM flow_variables WHERE flow_id=? AND key=?",
        [flow.flowId, variable.key],
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
        "INSERT INTO flow_variables(flow_id,key,value,secret) VALUES(?,?,?,?) ON CONFLICT(flow_id,key) DO UPDATE SET value=excluded.value,secret=excluded.secret WHERE flow_variables.value='' RETURNING key",
        [flow.flowId, variable.key, value, secret ? 1 : 0],
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
      }),
    ),
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
