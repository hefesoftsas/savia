import { appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const zone = "b3255bc65c2bc8cb8edf33a34e08b255";
const patterns = ["savia.hefesoft.com/*", "*.savia.hefesoft.com/*"];
const bridge = "savia-domain-transition";

export async function transferDomainRoutes({
  token,
  restore = false,
  fetcher = fetch,
}) {
  if (!token) throw new Error("Cloudflare API token is required");
  const endpoint = `https://api.cloudflare.com/client/v4/zones/${zone}/workers/routes`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const response = await fetcher(endpoint, {
    headers,
    signal: AbortSignal.timeout(20000),
  });
  const inventory = await response.json();
  if (!response.ok || !inventory.success || !Array.isArray(inventory.result))
    throw new Error("Unable to inspect canonical domain routes");
  const routes = inventory.result.filter((r) => patterns.includes(r.pattern));
  if (
    routes.length !== patterns.length ||
    new Set(routes.map((r) => r.pattern)).size !== patterns.length
  )
    throw new Error("Canonical domain route inventory is incomplete");
  if (routes.some((r) => !["savia", bridge].includes(r.script)))
    throw new Error("Canonical domain route has an unexpected owner");
  if (!restore && new Set(routes.map((r) => r.script)).size !== 1)
    throw new Error("Canonical domain route ownership is inconsistent");
  const from = restore ? "savia" : bridge;
  const to = restore ? bridge : "savia";
  const changes = routes.filter((r) => r.script === from);
  for (const route of changes) {
    const updated = await fetcher(`${endpoint}/${route.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ pattern: route.pattern, script: to }),
      signal: AbortSignal.timeout(20000),
    });
    const result = await updated.json();
    if (!updated.ok || !result.success)
      throw new Error("Unable to transfer canonical domain route");
  }
  return changes.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const restore = process.argv.includes("--restore");
  if (restore && process.env.SAVIA_DOMAIN_TRANSITION_RELEASED !== "true") {
    console.log("No domain transition release to restore.");
  } else {
    // Set rollback intent before mutation so partial API failures are recoverable.
    if (!restore && process.env.GITHUB_ENV)
      await appendFile(
        process.env.GITHUB_ENV,
        "SAVIA_DOMAIN_TRANSITION_RELEASED=true\n",
      );
    const count = await transferDomainRoutes({
      token: process.env.CLOUDFLARE_API_TOKEN,
      restore,
    });
    if (!restore && count === 0 && process.env.GITHUB_ENV)
      await appendFile(
        process.env.GITHUB_ENV,
        "SAVIA_DOMAIN_TRANSITION_RELEASED=false\n",
      );
    console.log(
      `${restore ? "Restored" : "Released"} ${count} domain transition routes.`,
    );
  }
}
