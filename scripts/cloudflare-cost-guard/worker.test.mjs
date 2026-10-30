import test from "node:test";
import assert from "node:assert/strict";
import {
  executeCheck,
  evaluateBillableUsage,
  pauseTargets,
} from "./worker.mjs";

const base = Date.parse("2026-10-24T12:00:00Z");
const cloudflare = (result) => Response.json({ success: true, result });
const rows = (costs, end = "2026-10-24T11:00:00Z") =>
  costs.map((cost, i) => ({
    BillingAccountId: "acct",
    BillingCurrency: "USD",
    BillingPeriodStart: "2026-10-01T00:00:00Z",
    ChargePeriodStart: `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    ChargePeriodEnd: end,
    ContractedCost: cost,
    CumulatedContractedCost: 9999,
    ServiceName: "Workers",
    ChargeDescription: "Workers Standard usage",
    ServiceFamilyName: "Workers",
  }));

test("threshold trips at equality and above after fixed reserve; below remains running", () => {
  assert.equal(
    evaluateBillableUsage(rows([9.99]), { accountId: "acct", now: base })
      .tripped,
    false,
  );
  assert.equal(
    evaluateBillableUsage(rows([10]), { accountId: "acct", now: base }).tripped,
    true,
  );
  assert.equal(
    evaluateBillableUsage(rows([10.01]), { accountId: "acct", now: base })
      .tripped,
    true,
  );
});

test("accepts distinct billing metrics for the same period and rejects exact metric duplicates", () => {
  const first = rows([2])[0];
  const second = {
    ...first,
    ServiceName: "Workers AI",
    ServiceFamilyName: "AI",
    ContractedCost: 3,
  };
  const duplicate = { ...first };
  const result = evaluateBillableUsage([first, second], {
    accountId: "acct",
    now: base,
  });
  assert.equal(result.tripped, false);
  assert.equal(result.usageUsd, 5);
  assert.equal(
    evaluateBillableUsage([first, duplicate], { accountId: "acct", now: base })
      .reason,
    "billing_invalid",
  );
});

test("sums charge-period amounts, not cumulative totals, and fails closed on invalid billing", () => {
  assert.equal(
    evaluateBillableUsage(rows([3, 4]), { accountId: "acct", now: base })
      .usageUsd,
    7,
  );
  for (const invalid of [
    [],
    [{ ...rows([1])[0], BillingAccountId: "other" }],
    [{ ...rows([1])[0], BillingCurrency: "EUR" }],
    [{ ...rows([1])[0], ContractedCost: "1" }],
    [{ ...rows([1])[0], ChargePeriodEnd: "2026-10-20T00:00:00Z" }],
    [rows([1])[0], rows([1])[0]],
  ]) {
    assert.equal(
      evaluateBillableUsage(invalid, { accountId: "acct", now: base }).tripped,
      true,
    );
  }
});

function harness({ billing = rows([10]), failQueue = false } = {}) {
  const kv = new Map();
  const calls = [];
  let scriptPaused = false;
  const state = {
    async get(key) {
      return kv.has(key) ? structuredClone(kv.get(key)) : null;
    },
    async put(key, value) {
      kv.set(key, typeof value === "string" ? value : structuredClone(value));
    },
    async list({ prefix = "", startAfter = "", limit = 100 } = {}) {
      return new Map(
        [...kv.entries()]
          .filter(([key]) => key.startsWith(prefix) && key > startAfter)
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(0, limit)
          .map(([key, value]) => [key, structuredClone(value)]),
      );
    },
  };
  const fetcher = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({
      path: u.pathname,
      method: init.method ?? "GET",
      body: init.body,
    });
    if (u.pathname.endsWith("/billable-usage")) return cloudflare(billing);
    if (
      u.pathname.endsWith("/queues/q1") &&
      (!init.method || init.method === "GET")
    )
      return cloudflare({
        settings: { delivery_paused: false, message_retention_period: 86400 },
      });
    if (u.pathname.endsWith("/queues/q1") && init.method === "PATCH") {
      if (failQueue)
        return new Response("secret body should not leak", { status: 500 });
      return cloudflare({});
    }
    if (
      u.pathname.endsWith("/workers/scripts/secop/settings") &&
      (!init.method || init.method === "GET")
    )
      return cloudflare({
        bindings: [
          { type: "secret_text", name: "API_SECRET" },
          {
            type: "plain_text",
            name: "COST_GUARD_PAUSED",
            text: scriptPaused ? "true" : "false",
          },
        ],
      });
    if (
      u.pathname.endsWith("/workers/scripts/secop/settings") &&
      init.method === "PATCH"
    ) {
      scriptPaused = true;
      return cloudflare({});
    }
    if (
      u.pathname.endsWith("/workers/scripts/agency/schedules") &&
      (!init.method || init.method === "GET")
    )
      return cloudflare({ schedules: [{ cron: "*/5 * * * *" }] });
    if (
      u.pathname.endsWith("/workers/scripts/agency/schedules") &&
      init.method === "PUT"
    )
      return cloudflare({});
    return new Response("unexpected request", { status: 404 });
  };
  return {
    env: {
      CF_ACCOUNT_ID: "acct",
      CF_CONTROL_TOKEN: "cf-secret",
      GUARD_ADMIN_TOKEN: "admin-secret",
      STATE: state,
      POLICY: {
        guardScript: "cost-guard",
        backupBarrierScripts: ["backup"],
        scripts: [
          { script: "secop", variables: { COST_GUARD_PAUSED: "true" } },
        ],
        schedules: ["agency"],
        queues: ["q1"],
        workflows: [],
      },
    },
    fetcher,
    calls,
    kv,
  };
}

test("latches before pause actions, preserves secrets by inheritance, and never overwrites first recovery snapshot", async () => {
  const h = harness();
  const first = await executeCheck(h.env, { fetcher: h.fetcher, now: base });
  assert.equal(first.tripped, true);
  assert.ok(h.kv.has("recovery:queue:q1"));
  assert.ok(h.kv.has("recovery:script:secop"));
  assert.ok(h.kv.has("recovery:schedule:agency"));
  assert.equal(JSON.parse(h.kv.get("status")).tripped, true);
  const patch = h.calls.find(
    (c) =>
      c.path.endsWith("/workers/scripts/secop/settings") &&
      c.method === "PATCH",
  );
  assert.ok(patch);
  const form = patch.body;
  const settings = JSON.parse(form.get("settings"));
  assert.deepEqual(settings.bindings, [
    { type: "inherit", name: "API_SECRET" },
    { type: "plain_text", name: "COST_GUARD_PAUSED", text: "true" },
  ]);
  const patchesAfterTrip = h.calls.filter(
    (c) =>
      c.path.endsWith("/workers/scripts/secop/settings") &&
      c.method === "PATCH",
  ).length;
  await executeCheck(h.env, { fetcher: h.fetcher, now: base + 86400000 });
  assert.equal(
    h.calls.filter(
      (c) =>
        c.path.endsWith("/workers/scripts/secop/settings") &&
        c.method === "PATCH",
    ).length,
    patchesAfterTrip,
  );
  assert.equal(
    JSON.parse(h.kv.get("recovery:script:secop")).bindings[1].text,
    "false",
  );
});

test("billing read failure latches fail-closed; failed actions are retried without leaking response body", async () => {
  const h = harness({ failQueue: true });
  h.fetcher = async (url, init = {}) => {
    if (new URL(url).pathname.endsWith("/billable-usage"))
      throw new Error("token=secret");
    return harness().fetcher(url, init);
  };
  const result = await executeCheck(h.env, { fetcher: h.fetcher, now: base });
  assert.equal(result.reason, "billing_unavailable");
  assert.equal(result.tripped, true);
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test("status and manual check require bearer token", async () => {
  const h = harness();
  const worker = (await import("./worker.mjs")).default;
  for (const [path, method] of [
    ["/status", "GET"],
    ["/recovery", "GET"],
    ["/check", "POST"],
  ]) {
    const response = await worker.fetch(
      new Request(`https://guard${path}`, { method }),
      h.env,
      {},
    );
    assert.equal(response.status, 401);
  }
});

