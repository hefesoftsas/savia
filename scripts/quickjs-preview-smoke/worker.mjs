const HEALTH_CODE =
  'req.setBody(body + ":" + bru.getEnvVar("marker")); bru.setVar("smokeToken", "synthetic-token");';
const HEALTH_PAYLOAD = {
  body: "quickjs-smoke",
  values: { marker: "transformed" },
};
const ISOLATION_WRITE_CODE =
  'globalThis.__saviaQuickJsSmokeLeak = "present"; req.setBody("written");';
const ISOLATION_READ_CODE =
  'if (globalThis.__saviaQuickJsSmokeLeak !== undefined) throw new Error("leak"); req.setBody("isolated");';
const CPU_LIMIT_CODE =
  'const candidate = "a".repeat(32) + "!"; /^(a+)+$/.test(candidate);';
const EXPECTED_MIN_CPU_MS = 25_000;
const EXPECTED_MAX_CPU_MS = 45_000;

async function execute(env, code, payload) {
  if (!env?.HOOK_SERVICE) throw new Error("service unavailable");
  return env.HOOK_SERVICE.fetch(
    new Request("https://savia-hook-executor.internal/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, payload }),
    }),
  );
}

async function health(env) {
  const response = await execute(env, HEALTH_CODE, HEALTH_PAYLOAD);
  if (!response.ok) return false;
  const result = await response.json().catch(() => null);
  return (
    result?.body === "quickjs-smoke:transformed" &&
    result?.variables?.smokeToken === "synthetic-token"
  );
}

async function isolation(env) {
  const payload = { body: "isolation-smoke", values: {} };
  const first = await execute(env, ISOLATION_WRITE_CODE, payload);
  if (!first.ok) return false;
  const firstResult = await first.json().catch(() => null);
  if (firstResult?.body !== "written") return false;
  const second = await execute(env, ISOLATION_READ_CODE, payload);
  if (!second.ok) return false;
  const secondResult = await second.json().catch(() => null);
  return secondResult?.body === "isolated";
}

function json(status, result) {
  return Response.json(result, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function hasCpuLimitEvidence(value) {
  if (typeof value === "string") {
    return (
      /\b1102\b/.test(value) ||
      /exceeded\s+(?:the\s+)?cpu(?:\s+time)?\s+(?:execution\s+)?limit/i.test(
        value,
      ) ||
      /cpu(?:\s+time)?\s+limit\s+(?:was\s+)?exceeded/i.test(value)
    );
  }
  if (!value || typeof value !== "object") return false;
  const result = value;
  if (
    result.code === 1102 ||
    result.code === "1102" ||
    result.error_code === 1102 ||
    result.error_code === "1102" ||
    result.errorCode === 1102 ||
    result.errorCode === "1102" ||
    result.exceededCpu === true
  ) {
    return true;
  }
  return [result.message, result.error, result.detail].some(
    (item) => typeof item === "string" && hasCpuLimitEvidence(item),
  );
}

async function responseShowsCpuLimit(response) {
  try {
    const body = await response.clone().text();
    if (hasCpuLimitEvidence(body)) return true;
    try {
      return hasCpuLimitEvidence(JSON.parse(body));
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

function errorShowsCpuLimit(error) {
  return hasCpuLimitEvidence(error);
}

function isRuntimeRejection(error) {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "";
  return /runtime.{0,30}(?:interrupt|reject)|(?:interrupt|reject).{0,30}runtime/i.test(
    message,
  );
}

export function createSmokeWorker({ now = Date.now } = {}) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (request.method !== "GET" || url.search || url.hash)
        return new Response("Not found", { status: 404 });

      if (url.pathname === "/health") {
        try {
          if (await health(env)) return json(200, { outcome: "health-passed" });
        } catch {
          // Keep service diagnostics private and return only a fixed outcome.
        }
        return json(503, { outcome: "health-failed" });
      }

      if (url.pathname === "/isolation") {
        try {
          if (await isolation(env))
            return json(200, { outcome: "isolation-passed" });
        } catch {
          // Keep service diagnostics private and return only a fixed outcome.
        }
        return json(503, { outcome: "isolation-failed" });
      }

      if (url.pathname === "/cpu") {
        const started = now();
        let outcome = "unexpected-completion";
        let elapsedMs = 0;
        try {
          const response = await execute(env, CPU_LIMIT_CODE, {
            body: "cpu-smoke",
            values: {},
          });
          elapsedMs = Math.max(0, now() - started);
          if (response.status === 422) outcome = "runtime-rejected";
          else if (
            !response.ok &&
            elapsedMs >= EXPECTED_MIN_CPU_MS &&
            elapsedMs <= EXPECTED_MAX_CPU_MS &&
            (await responseShowsCpuLimit(response))
          )
            outcome = "platform-terminated";
          else if (!response.ok) outcome = "termination-unverified";
        } catch (error) {
          elapsedMs = Math.max(0, now() - started);
          outcome =
            elapsedMs >= EXPECTED_MIN_CPU_MS &&
            elapsedMs <= EXPECTED_MAX_CPU_MS &&
            errorShowsCpuLimit(error)
              ? "platform-terminated"
              : isRuntimeRejection(error)
                ? "runtime-rejected"
                : "termination-unverified";
        }

        let recovered = false;
        try {
          recovered = await health(env);
        } catch {
          recovered = false;
        }
        const accepted = outcome === "platform-terminated" && recovered;
        return json(accepted ? 200 : 503, {
          outcome,
          elapsedMs,
          recovered,
        });
      }

      return new Response("Not found", { status: 404 });
    },
  };
}

export default createSmokeWorker();
