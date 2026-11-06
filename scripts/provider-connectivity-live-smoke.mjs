import { fileURLToPath } from "node:url";
import { publicProviderOperationIds } from "../packages/provider-contracts/index.js";

const operationSpecs = {
  "sura-vehicle-by-plate": { provider: "sura", requests: 1, smoke: true },
  "sbs-product-8-quote": { provider: "sbs", requests: 4, smoke: true },
  "sbs-product-10-quote": { provider: "sbs", requests: 9, smoke: false },
  "sbs-product-11-quote": { provider: "sbs", requests: 9, smoke: false },
};

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function inputFor(operationId, plate) {
  if (operationId === "sura-vehicle-by-plate") {
    return { sura_test_plate: plate };
  }
  if (operationId === "sbs-product-8-quote") {
    return {
      vehicle: {
        plate,
        fasecoldaCode: "12345678",
        productionYear: 2024,
        declaredValue: 50000000,
        circulationCity: "11001",
        isNew: false,
        use: "Particular",
        accessoriesValue: 0,
        shieldingValue: 0,
      },
      applicant: {
        documentType: "CC",
        documentNumber: "12345678",
        firstName: "Prueba",
        surname: "Savia",
        birthDate: "1990-01-02",
        gender: "F",
        occupation: "Pruebas",
        email: "provider-smoke@savia.test",
        phone: "3000000000",
        address: "Calle 1",
        city: "11001",
        department: "11",
      },
      preferences: { coverages: [] },
    };
  }
  return { vehicle: { plate } };
}

export function createProviderSmokePlan({
  attempts = 3,
  maxRequests = 10,
  providers,
} = {}) {
  const requestedAttempts = positiveInteger(attempts, "attempts");
  const limit = positiveInteger(maxRequests, "maxRequests");
  if (limit > 10) throw new Error("maxRequests cannot exceed 10");

  const grouped = new Map();
  for (const operationId of publicProviderOperationIds) {
    const spec = operationSpecs[operationId];
    if (!spec) throw new Error(`Missing smoke specification: ${operationId}`);
    if (!spec.smoke) continue;
    const group = grouped.get(spec.provider) ?? {
      provider: spec.provider,
      requestsPerAttempt: 0,
      operationIds: [],
    };
    group.requestsPerAttempt += spec.requests;
    group.operationIds.push(operationId);
    grouped.set(spec.provider, group);
  }

  const selected =
    Array.isArray(providers) && providers.length
      ? new Set(providers)
      : undefined;
  if (selected && [...selected].some((provider) => !grouped.has(provider))) {
    throw new Error("Unknown provider filter");
  }
  return [...grouped.values()]
    .filter((group) => !selected || selected.has(group.provider))
    .map((group) => {
      const attemptsForProvider = Math.min(
        requestedAttempts,
        Math.floor(limit / group.requestsPerAttempt),
      );
      return {
        provider: group.provider,
        attempts: attemptsForProvider,
        estimatedRequests: attemptsForProvider * group.requestsPerAttempt,
        operationIds: group.operationIds,
      };
    });
}

export async function executeProviderSmokeOperation({
  gatewayUrl,
  agencyId,
  operationId,
  plate,
  timeoutMs = 15_000,
  fetcher = fetch,
}) {
  let response;
  try {
    response = await fetcher(new URL("/internal/execute", gatewayUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agencyId,
        operationId,
        input: inputFor(operationId, plate),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return {
      status: 0,
      errorCode:
        error instanceof DOMException && error.name === "TimeoutError"
          ? "EXTERNAL_PROVIDER_TIMEOUT"
          : "EXTERNAL_PROVIDER_CONNECTION_ERROR",
    };
  }
  let errorCode;
  if (!response.ok) {
    try {
      errorCode = (await response.json())?.error?.code;
    } catch {
      // The smoke output intentionally excludes arbitrary upstream response data.
    }
  }
  return {
    status: response.status,
    ...(typeof errorCode === "string" ? { errorCode } : {}),
  };
}

export function parseProviderSmokeArgs(args) {
  const options = {
    agencyId: 10,
    attempts: 3,
    maxRequests: 10,
    plate: "",
    gatewayUrl: "http://127.0.0.1:8790",
    timeoutMs: 15_000,
    providers: [],
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index + 1];
    if (args[index] === "--agency")
      options.agencyId = positiveInteger(value, "agency");
    else if (args[index] === "--attempts")
      options.attempts = positiveInteger(value, "attempts");
    else if (args[index] === "--max-requests")
      options.maxRequests = positiveInteger(value, "maxRequests");
    else if (args[index] === "--plate") options.plate = value;
    else if (args[index] === "--gateway-url") options.gatewayUrl = value;
    else if (args[index] === "--timeout-ms") {
      options.timeoutMs = positiveInteger(value, "timeoutMs");
    } else if (args[index] === "--provider") options.providers.push(value);
    else throw new Error(`Unknown smoke option: ${args[index]}`);
    index += 1;
  }
  if (typeof options.plate !== "string" || !options.plate.trim()) {
    throw new Error("plate is required");
  }
  return options;
}

async function main() {
  const options = parseProviderSmokeArgs(process.argv.slice(2));
  const plan = createProviderSmokePlan(options);
  const results = [];
  for (const provider of plan) {
    for (let attempt = 1; attempt <= provider.attempts; attempt += 1) {
      for (const operationId of provider.operationIds) {
        const result = await executeProviderSmokeOperation({
          gatewayUrl: options.gatewayUrl,
          agencyId: options.agencyId,
          operationId,
          plate: options.plate.trim().toUpperCase(),
          timeoutMs: options.timeoutMs,
        });
        results.push({
          provider: provider.provider,
          operationId,
          attempt,
          ...result,
        });
      }
    }
  }
  process.stdout.write(`${JSON.stringify({ plan, results }, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Smoke test failed"}\n`,
    );
    process.exitCode = 1;
  });
}