test("persistent stop latch remains tripped below threshold and failed target actions retry", async () => {
  const h = harness();
  let failOnce = true;
  const originalFetcher = h.fetcher;
  h.fetcher = async (url, init = {}) => {
    if (new URL(url).pathname.endsWith("/billable-usage")) {
      return cloudflare(failOnce ? rows([10]) : rows([1]));
    }
    if (
      new URL(url).pathname.endsWith("/queues/q1") &&
      init.method === "PATCH" &&
      failOnce
    ) {
      failOnce = false;
      return new Response("sensitive failure detail", { status: 500 });
    }
    return originalFetcher(url, init);
  };
  const first = await executeCheck(h.env, { fetcher: h.fetcher, now: base });
  assert.equal(first.tripped, true);
  assert.equal(first.actionErrors.length, 1);
  assert.doesNotMatch(JSON.stringify(first), /sensitive/);
  const snapshot = h.kv.get("recovery:queue:q1");
  const second = await executeCheck(h.env, {
    fetcher: h.fetcher,
    now: base + 60_000,
  });
  assert.equal(second.tripped, true);
  assert.equal(second.totalUsd, 6);
  assert.equal(second.actionErrors.length, 0);
  assert.equal(h.kv.get("recovery:queue:q1"), snapshot);
});

test("Cloudflare API requests are bounded by an AbortSignal timeout", async () => {
  let signal;
  const h = harness();
  const fetcher = async (_url, init) => {
    signal = init.signal;
    return cloudflare(rows([1]));
  };
  await executeCheck(h.env, { fetcher, now: base });
  assert.ok(signal instanceof AbortSignal);
  assert.ok(signal.aborted === false);
});

test("account-wide inventory removes native AI bindings on every discovered worker even below threshold", async () => {
  const h = harness({ billing: rows([1]) });
  h.env.POLICY = {
    guardScript: "cost-guard",
    backupBarrierScripts: ["backup"],
    accountWide: true,
    denyCloudflareAi: true,
  };
  const settings = new Map([
    [
      "api",
      [
        { type: "ai", name: "AI" },
        { type: "ai_search", name: "SEARCH" },
        { type: "secret_text", name: "TOKEN" },
      ],
    ],
    ["backup", [{ type: "ai", name: "AI_BACKUP" }]],
    ["cost-guard", [{ type: "ai", name: "AI_GUARD" }]],
  ]);
  const patched = [];
  h.fetcher = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/billable-usage")) return cloudflare(rows([1]));
    if (u.pathname.endsWith("/workers/scripts"))
      return Response.json({
        success: true,
        result: [{ id: "api" }, { id: "backup" }, { id: "cost-guard" }],
        result_info: { page: 1, per_page: 100, total_pages: 1 },
      });
    if (
      [
        "/queues",
        "/workflows",
        "/ai-search/namespaces",
        "/workers/domains",
      ].includes(u.pathname)
    )
      return Response.json({
        success: true,
        result: [],
        result_info: { total_pages: 1 },
      });
    if (u.pathname.endsWith("/zones"))
      return Response.json({
        success: true,
        result: [],
        result_info: { total_pages: 1 },
      });
    const match = u.pathname.match(/\/workers\/scripts\/([^/]+)\/settings$/);
    if (match) {
      const script = decodeURIComponent(match[1]);
      if (init.method === "PATCH") {
        const metadata = JSON.parse(init.body.get("settings"));
        patched.push(script);
        assert.deepEqual(
          metadata.bindings,
          script === "api" ? [{ type: "inherit", name: "TOKEN" }] : [],
        );
        return cloudflare({});
      }
      return cloudflare({ bindings: settings.get(script) ?? [] });
    }
    return new Response("unexpected request", { status: 404 });
  };
  const result = await executeCheck(h.env, { fetcher: h.fetcher, now: base });
  assert.equal(result.tripped, false);
  assert.deepEqual(patched.sort(), ["api", "backup"]);
  assert.ok(h.kv.has("recovery:ai-binding:api"));
  assert.ok(h.kv.has("recovery:ai-binding:backup"));
  assert.equal(h.kv.has("recovery:ai-binding:cost-guard"), false);
  assert.deepEqual(JSON.parse(h.kv.get("recovery:ai-binding:api")).bindings, [
    { type: "ai", name: "AI" },
    { type: "ai_search", name: "SEARCH" },
  ]);
});

test("account-wide Cloudflare AI denial pauses discovered AI Search below the billing threshold", async () => {
  const h = harness({ billing: rows([1]) });
  h.env.POLICY = {
    guardScript: "cost-guard",
    backupBarrierScripts: [],
    accountWide: true,
    denyCloudflareAi: true,
    aiSearch: [{ namespace: "docs", id: "kb" }],
  };
  let paused = false;
  let pauseCalls = 0;
  h.fetcher = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/billable-usage")) return cloudflare(rows([1]));
    if (
      [
        "/workers/scripts",
        "/queues",
        "/workflows",
        "/workers/domains",
        "/zones",
      ].some((path) => u.pathname.endsWith(path))
    )
      return Response.json({
        success: true,
        result: [],
        result_info: { total_pages: 1 },
      });
    if (u.pathname.endsWith("/ai-search/namespaces"))
      return Response.json({
        success: true,
        result: [{ name: "docs" }],
        result_info: { total_pages: 1 },
      });
    if (u.pathname.endsWith("/ai-search/namespaces/docs/instances"))
      return Response.json({
        success: true,
        result: [{ id: "kb" }],
        result_info: { total_pages: 1 },
      });
    if (u.pathname.endsWith("/ai-search/namespaces/docs/instances/kb")) {
      if (init.method === "PUT") {
        pauseCalls++;
        assert.deepEqual(JSON.parse(init.body), { paused: true });
        paused = true;
        return cloudflare({ paused: true });
      }
      return cloudflare({ paused, ai_search_model: "test/model" });
    }
    return new Response("unexpected request", { status: 404 });
  };

  const result = await executeCheck(h.env, { fetcher: h.fetcher, now: base });
  assert.equal(result.tripped, false);
  assert.deepEqual(result.actionErrors, []);
  assert.equal(paused, true);
  assert.equal(pauseCalls, 1);
  assert.ok(h.kv.has("recovery:ai-search:docs:kb"));
});

test("account-wide inventory API failures remain visible after the stop threshold trips", async () => {
  const h = harness({ billing: rows([1]) });
  h.env.POLICY = {
    guardScript: "cost-guard",
    backupBarrierScripts: [],
    accountWide: true,
    denyCloudflareAi: false,
  };
  h.fetcher = async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith("/billable-usage")) return cloudflare(rows([10]));
    if (pathname.endsWith("/workers/scripts"))
      return Response.json({ success: false, errors: [{ code: 1 }] });
    if (
      [
        "/queues",
        "/workflows",
        "/ai-search/namespaces",
        "/workers/domains",
      ].includes(pathname)
    )
      return Response.json({
        success: true,
        result: [],
        result_info: { total_pages: 1 },
      });
    if (pathname.endsWith("/zones"))
      return Response.json({
        success: true,
        result: [],
        result_info: { total_pages: 1 },
      });
    if (pathname.endsWith("/workers/domains"))
      return Response.json({
        success: true,
        result: [],
        result_info: { total_pages: 1 },
      });
    return new Response("unexpected request", { status: 404 });
  };
  const result = await executeCheck(h.env, { fetcher: h.fetcher, now: base });
  assert.equal(result.tripped, true);
  assert.ok(
    result.actionErrors.some((error) => error.action === "inventory-workers"),
  );
});

