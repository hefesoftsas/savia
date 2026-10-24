import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { patchSecopGateway } from "./secop-gateway-patch.mjs";

const fixturePath = new URL(
  "./fixtures/secop-configured-model.mjs",
  import.meta.url,
);
const source = await readFile(fixturePath, "utf8");
const patchInput = source;
const patched = patchSecopGateway(source);
const patchedFixture = patched;

function modelFrom(sourceText, env, providers = {}) {
  const start = sourceText.indexOf("var ConfiguredModel = class {");
  assert.notEqual(start, -1, "ConfiguredModel class is present");
  const end = sourceText.indexOf("\n};", start);
  assert.notEqual(end, -1, "ConfiguredModel class has an end anchor");
  const classCode = sourceText.slice(start, end + 3);
  const sandbox = {
    AbortSignal,
    Date,
    DossierError: class DossierError extends Error {
      constructor(code, status = 500, retryable = false, details) {
        super(code);
        this.code = code;
        this.status = status;
        this.retryable = retryable;
        this.details = details;
      }
    },
    DEFAULT_REQUEST_TIMEOUT_MS: 100,
    DEFAULT_RETRY_DELAY_MS: 0,
    MAX_PHYSICAL_ATTEMPTS: 3,
    TextDecoder,
    URL,
    boundedBytes: async (response) => response.arrayBuffer(),
    explicitWorkersAIModels: new Map([["@cf/test/model", "@cf/test/model"]]),
    isTransientProviderFailure: (error) => Boolean(error.retryable),
    modelUnavailable: () => new Error("unavailable"),
    nonRetryableProviderErrorTypes: new Set(),
    numericProviderErrorCode: () => undefined,
    openRouterHttpErrorDiagnostic: async () => undefined,
    outputLengthErrorTypes: new Set(),
    providerFailure: (error) => error,
    retryableProviderErrorTypes: new Set(),
    safeContentType: (value) => value ?? "unknown",
    safeFinishReason: (value) => value,
    safeProviderErrorType: () => undefined,
    safeProviderLabel: () => undefined,
    safeProviderSlug: () => undefined,
    system: "system prompt",
    ...providers,
  };
  vm.runInNewContext(
    `${classCode}\nthis.ConfiguredModel = ConfiguredModel;`,
    sandbox,
  );
  return new sandbox.ConfiguredModel(env, undefined, undefined, {
    retryDelayMs: 0,
  });
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const input = { prompt: "budget check", outputSchema: { type: "object" } };

test("patched model uses OpenRouter HTTP gateway without a native AI binding", async () => {
  let captured;
  const model = modelFrom(
    patched,
    {
      AI_GATEWAY_ID: "default",
      CF_ACCOUNT_ID: "account",
      CF_AIG_TOKEN: "gateway-secret",
      MODEL_NAME: "openai/gpt-4o-mini",
      MODEL_URL: "https://openrouter.ai/api/v1/chat/completions",
      OPENROUTER_API_KEY: "secret",
      MODEL_MAX_PRICE_PROMPT: "0.15",
      MODEL_MAX_PRICE_COMPLETION: "0.75",
    },
    {
      fetch: async (url, init) => {
        captured = { url, init };
        return response({ choices: [{ message: { content: '{"ok":true}' } }] });
      },
    },
  );
  assert.equal(JSON.stringify(await model.generate(input)), '{"ok":true}');
  assert.equal(
    captured.url,
    "https://gateway.ai.cloudflare.com/v1/account/default/openrouter/chat/completions",
  );
  assert.equal(captured.init.headers.Authorization, "Bearer secret");
  assert.equal(
    captured.init.headers["cf-aig-authorization"],
    "Bearer gateway-secret",
  );
  assert.equal(captured.init.headers["cf-aig-collect-log"], "false");
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body.provider.max_price, { prompt: 0.15, completion: 0.75 });
  assert.equal(body.provider.data_collection, "deny");
  assert.equal(body.provider.require_parameters, true);
});

test("paused model spend fails before budget hooks and every provider call", async () => {
  let calls = 0;
  const model = modelFrom(
    patched,
    {
      MODEL_SPEND_PAUSED: "true",
      MODEL_NAME: "openai/gpt-4o-mini",
      MODEL_URL: "https://openrouter.ai/api/v1/chat/completions",
      OPENROUTER_API_KEY: "secret",
      MODEL_MAX_CALLS: "invalid",
    },
    {
      fetch: async () => {
        calls++;
      },
    },
  );
  model.consumeBudget = async () => {
    calls++;
  };
  model.heartbeat = async () => {
    calls++;
  };

  await assert.rejects(
    model.generate(input),
    (error) =>
      error.code === "MODEL_SPEND_PAUSED" &&
      error.status === 503 &&
      error.retryable === false,
  );
  assert.equal(calls, 0);
});

test("missing HTTP gateway credentials fails closed before any fetch", async () => {
  let directFetchCalls = 0;
  const model = modelFrom(
    patched,
    {
      AI_GATEWAY_ID: "cost-guard",
      MODEL_NAME: "openai/gpt-4o-mini",
      MODEL_URL: "https://openrouter.ai/api/v1/chat/completions",
      OPENROUTER_API_KEY: "secret",
    },
    {
      fetch: async () => {
        directFetchCalls++;
      },
    },
  );

  await assert.rejects(
    model.generate(input),
    (error) => error.code === "MODEL_GATEWAY_UNAVAILABLE",
  );
  assert.equal(directFetchCalls, 0);
});

test("configured gateway rejects Workers AI before calling AI.run", async () => {
  let workersAiCalls = 0;
  const model = modelFrom(patched, {
    AI: {
      run: async () => {
        workersAiCalls++;
      },
    },
    AI_GATEWAY_ID: "cost-guard",
    MODEL_NAME: "@cf/test/model",
    MODEL_TRANSPORT: "workers_ai",
  });

  await assert.rejects(
    model.generate(input),
    (error) => error.code === "MODEL_CLOUDFLARE_AI_FORBIDDEN",
  );
  assert.equal(workersAiCalls, 0);
});

test("HTTP gateway budget denial is terminal and never falls back", async () => {
  let calls = 0;
  const model = modelFrom(
    patched,
    {
      AI_GATEWAY_ID: "default",
      CF_ACCOUNT_ID: "account",
      CF_AIG_TOKEN: "gateway-secret",
      MODEL_NAME: "openai/gpt-4o-mini",
      MODEL_URL: "https://openrouter.ai/api/v1/chat/completions",
      OPENROUTER_API_KEY: "secret",
    },
    {
      fetch: async (url) => {
        calls++;
        assert.match(url, /^https:\/\/gateway\.ai\.cloudflare\.com\//);
        return response({ error: "budget exceeded" }, 429);
      },
    },
  );
  await assert.rejects(
    model.generate(input),
    (e) =>
      e.code === "MODEL_GATEWAY_LIMIT_REACHED" &&
      e.status === 429 &&
      !e.retryable,
  );
  assert.equal(calls, 1);
});

test("patching is idempotent and rejects unknown or ambiguous source", () => {
  assert.equal(patchSecopGateway(patchedFixture), patchedFixture);
  assert.throws(
    () => patchSecopGateway("unrecognized SECOP bundle"),
    /anchor/i,
  );
  assert.throws(
    () => patchSecopGateway(`${patchInput}\n${patchInput}`),
    /ambiguous|anchor/i,
  );
});
