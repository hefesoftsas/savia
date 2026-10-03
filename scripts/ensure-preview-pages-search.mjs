import { fileURLToPath } from "node:url";

/** Provision only the isolated preview index; no production mutations. */
export async function ensurePreviewPagesSearch({
  accountId,
  apiToken,
  fetcher = fetch,
}) {
  if (!accountId || !apiToken)
    throw new Error("Cloudflare preview credentials are required");
  const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/vectorize/v2/indexes`;
  const name = "savia-pages-search-preview";
  const headers = {
    authorization: `Bearer ${apiToken}`,
    "content-type": "application/json",
  };
  let response = await fetcher(`${base}/${name}`, { headers });
  let body = await response.json();
  if (response.status === 404) {
    response = await fetcher(base, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name,
        config: { dimensions: 1024, metric: "cosine" },
        description: "Savia preview Pages semantic search",
      }),
    });
    body = await response.json();
  }
  if (!response.ok || !body.success)
    throw new Error(
      "Cannot provision isolated Pages search index; Cloudflare token needs Vectorize edit access",
    );
  if (
    body.result?.config?.dimensions !== 1024 ||
    body.result?.config?.metric !== "cosine"
  )
    throw new Error("Preview Pages search index configuration mismatch");
  console.log("Isolated preview Pages search index verified.");
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  ensurePreviewPagesSearch({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