test("account-wide trip pauses discovered queues and schedules and disables worker previews", async () => {
  const h = harness();
  h.env.POLICY = {
    guardScript: "cost-guard",
    backupBarrierScripts: ["backup"],
    accountWide: true,
    denyCloudflareAi: false,
  };
  const calls = [];
  h.fetcher = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({
      path: u.pathname,
      method: init.method ?? "GET",
      body: init.body,
    });
    if (u.pathname.endsWith("/billable-usage")) return cloudflare(rows([10]));
    if (u.pathname.endsWith("/workers/scripts"))
      return Response.json({
        success: true,
        result: [{ id: "app" }, { id: "backup" }, { id: "cost-guard" }],
        result_info: { total_pages: 1 },
      });
    if (u.pathname.endsWith("/queues"))
      return Response.json({
        success: true,
        result: [{ queue_id: "q2-id", queue_name: "q2-name" }],
        result_info: { total_pages: 1 },
      });
    if (u.pathname.endsWith("/workflows"))
      return Response.json({
        success: true,
        result: [{ id: "workflow-uuid", name: "workflow-name" }],
        result_info: { total_pages: 1 },
      });
    if (u.pathname.endsWith("/ai-search/namespaces"))
      return Response.json({
        success: true,
        result: [],
        result_info: { total_pages: 1 },
      });
    if (u.pathname.endsWith("/workers/domains"))
      return Response.json({
        success: true,
        result: [],
        result_info: { total_pages: 1 },
      });
    if (u.pathname.endsWith("/zones"))
      return Response.json({
        success: true,
        result: [],
        result_info: { total_pages: 1 },
      });
    if (u.pathname.endsWith("/queues/q2-id"))
      return init.method === "PATCH"
        ? cloudflare({})
        : cloudflare({ settings: { delivery_paused: false } });
    if (u.pathname.endsWith("/workflows/workflow-name/instances"))
      return Response.json({
        success: true,
        result: [],
        result_info: { cursor: "" },
      });
    if (u.pathname.endsWith("/workers/scripts/app/subdomain"))
      return init.method === "POST"
        ? cloudflare({ enabled: false, previews_enabled: false })
        : cloudflare({ enabled: true, previews_enabled: true });
    if (u.pathname.endsWith("/workers/scripts/app/schedules"))
      return init.method === "PUT"
        ? cloudflare({})
        : cloudflare({ schedules: [{ cron: "0 * * * *" }] });
    return new Response("unexpected request", { status: 404 });
  };
  const result = await executeCheck(h.env, { fetcher: h.fetcher, now: base });
  assert.equal(result.actionErrors.length, 0);
  assert.ok(
    calls.some(
      (call) => call.path.endsWith("/queues/q2-id") && call.method === "PATCH",
    ),
  );
  assert.ok(
    calls.some((call) =>
      call.path.endsWith("/workflows/workflow-name/instances"),
    ),
  );
  assert.equal(
    calls.some((call) => call.path.includes("workflow-uuid")),
    false,
  );
  assert.ok(
    calls.some(
      (call) =>
        call.path.endsWith("/workers/scripts/app/schedules") &&
        call.method === "PUT",
    ),
  );
  assert.ok(
    calls.some(
      (call) =>
        call.path.endsWith("/workers/scripts/app/subdomain") &&
        call.method === "POST",
    ),
  );
  const subdomainUpdate = calls.find(
    (call) =>
      call.path.endsWith("/workers/scripts/app/subdomain") &&
      call.method === "POST",
  );
  assert.deepEqual(JSON.parse(subdomainUpdate.body), {
    enabled: false,
    previews_enabled: false,
  });
  assert.equal(
    calls.some((call) => call.path.includes("/workers/scripts/backup/")),
    false,
  );
});

test("reports worker-subdomain action failure if Cloudflare leaves workers.dev enabled", async () => {
  const h = harness();
  h.env.POLICY = {
    guardScript: "cost-guard",
    backupBarrierScripts: [],
    accountWide: true,
    denyCloudflareAi: false,
  };
  h.fetcher = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/billable-usage")) return cloudflare(rows([10]));
    if (u.pathname.endsWith("/workers/scripts"))
      return Response.json({
        success: true,
        result: [{ id: "app" }],
        result_info: { total_pages: 1 },
      });
    if (
      [
        "/queues",
        "/workflows",
        "/ai-search/namespaces",
        "/workers/domains",
      ].some((path) => u.pathname.endsWith(path))
    )
      return Response.json({
        success: true,
        result: [],
        result_info: { total_pages: 1 },
      });
    if (u.pathname.endsWith("/zones"))
      return Response.json({
        success: true,
        result: [],
        result_info: { total_pages: 1 },
      });
    if (u.pathname.endsWith("/workers/scripts/app/subdomain"))
      return init.method === "POST"
        ? cloudflare({ enabled: true, previews_enabled: false })
        : cloudflare({ enabled: true, previews_enabled: false });
    if (u.pathname.endsWith("/workers/scripts/app/schedules"))
      return cloudflare({ schedules: [] });
    return new Response("unexpected request", { status: 404 });
  };
  const result = await executeCheck(h.env, { fetcher: h.fetcher, now: base });
  assert.ok(
    result.actionErrors.some((error) => error.action === "worker-subdomain"),
  );
});

test("account-wide trip snapshots and detaches custom domains except protected Workers", async () => {
  const h = harness();
  h.env.POLICY = {
    guardScript: "cost-guard",
    backupBarrierScripts: ["backup"],
    accountWide: true,
    denyCloudflareAi: false,
  };
  const calls = [];
  h.fetcher = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({
      path: u.pathname,
      method: init.method ?? "GET",
      body: init.body,
    });
    if (u.pathname.endsWith("/billable-usage")) return cloudflare(rows([10]));
    if (u.pathname.endsWith("/workers/scripts"))
      return Response.json({
        success: true,
        result: [],
        result_info: { total_pages: 1 },
      });
    if (u.pathname.endsWith("/zones"))
      return Response.json({
        success: true,
        result: [],
        result_info: { total_pages: 1 },
      });
    if (
      ["/queues", "/workflows", "/ai-search/namespaces"].some((path) =>
        u.pathname.endsWith(path),
      )
    )
      return Response.json({
        success: true,
        result: [],
        result_info: { total_pages: 1 },
      });
    if (u.pathname.endsWith("/workers/domains"))
      return Response.json({
        success: true,
        result: [
          {
            id: "domain-app",
            hostname: "app.example.com",
            service: "app",
            zone_id: "zone",
            zone_name: "example.com",
            enabled: true,
            previews_enabled: false,
          },
          {
            id: "domain-backup",
            hostname: "backup.example.com",
            service: "backup",
            zone_id: "zone",
            zone_name: "example.com",
            enabled: true,
            previews_enabled: false,
          },
          {
            id: "domain-guard",
            hostname: "guard.example.com",
            service: "cost-guard",
            zone_id: "zone",
            zone_name: "example.com",
            enabled: true,
            previews_enabled: false,
          },
        ],
        result_info: { total_pages: 1 },
      });
    if (
      u.pathname.endsWith("/workers/domains/domain-app") &&
      init.method === "DELETE"
    )
      return Response.json({ success: true });
    return new Response("unexpected request", { status: 404 });
  };
  const result = await executeCheck(h.env, { fetcher: h.fetcher, now: base });
  assert.equal(result.actionErrors.length, 0);
  assert.ok(
    calls.some(
      (call) =>
        call.path.endsWith("/workers/domains/domain-app") &&
        call.method === "DELETE",
    ),
  );
  assert.equal(
    calls.some(
      (call) =>
        call.path.includes("domain-backup") ||
        call.path.includes("domain-guard"),
    ),
    false,
  );
  assert.deepEqual(JSON.parse(h.kv.get("recovery:domain:domain-app")), {
    hostname: "app.example.com",
    service: "app",
    enabled: true,
    previews_enabled: false,
    zone_id: "zone",
    zone_name: "example.com",
  });
});

