import { fileURLToPath } from "node:url";

export function assertPreviewDatabase(database, name, id) {
  if (database?.name !== name || database?.uuid !== id) {
    throw new Error(
      `Deployment requires the isolated preview database ${name}`,
    );
  }
}

async function main() {
  const env = process.env;
  for (const key of [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "SAVIA_AUTH_D1_ID",
    "SAVIA_DOMAIN_D1_ID",
  ]) {
    if (!env[key]) throw new Error(`${key} is required`);
  }
  if (env.SAVIA_DOCUMENTS_BUCKET !== "savia-documents-preview") {
    throw new Error("Deployment requires isolated preview object storage");
  }
  for (const [name, id] of [
    ["savia-auth-preview", env.SAVIA_AUTH_D1_ID],
    ["savia-agencies-preview", env.SAVIA_DOMAIN_D1_ID],
  ]) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${id}`,
      {
        headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
      },
    );
    const body = await response.json();
    if (!response.ok || !body.success)
      throw new Error("Cannot verify preview database metadata");
    assertPreviewDatabase(body.result, name, id);
  }
  console.log("Preview databases and object storage are isolated.");
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
