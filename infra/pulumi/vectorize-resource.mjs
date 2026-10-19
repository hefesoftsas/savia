export function validateVectorizeInputs(inputs) {
  const keys = [
    "accountId",
    "environment",
    "name",
    "dimensions",
    "metric",
    "adoptExisting",
    "deleteData",
    "__provider",
    "__meta",
  ];
  if (
    !inputs ||
    Object.keys(inputs).some((key) => !keys.includes(key)) ||
    !/^[a-f\d]{32}$/.test(inputs.accountId) ||
    inputs.environment !== "preview" ||
    inputs.name !== "savia-pages-search-preview" ||
    inputs.dimensions !== 1024 ||
    inputs.metric !== "cosine" ||
    typeof inputs.adoptExisting !== "boolean" ||
    typeof inputs.deleteData !== "boolean"
  )
    throw new Error("Invalid immutable Preview Vectorize configuration");
  return inputs;
}
function verifyIndex(index, inputs) {
  if (!index) throw new Error("Adopted Vectorize index is missing");
  if (
    index.name !== inputs.name ||
    index.config?.dimensions !== inputs.dimensions ||
    index.config?.metric !== inputs.metric
  )
    throw new Error("Vectorize index configuration mismatch");
}
export function makeVectorizeProvider(dependencies) {
  return {
    check: async (_old, news) => {
      validateVectorizeInputs(news);
      return { inputs: news, failures: [] };
    },
    diff: async (_id, olds, news) => {
      validateVectorizeInputs(olds);
      validateVectorizeInputs(news);
      if (olds.accountId !== news.accountId)
        throw new Error("Immutable Vectorize account cannot change");
      return { changes: olds.deleteData !== news.deleteData, replaces: [] };
    },
    create: async (inputs) => {
      validateVectorizeInputs(inputs);
      const operations = await dependencies(inputs);
      const existing = await operations.read();
      if (existing) verifyIndex(existing, inputs);
      else if (inputs.adoptExisting)
        throw new Error("Adopted Vectorize index is missing");
      else {
        await operations.create();
        verifyIndex(await operations.read(), inputs);
      }
      return { id: `${inputs.accountId}/${inputs.name}`, outs: inputs };
    },
    read: async (id, inputs) => {
      validateVectorizeInputs(inputs);
      const index = await (await dependencies(inputs)).read();
      if (!index) return { id: undefined, props: inputs };
      verifyIndex(index, inputs);
      return { id, props: inputs };
    },
    update: async (_id, _olds, news) => {
      validateVectorizeInputs(news);
      return { outs: news };
    },
    delete: async (_id, inputs) => {
      validateVectorizeInputs(inputs);
      if (!inputs.deleteData)
        throw new Error("Vectorize deletion requires explicit data deletion");
      await (await dependencies(inputs)).remove();
    },
  };
}
export function vectorizeCloudOperations(
  inputs,
  { env = process.env, fetcher = globalThis.fetch } = {},
) {
  validateVectorizeInputs(inputs);
  if (
    !env.CLOUDFLARE_API_TOKEN ||
    env.CLOUDFLARE_ACCOUNT_ID !== inputs.accountId
  )
    throw new Error("Vectorize execution credentials/account mismatch");
  const base = `https://api.cloudflare.com/client/v4/accounts/${inputs.accountId}/vectorize/v2/indexes`;
  async function request(method, path, body) {
    const response = await fetcher(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json();
    const missing =
      method === "GET" &&
      ((response.status === 404 && !payload.errors?.length) ||
        (payload.errors?.length &&
          payload.errors.every(
            (error) =>
              error.code === 3000 &&
              error.message?.startsWith("vectorize.index.not_found"),
          )));
    if (missing) return undefined;
    if (!response.ok || !payload.success)
      throw new Error(`Vectorize ${method} failed (${response.status})`);
    return payload.result;
  }
  return {
    read: () => request("GET", `/${inputs.name}`),
    create: () =>
      request("POST", "", {
        name: inputs.name,
        config: { dimensions: inputs.dimensions, metric: inputs.metric },
        description: "Savia preview Pages semantic search",
      }),
    remove: () => request("DELETE", `/${inputs.name}`),
  };
}
export async function vectorizeDependencies(inputs) {
  const { resolve } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const operations = await import(
    pathToFileURL(resolve(process.cwd(), "vectorize-resource.mjs")).href
  );
  return operations.vectorizeCloudOperations(inputs);
}