test("account-wide trip snapshots and disables zone Worker routes while preserving protected routes", async () => {
  const h = harness();
  h.env.POLICY = {
    guardScript: "cost-guard",
    backupBarrierScripts: ["backup"],
    accountWide: true,
    denyCloudflareAi: false,
  };
  const calls = [];
  h.fetcher = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({
      url: u.href,
      path: u.pathname,
      method: init.method ?? "GET",
      body: init.body,
    });
    if (u.pathname.endsWith("/billable-usage")) return cloudflare(rows([10]));
    if (u.pathname.endsWith("/workers/scripts"))
      return Response.json({
        success: true,
        result: [],
        result_info: { total_pages: 1 },
      });
    if (
      [
        "/queues",
        "/workflows",
        "/ai-search/namespaces",
        "/workers/domains",
      ].some((path) => u.pathname.endsWith(path))
    )
      return Response.json({
        success: true,
        result: [],
        result_info: { total_pages: 1 },
      });
    if (u.pathname.endsWith("/zones"))
      return Response.json({
        success: true,
        result: [{ id: "zone-1", name: "example.com" }],
        result_info: { total_pages: 1 },
      });
    if (u.pathname.endsWith("/zones/zone-1/workers/routes"))
      return Response.json({
        success: true,
        result: [
          { id: "route-app", pattern: "app.example.com/*", script: "app" },
          {
            id: "route-backup",
            pattern: "backup.example.com/*",
            script: "backup",
          },
          {
            id: "route-guard",
            pattern: "guard.example.com/*",
            script: "cost-guard",
          },
        ],
        result_info: { total_pages: 1 },
      });
    if (
      u.pathname.endsWith("/zones/zone-1/workers/routes/route-app") &&
      init.method === "PUT"
    )
      return cloudflare({
        id: "route-app",
        pattern: "app.example.com/*",
        script: null,
      });
    return new Response("unexpected request", { status: 404 });
  };
  const result = await executeCheck(h.env, { fetcher: h.fetcher, now: base });
  assert.equal(result.actionErrors.length, 0);
  const update = calls.find(
    (call) => call.path.endsWith("/routes/route-app") && call.method === "PUT",
  );
  assert.ok(update);
  assert.deepEqual(JSON.parse(update.body), {
    pattern: "app.example.com/*",
    script: null,
  });
  assert.equal(
    calls.some(
      (call) =>
        call.path.includes("route-backup") || call.path.includes("route-guard"),
    ),
    false,
  );
  assert.deepEqual(JSON.parse(h.kv.get("recovery:route:zone-1:route-app")), {
    pattern: "app.example.com/*",
    script: "app",
  });
});

test("zone route inventory permission failure is surfaced after a trip", async () => {
  const h = harness();
  h.env.POLICY = {
    guardScript: "cost-guard",
    backupBarrierScripts: [],
    accountWide: true,
  };
  h.fetcher = async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/billable-usage")) return cloudflare(rows([10]));
    if (
      u.pathname.endsWith("/workers/scripts") ||
      [
        "/queues",
        "/workflows",
        "/ai-search/namespaces",
        "/workers/domains",
      ].some((path) => u.pathname.endsWith(path))
    )
      return Response.json({
        success: true,
        result: [],
        result_info: { total_pages: 1 },
      });
    if (u.pathname.endsWith("/zones"))
      return new Response("forbidden", { status: 403 });
    return new Response("unexpected request", { status: 404 });
  };
  const result = await executeCheck(h.env, { fetcher: h.fetcher, now: base });
  assert.equal(result.tripped, true);
  assert.ok(
    result.actionErrors.some((error) => error.action === "inventory-zones"),
  );
});

