const CONTROL_PREFIX = "/api/_internal/backup-gate/";
const CAPABILITY_PATH = "/_internal/savia-backup-capability";
const NAME = "production-backup-v1";

function capability(env) {
  return {
    version: 1,
    required: env.SAVIA_BACKUP_GATE_REQUIRED === "true",
    gateId: env.BACKUP_GATE?.idFromName(NAME).toString() ?? null,
  };
}

export function backupCapability(request, env) {
  if (new URL(request.url).pathname !== CAPABILITY_PATH) return null;
  return Response.json(capability(env), {
    headers: { "Cache-Control": "no-store" },
  });
}

async function authorized(request, env) {
  const expected = env.SAVIA_BACKUP_CONTROL_SECRET;
  if (typeof expected !== "string" || expected.length < 32) return false;
  const supplied = request.headers.get("authorization") ?? "";
  const digest = async (value) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    );
  const [left, right] = await Promise.all([
    digest(supplied),
    digest(`Bearer ${expected}`),
  ]);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

async function verifyWriters(env) {
  const own = capability(env);
  if (!own.required || !own.gateId)
    throw new Error("Storage barrier unavailable");
  // Flows owns independent databases/buckets/DOs and must not be silently omitted.
  if (
    env.SAVIA_FLOWS_QUOTAS_ENABLED === "true" ||
    env.SAVIA_FLOWS_EXECUTION_ENABLED === "true"
  )
    throw new Error(
      "Flows requires an independent coordinated maintenance window",
    );
  await Promise.all(
    ["AUTH", "SAVIA_REQUEST", "CONNECTOR_GATEWAY"].map(async (name) => {
      const peer = env[name];
      if (!peer?.fetch) throw new Error("Writer unavailable");
      const response = await peer.fetch(
        new Request(`https://writer.internal${CAPABILITY_PATH}`, {
          signal: AbortSignal.timeout(10000),
        }),
      );
      if (!response.ok) throw new Error("Writer unavailable");
      const value = await response.json();
      if (
        value.version !== 1 ||
        value.required !== true ||
        value.gateId !== own.gateId
      )
        throw new Error("Writer is missing the shared storage barrier");
    }),
  );
}

export async function handleBackupControl(request, env) {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith(CONTROL_PREFIX)) return null;
  if (!(await authorized(request, env)))
    return new Response("Unauthorized", { status: 401 });
  const action = pathname.slice(CONTROL_PREFIX.length);
  if (
    request.method !== "POST" ||
    !["acquire", "status", "renew", "release"].includes(action)
  )
    return new Response("Not found", { status: 404 });
  try {
    if (action === "acquire") await verifyWriters(env);
    if (!env.BACKUP_GATE) throw new Error("Storage barrier unavailable");
    if (Number(request.headers.get("content-length") ?? 0) > 4096)
      return new Response("Invalid request", { status: 400 });
    const text = await request.text();
    if (text.length > 4096)
      return new Response("Invalid request", { status: 400 });
    const stub = env.BACKUP_GATE.get(env.BACKUP_GATE.idFromName(NAME));
    const response = await stub.fetch(
      new Request(`https://backup-gate.internal/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      }),
    );
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      {
        error: "Backup barrier is unavailable or writer coverage is incomplete",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
