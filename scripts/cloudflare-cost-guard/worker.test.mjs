import test from "node:test";
import assert from "node:assert/strict";
import { executeCheck, evaluateBillableUsage } from "./worker.mjs";

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
  for (const path of ["/", "/control"]) {
    const panel = await worker.fetch(
      new Request(`https://guard${path}`),
      h.env,
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