test("Durable Object serializes handlers and adapts durable storage as guard state", async () => {
  const { CostGuard } = await import("./worker.mjs");
  const data = new Map();
  let active = 0;
  let maxActive = 0;
  let entries = 0;
  let tail = Promise.resolve();
  const ctx = {
    storage: {
      async get(key) {
        return data.get(key) ?? null;
      },
      async put(key, value) {
        data.set(key, value);
      },
      async list({ prefix = "", startAfter = "", limit = 100 } = {}) {
        return new Map(
          [...data.entries()]
            .filter(([key]) => key.startsWith(prefix) && key > startAfter)
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(0, limit),
        );
      },
    },
    async blockConcurrencyWhile(callback) {
      let release;
      const previous = tail;
      tail = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      active++;
      maxActive = Math.max(maxActive, active);
      entries++;
      try {
        return await callback();
      } finally {
        active--;
        release();
      }
    },
  };
  const env = {
    CF_ACCOUNT_ID: "acct",
    CF_CONTROL_TOKEN: "cf-secret",
    GUARD_ADMIN_TOKEN: "admin-secret",
    POLICY: {
      guardScript: "cost-guard",
      backupBarrierScripts: [],
      scripts: [],
      schedules: [],
      queues: [],
      workflows: [],
    },
  };
  const object = new CostGuard(ctx, env);
  await object.state.put(
    "status",
    JSON.stringify({ tripped: false, reason: "within_limit" }),
  );
  const request = new Request("https://guard/status", {
    headers: { authorization: "Bearer admin-secret" },
  });
  const [a, b] = await Promise.all([
    object.fetch(request),
    object.fetch(request),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(entries, 2);
  assert.equal(maxActive, 1);
  assert.ok(data.has("status"));
});

test("workflow target pauses active instances using paginated cursor and preserves first active snapshot", async () => {
  const h = harness();
  h.env.POLICY.workflows = ["pipeline"];
  let paused = false;
  const workflowCalls = [];
  h.fetcher = async (url, init = {}) => {
    const u = new URL(url);
    workflowCalls.push({
      path: u.pathname,
      query: u.search,
      method: init.method ?? "GET",
      body: init.body,
    });
    if (u.pathname.endsWith("/billable-usage")) return cloudflare(rows([10]));
    if (
      u.pathname.endsWith("/workflows/pipeline/instances") &&
      (!init.method || init.method === "GET")
    ) {
      const status = u.searchParams.get("status");
      if (status === "queued") return cloudflare([]);
      return Response.json({
        success: true,
        result: paused
          ? [{ id: "i-1", status: "paused" }]
          : [{ id: "i-1", status: "running" }],
        result_info: { cursor: paused ? undefined : "cursor-2" },
      });
    }
    if (
      u.pathname.endsWith("/workflows/pipeline/instances/i-1/status") &&
      init.method === "PATCH"
    ) {
      assert.deepEqual(JSON.parse(init.body), { status: "pause" });
      paused = true;
      return cloudflare({ status: "waitingForPause" });
    }
    return new Response("unexpected request", { status: 404 });
  };
  await executeCheck(h.env, { fetcher: h.fetcher, now: base });
  assert.ok(h.kv.has("recovery:workflow:pipeline:i-1"));
  assert.ok(
    workflowCalls.some(
      (call) => call.path.endsWith("/status") && call.method === "PATCH",
    ),
  );
  assert.equal(
    JSON.parse(h.kv.get("progress:workflow:pipeline")).running,
    "cursor-2",
  );
});

test("AI Search pause preserves public endpoint parameters, snapshots first, and skips repeated update", async () => {
  const h = harness();
  h.env.POLICY.aiSearch = [{ namespace: "ns", id: "kb" }];
  let paused = false;
  let savedParams;
  h.fetcher = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/billable-usage")) return cloudflare(rows([10]));
    if (
      u.pathname.endsWith("/ai-search/namespaces/ns/instances/kb") &&
      (!init.method || init.method === "GET")
    ) {
      return cloudflare({
        paused,
        public_endpoint_params: {
          default_domain_enabled: false,
          custom_domains: ["docs.example.test"],
        },
        ai_search_model: "test/model",
      });
    }
    if (
      u.pathname.endsWith("/ai-search/namespaces/ns/instances/kb") &&
      init.method === "PUT"
    ) {
      const body = JSON.parse(init.body);
      assert.equal(body.paused, true);
      savedParams = body.public_endpoint_params;
      paused = true;
      return cloudflare({ paused: true });
    }
    return new Response("unexpected request", { status: 404 });
  };
  await executeCheck(h.env, { fetcher: h.fetcher, now: base });
  assert.deepEqual(savedParams, {
    default_domain_enabled: false,
    custom_domains: ["docs.example.test"],
  });
  assert.ok(h.kv.has("recovery:ai-search:ns:kb"));
  await executeCheck(h.env, { fetcher: h.fetcher, now: base + 60_000 });
  assert.equal(paused, true);
});

test("scheduled trigger forwards authenticated /check through the configured controller binding", async () => {
  const worker = (await import("./worker.mjs")).default;
  let forwarded;
  const binding = {
    idFromName: (name) => name,
    get: (id) => ({
      fetch: async (request) => {
        forwarded = { id, request };
        return Response.json({ tripped: false, actionErrors: [] });
      },
    }),
  };
  let waited;
  const env = { CONTROLLER: binding, GUARD_ADMIN_TOKEN: "do-not-log-this" };
  const logged = [];
  const originals = Object.fromEntries(
    ["log", "info", "warn", "error"].map((name) => [name, console[name]]),
  );
  try {
    for (const name of Object.keys(originals))
      console[name] = (...args) => logged.push(args);
    await worker.scheduled({}, env, {
      waitUntil(promise) {
        waited = promise;
      },
    });
    await waited;
  } finally {
    for (const [name, original] of Object.entries(originals))
      console[name] = original;
  }
  assert.equal(forwarded.id, "account-budget");
  assert.equal(new URL(forwarded.request.url).pathname, "/check");
  assert.equal(forwarded.request.method, "POST");
  assert.equal(
    forwarded.request.headers.get("authorization"),
    "Bearer do-not-log-this",
  );
  assert.deepEqual(logged, []);
});

test("billing API responses without a successful result fail closed", async () => {
  const h = harness();
  for (const envelope of [
    { success: false, errors: [{ message: "private" }] },
    { success: true, errors: [], result_info: {} },
  ]) {
    const result = await executeCheck(h.env, {
      fetcher: async () => Response.json(envelope),
      now: base,
    });
    assert.equal(result.tripped, true);
    assert.equal(result.reason, "billing_unavailable");
    assert.doesNotMatch(JSON.stringify(result), /private/);
  }
});

test("authenticated recovery endpoint exposes original pre-pause snapshots only", async () => {
  const h = harness();
  await executeCheck(h.env, { fetcher: h.fetcher, now: base });
  const worker = (await import("./worker.mjs")).default;
  const response = await worker.fetch(
    new Request("https://guard/recovery", {
      headers: { authorization: "Bearer admin-secret" },
    }),
    h.env,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  const queue = body.records.find(
    (record) => record.key === "recovery:queue:q1",
  );
  assert.equal(queue.value.settings.delivery_paused, false);
  const script = body.records.find(
    (record) => record.key === "recovery:script:secop",
  );
  assert.deepEqual(script.value.bindings[0], {
    type: "secret_text",
    name: "API_SECRET",
  });
  assert.equal(Object.hasOwn(script.value.bindings[0], "text"), false);
  assert.equal(
    body.records.some((record) => record.key === "status"),
    false,
  );
});

test("recovery endpoint returns at most 100 prefixed snapshots with startAfter cursor", async () => {
  const h = harness();
  for (let index = 0; index < 101; index++)
    await h.env.STATE.put(
      `recovery:item:${String(index).padStart(3, "0")}`,
      JSON.stringify({ index }),
    );
  await h.env.STATE.put("status", JSON.stringify({ tripped: true }));
  const worker = (await import("./worker.mjs")).default;
  const request = (url) =>
    worker.fetch(
      new Request(`https://guard${url}`, {
        headers: { authorization: "Bearer admin-secret" },
      }),
      h.env,
    );
  const first = await (await request("/recovery")).json();
  assert.equal(first.records.length, 100);
  assert.equal(
    first.records.every((record) => record.key.startsWith("recovery:")),
    true,
  );
  assert.equal(first.nextCursor, first.records[99].key);
  const second = await (
    await request(`/recovery?cursor=${encodeURIComponent(first.nextCursor)}`)
  ).json();
  assert.equal(second.records.length, 1);
  assert.equal(second.records[0].key, "recovery:item:100");
  assert.equal(second.nextCursor, null);
  assert.equal((await request("/recovery?cursor=status")).status, 400);
});

test("scheduled check rejects failed controller responses and incomplete pauses without leaking details", async () => {
  const worker = (await import("./worker.mjs")).default;
  for (const response of [
    new Response("token=private-detail", { status: 503 }),
    Response.json({
      tripped: true,
      actionErrors: [{ target: "q", message: "secret=private-detail" }],
    }),
  ]) {
    const env = {
      GUARD_ADMIN_TOKEN: "admin-secret",
      CONTROLLER: {
        idFromName: () => "budget",
        get: () => ({ fetch: async () => response }),
      },
    };
    let pending;
    await worker.scheduled({}, env, {
      waitUntil(promise) {
        pending = promise;
      },
    });
    await assert.rejects(pending, (error) => {
      assert.doesNotMatch(error.message, /private-detail|admin-secret/);
      return true;
    });
  }
});

test("direct scheduled fallback rejects a returned status with action errors", async () => {
  const worker = (await import("./worker.mjs")).default;
  const h = harness();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/billable-usage")) return cloudflare(rows([10]));
    if (path.endsWith("/queues/q1") && (!init.method || init.method === "GET"))
      return cloudflare({ settings: { delivery_paused: false } });
    if (path.endsWith("/queues/q1") && init.method === "PATCH")
      return new Response("private response body", { status: 500 });
    return new Response("unexpected request", { status: 404 });
  };
  let pending;
  try {
    await worker.scheduled({}, h.env, {
      waitUntil(promise) {
        pending = promise;
      },
    });
    await assert.rejects(pending, (error) => {
      assert.doesNotMatch(error.message, /private response/);
      return /pause actions incomplete/.test(error.message);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reports paginated workflow backlog until the cursor reaches the end", async () => {
  const h = harness();
  h.env.POLICY.scripts = [];
  h.env.POLICY.schedules = [];
  h.env.POLICY.queues = [];
  h.env.POLICY.workflows = ["pipeline"];
  let secondPage = false;
  h.fetcher = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/billable-usage")) return cloudflare(rows([10]));
    if (
      u.pathname.endsWith("/workflows/pipeline/instances") &&
      init.method === "GET"
    ) {
      if (
        u.searchParams.get("status") === "queued" &&
        !u.searchParams.has("cursor")
      ) {
        return Response.json({
          success: true,
          result: Array.from({ length: 20 }, (_, i) => ({
            id: `q-${i}`,
            status: "queued",
          })),
          result_info: { cursor: "queued-next" },
        });
      }
      if (
        u.searchParams.get("status") === "queued" &&
        u.searchParams.get("cursor") === "queued-next"
      )
        secondPage = true;
      return Response.json({ success: true, result: [], result_info: {} });
    }
    if (
      u.pathname.includes("/workflows/pipeline/instances/") &&
      u.pathname.endsWith("/status") &&
      init.method === "PATCH"
    )
      return cloudflare({ status: "paused" });
    return new Response("unexpected request", { status: 404 });
  };
  const first = await executeCheck(h.env, { fetcher: h.fetcher, now: base });
  assert.equal(
    first.actionErrors.some((error) => error.action === "workflow-pending"),
    true,
  );
  assert.equal(first.tripped, true);
  const second = await executeCheck(h.env, {
    fetcher: h.fetcher,
    now: base + 60_000,
  });
  assert.equal(secondPage, true);
  assert.equal(
    second.actionErrors.some((error) => error.action === "workflow-pending"),
    false,
  );
});

test("tripped guard keeps maintenance cron while disabling its public URLs", async () => {
  const h = harness();
  h.env.POLICY = {
    guardScript: "cost-guard",
    accountWide: true,
    maintenanceSchedules: ["cleanup"],
  };
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: init.method ?? "GET" });
    if (path.endsWith("/billable-usage")) return cloudflare(rows([10]));
    if (path.endsWith("/workers/scripts"))
      return cloudflare([{ id: "cleanup" }]);
    if (
      [
        "/queues",
        "/workflows",
        "/ai-search/namespaces",
        "/workers/domains",
        "/zones",
      ].some((s) => path.endsWith(s))
    )
      return cloudflare([]);
    if (path.endsWith("/cleanup/subdomain"))
      return cloudflare({
        enabled: init.method !== "POST",
        previews_enabled: init.method !== "POST",
      });
    if (path.endsWith("/cleanup/schedules"))
      return cloudflare({ schedules: [{ cron: "15 3 * * *" }] });
    return new Response("unexpected", { status: 404 });
  };
  const result = await executeCheck(h.env, { fetcher, now: base });
  assert.equal(result.tripped, true);
  assert.deepEqual(result.actionErrors, []);
  assert.equal(
    calls.some((c) => c.path.endsWith("/cleanup/schedules")),
    false,
  );
  assert.equal(
    calls.some(
      (c) => c.path.endsWith("/cleanup/subdomain") && c.method === "POST",
    ),
    true,
  );
});

test("manual stop latches before external calls and pauses below budget without billing", async () => {
  const h = harness({ billing: rows([1]) });
  const fetcher = async (url, init) => {
    assert.notEqual(new URL(url).pathname.split("/").at(-1), "billable-usage");
    const status = JSON.parse(h.kv.get("status"));
    assert.equal(status.tripped, true);
    assert.equal(status.reason, "manual_stop");
    return h.fetcher(url, init);
  };
  const result = await executeCheck(h.env, {
    fetcher,
    now: base,
    manualStop: true,
  });
  assert.equal(result.tripped, true);
  assert.equal(result.reason, "manual_stop");
  assert.equal(result.manualStopAt, new Date(base).toISOString());
  assert.ok(
    result.targetResults.some(
      (item) => item.action === "queue" && item.target === "q1" && item.ok,
    ),
  );
  assert.equal(result.actionErrors.length, 0);
  const originalSnapshot = h.kv.get("recovery:queue:q1");
  const later = await executeCheck(h.env, {
    fetcher: h.fetcher,
    now: base + 1000,
  });
  assert.equal(later.reason, "manual_stop");
  assert.equal(later.tripped, true);
  assert.equal(later.manualStopAt, result.manualStopAt);
  assert.deepEqual(h.kv.get("recovery:queue:q1"), originalSnapshot);
});

test("a later manual stop revokes both approvals and records its own timestamp", async () => {
  const h = harness({ billing: rows([1]) });
  await h.env.STATE.put(
    "status",
    JSON.stringify({
      tripped: true,
      reason: "manual_stop",
      phase: "paused",
      manualStopAt: new Date(base).toISOString(),
      previewApproval: { approvedAt: new Date(base + 1_000).toISOString() },
    }),
  );
  const stopped = await executeCheck(h.env, {
    fetcher: h.fetcher,
    now: base + 2_000,
    manualStop: true,
  });
  assert.equal(stopped.manualStopAt, new Date(base + 2_000).toISOString());
  assert.equal(stopped.previewApproved, false);
  assert.equal(stopped.previewApproval.revokedAt, stopped.manualStopAt);
});

test("preview approval exempts only exact Savia preview targets and never exempts AI denial", async () => {
  const h = harness();
  const previewQueue = "ce9d059f73aa45a8a29cf869a5ed5f17";
  const previewDlq = "1e9d40c222c64135bb05f67722e3324e";
  const secopQueue = "b4e2c7ca82114599887fdd359aa4dead";
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const u = new URL(url);
    const path = u.pathname;
    calls.push({ path, method: init.method ?? "GET" });
    if (path.endsWith("/settings") && (!init.method || init.method === "GET"))
      return cloudflare({ bindings: [{ type: "ai", name: "AI" }] });
    if (
      path.endsWith("/queues/" + previewQueue) ||
      path.endsWith("/queues/" + previewDlq)
    )
      return cloudflare({ settings: { delivery_paused: false } });
    if (path.endsWith("/queues/" + secopQueue))
      return cloudflare({ settings: { delivery_paused: false } });
    if (path.endsWith("/workers/scripts/secop-live-worker/subdomain"))
      return cloudflare(
        init.method === "POST"
          ? { enabled: false, previews_enabled: false }
          : { enabled: true, previews_enabled: true },
      );
    if (path.endsWith("/workers/scripts/secop-live-worker/schedules"))
      return cloudflare({ schedules: [{ cron: "* * * * *" }] });
    if (path.includes("/workflows/") && path.endsWith("/instances"))
      return cloudflare([]);
    if (path.endsWith("/workers/domains/secop-domain")) return cloudflare({});
    if (path.endsWith("/workers/routes/secop-route")) return cloudflare({});
    return cloudflare({});
  };
  const policy = {
    guardScript: "savia-cost-guard",
    backupBarrierScripts: ["savia-backup-coordinator-preview"],
    maintenanceSchedules: [],
    denyCloudflareAi: true,
    scripts: [
      {
        script: "savia-agencies-preview",
        variables: { SAVIA_MAINTENANCE: "true" },
      },
      {
        script: "secop-live-worker",
        variables: { MODEL_SPEND_PAUSED: "true" },
      },
    ],
    queues: [previewQueue, previewDlq, secopQueue],
    schedules: [
      "savia-agencies-preview",
      "savia-flows-preview",
      "secop-live-worker",
    ],
    workflows: ["savia-flows-execute-preview", "secop-dossier-processing"],
    aiSearch: [],
  };
  const discovered = {
    scripts: ["savia-auth-preview", "secop-live-worker"],
    queues: [],
    schedules: [],
    workflows: [],
    aiSearch: [],
    domains: [
      {
        id: "preview-domain",
        hostname: "savia-preview.hefesoft.com",
        service: "savia-preview",
      },
      {
        id: "secop-domain",
        hostname: "secop.example.test",
        service: "secop-live-worker",
      },
      {
        id: "lookalike-domain",
        hostname: "savia-preview.hefesoft.com",
        service: "secop-live-worker",
      },
    ],
    routes: [
      {
        id: "preview-route",
        zoneId: "zone",
        pattern: "*.savia-preview.hefesoft.com/*",
        script: "savia-preview",
      },
      {
        id: "secop-route",
        zoneId: "zone",
        pattern: "secop.example.test/*",
        script: "secop-live-worker",
      },
      {
        id: "lookalike-route",
        zoneId: "zone",
        pattern: "*.savia-preview.hefesoft.com/*",
        script: "secop-live-worker",
      },
    ],
  };
  const result = await pauseTargets(h.env, policy, fetcher, discovered, true);
  assert.deepEqual(result.errors, []);
  const targets = result.results.map(
    ({ action, target }) => `${action}:${target}`,
  );
  for (const target of [
    `queue:${previewQueue}`,
    `queue:${previewDlq}`,
    "worker-settings:savia-agencies-preview",
    "worker-access:savia-auth-preview",
    "schedule:savia-agencies-preview",
    "schedule:savia-flows-preview",
    "workflow:savia-flows-execute-preview",
  ])
    assert.equal(targets.includes(target), false, target);
  for (const target of [
    `queue:${secopQueue}`,
    "worker-settings:secop-live-worker",
    "worker-access:secop-live-worker",
    "schedule:secop-live-worker",
    "workflow:secop-dossier-processing",
    "domain:secop.example.test",
    "route:secop.example.test/*",
  ])
    assert.equal(targets.includes(target), true, target);
  assert.ok(targets.includes("ai-binding:savia-auth-preview"));
  assert.ok(targets.includes("ai-binding:savia-agencies-preview"));
  assert.ok(
    calls.some((call) =>
      call.path.endsWith("/workers/scripts/savia-auth-preview/settings"),
    ),
  );
  assert.equal(
    calls.some((call) => call.path.endsWith("/workers/domains/preview-domain")),
    false,
  );
  assert.ok(
    calls.some((call) =>
      call.path.endsWith("/workers/domains/lookalike-domain"),
    ),
  );
  assert.equal(
    calls.some((call) => call.path.endsWith("/workers/routes/preview-route")),
    false,
  );
  assert.ok(
    calls.some((call) => call.path.endsWith("/workers/routes/lookalike-route")),
  );
});

test("production approval exempts only exact Savia production targets and keeps preview and AI policy independent", async () => {
  const h = harness();
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, method: init.method ?? "GET" });
    if (
      u.pathname.endsWith("/settings") &&
      (!init.method || init.method === "GET")
    )
      return cloudflare({ bindings: [{ type: "ai", name: "AI" }] });
    if (u.pathname.includes("/queues/"))
      return cloudflare({
        settings: { delivery_paused: false, message_retention_period: 86400 },
      });
    if (u.pathname.endsWith("/subdomain"))
      return cloudflare(
        init.method === "POST"
          ? { enabled: false, previews_enabled: false }
          : { enabled: true, previews_enabled: true },
      );
    if (u.pathname.endsWith("/schedules"))
      return cloudflare(
        init.method === "PUT"
          ? { schedules: [] }
          : { schedules: [{ cron: "* * * * *" }] },
      );
    if (u.pathname.includes("/workflows/") && u.pathname.endsWith("/instances"))
      return cloudflare([]);
    if (u.pathname.includes("/ai-search/"))
      return cloudflare(
        init.method === "PUT" ? { paused: true } : { paused: false },
      );
    return cloudflare({});
  };
  const policy = {
    guardScript: "savia-cost-guard",
    backupBarrierScripts: ["savia-backup-coordinator"],
    maintenanceSchedules: [],
    denyCloudflareAi: true,
    scripts: [
      { script: "savia-agencies", variables: { SAVIA_MAINTENANCE: "true" } },
      {
        script: "savia-agencies-preview",
        variables: { SAVIA_MAINTENANCE: "true" },
      },
      { script: "other-app", variables: { SAVIA_MAINTENANCE: "true" } },
    ],
    queues: ["production-queue-id", "preview-queue-id", "other-queue-id"],
    schedules: ["savia-agencies", "savia-agencies-preview", "other-app"],
    workflows: ["production-workflow", "preview-workflow", "other-workflow"],
    aiSearch: [{ namespace: "default", id: "savia-search" }],
  };
  const discovered = {
    scripts: [
      "savia",
      "savia-auth",
      "savia-request",
      "savia-hook-executor",
      "savia-connectors",
      "savia-mcp",
      "savia-preview",
      "savia-auth-preview",
      "other-app",
    ],
    queues: [],
    schedules: [],
    workflows: [],
    aiSearch: [],
    domains: [
      { id: "domain-prod", hostname: "savia.hefesoft.com", service: "savia" },
      {
        id: "domain-tenant",
        hostname: "savia-team.savia.hefesoft.com",
        service: "savia",
      },
      {
        id: "domain-lookalike",
        hostname: "savia.hefesoft.com",
        service: "savia-agencies",
      },
      {
        id: "domain-preview",
        hostname: "savia-preview.hefesoft.com",
        service: "savia-preview",
      },
    ],
    routes: [
      {
        id: "route-prod",
        zoneId: "zone",
        pattern: "savia.hefesoft.com/*",
        script: "savia",
      },
      {
        id: "route-tenant",
        zoneId: "zone",
        pattern: "*.savia.hefesoft.com/*",
        script: "savia",
      },
      {
        id: "route-lookalike",
        zoneId: "zone",
        pattern: "savia.hefesoft.com/*",
        script: "savia-agencies",
      },
      {
        id: "route-preview",
        zoneId: "zone",
        pattern: "*.savia-preview.hefesoft.com/*",
        script: "savia-preview",
      },
    ],
  };

  const result = await pauseTargets(
    h.env,
    policy,
    fetcher,
    discovered,
    false,
    true,
  );
  assert.deepEqual(result.errors, []);
  const targets = result.results.map(
    ({ action, target }) => `${action}:${target}`,
  );
  for (const target of [
    "worker-access:savia",
    "worker-access:savia-auth",
    "worker-access:savia-request",
    "worker-access:savia-hook-executor",
    "worker-access:savia-connectors",
    "worker-access:savia-mcp",
    "worker-settings:savia-agencies",
    "schedule:savia-agencies",
  ])
    assert.equal(targets.includes(target), false, target);
  for (const target of [
    "worker-settings:savia-agencies-preview",
    "worker-access:savia-preview",
    "worker-access:savia-auth-preview",
    "schedule:savia-agencies-preview",
    "queue:preview-queue-id",
    "workflow:preview-workflow",
    "domain:savia-preview.hefesoft.com",
    "route:*.savia-preview.hefesoft.com/*",
    "worker-settings:other-app",
    "worker-access:other-app",
    "schedule:other-app",
    "queue:other-queue-id",
    "workflow:other-workflow",
  ])
    assert.equal(targets.includes(target), true, target);
  assert.equal(targets.includes("queue:production-queue-id"), true);
  assert.equal(targets.includes("workflow:production-workflow"), true);
  assert.ok(targets.includes("ai-binding:savia"));
  assert.ok(targets.includes("ai-binding:savia-agencies"));
  assert.ok(targets.includes("ai-binding:savia-preview"));
  assert.ok(targets.includes("ai-search:default:savia-search"));
  assert.equal(
    calls.some((call) => call.path.endsWith("/workers/domains/domain-prod")),
    false,
  );
  assert.equal(
    calls.some((call) => call.path.endsWith("/workers/domains/domain-tenant")),
    false,
  );
  assert.ok(
    calls.some((call) =>
      call.path.endsWith("/workers/domains/domain-lookalike"),
    ),
  );
  assert.equal(
    calls.some((call) => call.path.endsWith("/workers/routes/route-prod")),
    false,
  );
  assert.equal(
    calls.some((call) => call.path.endsWith("/workers/routes/route-tenant")),
    false,
  );
  assert.ok(
    calls.some((call) => call.path.endsWith("/workers/routes/route-lookalike")),
  );
});

test("manual stop revokes production approval as well as preview approval", async () => {
  const h = harness();
  await h.env.STATE.put(
    "status",
    JSON.stringify({
      tripped: true,
      reason: "manual_stop",
      phase: "paused",
      manualStopAt: new Date(base).toISOString(),
      previewApproval: { approvedAt: new Date(base + 1_000).toISOString() },
      productionApproval: { approvedAt: new Date(base + 1_000).toISOString() },
    }),
  );
  const stopped = await executeCheck(h.env, {
    fetcher: h.fetcher,
    now: base + 2_000,
    manualStop: true,
  });
  assert.equal(stopped.previewApproved, false);
  assert.equal(stopped.productionApproved, false);
  assert.equal(stopped.previewApproval.revokedAt, stopped.manualStopAt);
  assert.equal(stopped.productionApproval.revokedAt, stopped.manualStopAt);
});

test("production approval endpoint requires auth, exact confirmation and a completed pause", async (t) => {
  const { default: worker } = await import("./worker.mjs");
  const h = harness();
  t.mock.method(globalThis, "fetch", h.fetcher);
  const request = (
    headers = {},
    body = { confirm: "RESUME_SAVIA_PRODUCTION_ONLY" },
  ) =>
    worker.fetch(
      new Request("https://guard/resume-production", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
      h.env,
    );
  assert.equal((await request()).status, 401);
  assert.equal(
    (
      await request(
        { authorization: "Bearer admin-secret" },
        { confirm: "wrong" },
      )
    ).status,
    400,
  );
  assert.equal(
    (await request({ authorization: "Bearer admin-secret" })).status,
    409,
  );
  for (const [reason, manualStopAt] of [
    ["threshold", new Date(base).toISOString()],
    ["billing_unavailable", new Date(base).toISOString()],
    ["manual_stop", undefined],
    ["manual_stop", "not-a-timestamp"],
  ]) {
    await h.env.STATE.put(
      "status",
      JSON.stringify({
        tripped: true,
        reason,
        phase: "paused",
        actionErrors: [],
        ...(manualStopAt === undefined ? {} : { manualStopAt }),
      }),
    );
    assert.equal(
      (await request({ authorization: "Bearer admin-secret" })).status,
      409,
      `${reason} with manualStopAt=${String(manualStopAt)} must be rejected`,
    );
    assert.equal(
      (await h.env.STATE.get("status")).productionApproval,
      undefined,
    );
  }
  await h.env.STATE.put(
    "status",
    JSON.stringify({
      tripped: true,
      reason: "manual_stop",
      phase: "paused",
      actionErrors: [],
      manualStopAt: new Date(base).toISOString(),
    }),
  );
  assert.equal(
    (
      await request({
        authorization: "Bearer admin-secret",
        origin: "https://other.example",
      })
    ).status,
    403,
  );
  const response = await request({
    authorization: "Bearer admin-secret",
    origin: "https://guard",
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.productionApproved, true);
  assert.equal(result.previewApproved, false);
  assert.ok(result.productionApproval.approvedAt);
  const checked = await executeCheck(h.env, {
    fetcher: h.fetcher,
    now: Date.parse(result.productionApproval.approvedAt) + 1_000,
  });
  assert.equal(checked.productionApproved, true);
  assert.equal(
    checked.productionApproval.approvedAt,
    result.productionApproval.approvedAt,
  );
});

test("preview approval endpoint requires auth, exact confirmation and a completed pause", async (t) => {
  const { default: worker } = await import("./worker.mjs");
  const h = harness();
  t.mock.method(globalThis, "fetch", h.fetcher);
  const request = (
    headers = {},
    body = { confirm: "RESUME_SAVIA_PREVIEW_ONLY" },
  ) =>
    worker.fetch(
      new Request("https://guard/resume-preview", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
      h.env,
    );
  assert.equal((await request()).status, 401);
  assert.equal(
    (
      await request(
        { authorization: "Bearer admin-secret" },
        { confirm: "wrong" },
      )
    ).status,
    400,
  );
  assert.equal(
    (await request({ authorization: "Bearer admin-secret" })).status,
    409,
  );
  for (const actionErrors of [undefined, null, {}, "", ["incomplete"]]) {
    const incomplete = {
      tripped: true,
      reason: "manual_stop",
      phase: "paused",
      manualStopAt: new Date(base).toISOString(),
      ...(actionErrors === undefined ? {} : { actionErrors }),
    };
    await h.env.STATE.put("status", JSON.stringify(incomplete));
    assert.equal(
      (await request({ authorization: "Bearer admin-secret" })).status,
      409,
      `actionErrors=${String(actionErrors)} must fail closed`,
    );
    assert.equal((await h.env.STATE.get("status")).previewApproval, undefined);
  }
  await h.env.STATE.put(
    "status",
    JSON.stringify({
      tripped: true,
      reason: "manual_stop",
      phase: "paused",
      actionErrors: [],
      manualStopAt: new Date(base).toISOString(),
    }),
  );
  const denied = await request({
    authorization: "Bearer admin-secret",
    origin: "https://other.example",
  });
  assert.equal(denied.status, 403);
  assert.equal((await h.env.STATE.get("status")).previewApproval, undefined);
  const approved = await request({
    authorization: "Bearer admin-secret",
    origin: "https://guard",
  });
  assert.equal(approved.status, 200);
  const result = await approved.json();
  assert.equal(result.tripped, true);
  assert.equal(result.previewApproved, true);
  assert.ok(result.previewApproval.approvedAt);
  assert.equal(result.manualStopAt, new Date(base).toISOString());
});

test("manual stop reports partial failures without clearing the stop latch", async () => {
  const h = harness({ billing: rows([1]), failQueue: true });
  const result = await executeCheck(h.env, {
    fetcher: h.fetcher,
    now: base,
    manualStop: true,
  });
  assert.equal(result.tripped, true);
  assert.equal(result.phase, "incomplete");
  assert.ok(
    result.targetResults.some(
      (item) => item.action === "queue" && item.target === "q1" && !item.ok,
    ),
  );
  assert.ok(result.actionErrors.some((item) => item.target === "q1"));
  assert.equal(JSON.parse(h.kv.get("status")).tripped, true);
});

test("manual stop requires authentication, explicit confirmation and same-origin browser requests", async () => {
  const { default: worker } = await import("./worker.mjs");
  const h = harness();
  for (const [headers, body, expected] of [
    [{}, { confirm: "PAUSE_ALL_ENVIRONMENTS" }, 401],
    [
      {
        authorization: "Bearer admin-secret",
        "content-type": "application/json",
      },
      { confirm: "wrong" },
      400,
    ],
    [
      {
        authorization: "Bearer admin-secret",
        "content-type": "application/json",
        origin: "https://other.example",
      },
      { confirm: "PAUSE_ALL_ENVIRONMENTS" },
      403,
    ],
  ]) {
    const response = await worker.fetch(
      new Request("https://guard/stop", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
      h.env,
    );
    assert.equal(response.status, expected);
    assert.equal(h.kv.has("status"), false);
  }
});

test("manual stop remains saved when account inventory fails", async () => {
  const h = harness({ billing: rows([1]) });
  h.env.POLICY.accountWide = true;
  const result = await executeCheck(h.env, {
    fetcher: h.fetcher,
    now: base,
    manualStop: true,
  });
  assert.equal(result.tripped, true);
  assert.equal(result.reason, "manual_stop");
  assert.equal(result.phase, "incomplete");
  assert.ok(
    result.actionErrors.some((item) => item.action.startsWith("inventory-")),
  );
  assert.equal(JSON.parse(h.kv.get("status")).tripped, true);
});

test("authenticated stop endpoint applies the latch and protected panel responses cannot be cached", async (t) => {
  const { default: worker } = await import("./worker.mjs");
  const h = harness({ billing: rows([1]) });
  t.mock.method(globalThis, "fetch", h.fetcher);
  const response = await worker.fetch(
    new Request("https://guard/stop", {
      method: "POST",
      headers: {
        authorization: "Bearer admin-secret",
        "content-type": "application/json",
        origin: "https://guard",
      },
      body: JSON.stringify({ confirm: "PAUSE_ALL_ENVIRONMENTS" }),
    }),
    h.env,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).reason, "manual_stop");
  for (const path of ["/control"]) {
    const panel = await worker.fetch(
      new Request(`https://guard${path}`),
      { ...h.env, ACCESS_ADMIN_EMAILS: "owner@example.com" },
      { access: { getIdentity: async () => ({ email: "owner@example.com" }) } },
    );
    assert.equal(panel.status, 200);
    assert.match(panel.headers.get("content-type"), /^text\/html/);
    assert.equal(panel.headers.get("cache-control"), "no-store");
    assert.equal(panel.headers.get("x-frame-options"), "DENY");
    const html = await panel.text();
    const nonce = html.match(/<script nonce="([^"]+)"/)[1];
    assert.ok(
      panel.headers.get("content-security-policy").includes(`'nonce-${nonce}'`),
    );
    assert.ok(!html.includes("admin-secret"));
    assert.ok(!html.includes("cf-secret"));
  }
});

test("panel denies missing, forged and unauthorized Access identities before reaching controller", async () => {
  const { default: worker } = await import("./worker.mjs");
  let forwarded = 0;
  const env = {
    ACCESS_ADMIN_EMAILS: "owner@example.com",
    CONTROLLER: {
      idFromName: () => "id",
      get: () => ({
        fetch: () => {
          forwarded++;
          throw new Error("must not forward");
        },
      }),
    },
  };
  for (const path of [
    "/control",
    "/control/",
    "/control/status",
    "/control/stop",
    "/control/resume-preview",
    "/control/resume-production",
  ]) {
    for (const ctx of [
      undefined,
      {},
      { access: { getIdentity: async () => ({ email: "other@example.com" }) } },
      {
        access: {
          getIdentity: async () => {
            throw new Error("invalid session");
          },
        },
      },
    ]) {
      const response = await worker.fetch(
        new Request("https://guard" + path, {
          headers: {
            "Cf-Access-Authenticated-User-Email": "owner@example.com",
            authorization: "Bearer admin-secret",
          },
        }),
        env,
        ctx,
      );
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  }
  assert.equal(forwarded, 0);
});

test("Access session forwards only known browser API routes with server-side authentication", async () => {
  const { default: worker } = await import("./worker.mjs");
  const captured = [];
  const env = {
    ACCESS_ADMIN_EMAILS: "owner@example.com",
    GUARD_ADMIN_TOKEN: "internal-secret",
    CONTROLLER: {
      idFromName: () => "id",
      get: () => ({
        fetch: async (request) => {
          captured.push(request);
          return Response.json({ tripped: true });
        },
      }),
    },
  };
  const ctx = {
    access: { getIdentity: async () => ({ email: "OWNER@example.com" }) },
  };
  const redirect = await worker.fetch(new Request("https://guard/"), env);
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), "https://guard/control");
  for (const [path, method] of [
    ["/control/status", "GET"],
    ["/control/stop", "POST"],
    ["/control/resume-preview", "POST"],
    ["/control/resume-production", "POST"],
  ]) {
    const request = new Request("https://guard" + path, {
      method,
      headers: {
        authorization: "Bearer attacker",
        origin: "https://guard",
        "content-type": "application/json",
      },
      ...(method === "POST"
        ? {
            body: path.endsWith("resume-preview")
              ? '{"confirm":"RESUME_SAVIA_PREVIEW_ONLY"}'
              : path.endsWith("resume-production")
                ? '{"confirm":"RESUME_SAVIA_PRODUCTION_ONLY"}'
                : '{"confirm":"PAUSE_ALL_ENVIRONMENTS"}',
          }
        : {}),
    });
    assert.equal((await worker.fetch(request, env, ctx)).status, 200);
    const forwarded = captured.at(-1);
    assert.equal(new URL(forwarded.url).pathname, path.replace("/control", ""));
    assert.equal(
      forwarded.headers.get("authorization"),
      "Bearer internal-secret",
    );
    assert.equal(forwarded.headers.get("origin"), "https://guard");
  }
  for (const path of [
    "/control/check",
    "/control/recovery",
    "/control/unknown",
  ])
    assert.equal(
      (await worker.fetch(new Request("https://guard" + path), env, ctx))
        .status,
      404,
    );
  assert.equal(captured.length, 4);
  assert.equal(
    (
      await worker.fetch(
        new Request("https://guard/control"),
        { ...env, ACCESS_ADMIN_EMAILS: "" },
        ctx,
      )
    ).status,
    403,
  );
});
