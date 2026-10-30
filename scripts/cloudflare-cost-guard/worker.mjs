import { parsePolicy } from "./policy.mjs";
import { renderControlPanel } from "./panel.mjs";

const API = "https://api.cloudflare.com/client/v4";
const DEFAULT_FIXED_RESERVE_USD = 5;
const DEFAULT_STOP_TOTAL_USD = 15;
const MAX_BILLING_AGE_MS = 48 * 60 * 60 * 1000;

// This deliberately fixed allowlist is the complete Savia preview surface.
// AI binding denial remains outside this exception.
const PREVIEW_RESUME = Object.freeze({
  scripts: new Set([
    "savia-agencies-preview",
    "savia-auth-preview",
    "savia-preview",
    "savia-mcp-preview",
    "savia-request-preview",
    "savia-connectors-preview",
    "savia-hook-executor-preview",
    "savia-flows-preview",
    "savia-plugin-editor-preview",
  ]),
  schedules: new Set(["savia-agencies-preview", "savia-flows-preview"]),
  queues: new Set([
    "ce9d059f73aa45a8a29cf869a5ed5f17",
    "1e9d40c222c64135bb05f67722e3324e",
  ]),
  workflows: new Set(["savia-flows-execute-preview"]),
  domain: { hostname: "savia-preview.hefesoft.com", service: "savia-preview" },
  route: { pattern: "*.savia-preview.hefesoft.com/*", script: "savia-preview" },
});

const PRODUCTION_RESUME = Object.freeze({
  scripts: new Set([
    "savia",
    "savia-agencies",
    "savia-auth",
    "savia-request",
    "savia-hook-executor",
    "savia-connectors",
    "savia-mcp",
  ]),
  schedules: new Set(["savia-agencies"]),
  domains: new Set(["savia.hefesoft.com", "savia-team.savia.hefesoft.com"]),
  routes: new Set(["savia.hefesoft.com/*", "*.savia.hefesoft.com/*"]),
  service: "savia",
  script: "savia",
});

function previewApprovalActive(status) {
  const approvedAt = timestamp(status?.previewApproval?.approvedAt);
  const revokedAt = timestamp(status?.previewApproval?.revokedAt);
  const manualStopAt = timestamp(status?.manualStopAt);
  return (
    approvedAt !== null &&
    revokedAt === null &&
    (manualStopAt === null || approvedAt > manualStopAt)
  );
}

function productionApprovalActive(status) {
  const approvedAt = timestamp(status?.productionApproval?.approvedAt);
  const revokedAt = timestamp(status?.productionApproval?.revokedAt);
  const manualStopAt = timestamp(status?.manualStopAt);
  return (
    approvedAt !== null &&
    revokedAt === null &&
    (manualStopAt === null || approvedAt > manualStopAt)
  );
}

function timestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    return null;
  return Date.parse(value);
}

function fail(reason) {
  return {
    tripped: true,
    reason,
    usageUsd: null,
    totalUsd: null,
    periodStart: null,
  };
}

export function evaluateBillableUsage(
  rows,
  {
    accountId,
    fixedReserveUsd = DEFAULT_FIXED_RESERVE_USD,
    stopTotalUsd = DEFAULT_STOP_TOTAL_USD,
    now = Date.now(),
  } = {},
) {
  if (
    !Array.isArray(rows) ||
    rows.length === 0 ||
    typeof accountId !== "string" ||
    !accountId
  )
    return fail("billing_unavailable");
  if (
    !Number.isFinite(fixedReserveUsd) ||
    fixedReserveUsd < 0 ||
    !Number.isFinite(stopTotalUsd) ||
    stopTotalUsd < 0
  )
    return fail("billing_invalid");
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) return fail("billing_invalid");
  let latestStart = -Infinity;
  for (const row of rows) {
    if (!row || typeof row !== "object" || row.BillingAccountId !== accountId)
      return fail("billing_invalid");
    if (row.BillingCurrency !== "USD") return fail("billing_invalid");
    const billStart = timestamp(row.BillingPeriodStart);
    const chargeStart = timestamp(row.ChargePeriodStart);
    const chargeEnd = timestamp(row.ChargePeriodEnd);
    if (
      billStart === null ||
      chargeStart === null ||
      chargeEnd === null ||
      chargeStart > chargeEnd ||
      chargeEnd > nowMs
    )
      return fail("billing_invalid");
    if (
      typeof row.ContractedCost !== "number" ||
      !Number.isFinite(row.ContractedCost) ||
      row.ContractedCost < 0
    )
      return fail("billing_invalid");
    if (
      typeof row.ServiceName !== "string" ||
      !row.ServiceName ||
      typeof row.ChargeDescription !== "string" ||
      !row.ChargeDescription
    )
      return fail("billing_invalid");
    for (const field of [
      "ServiceFamilyName",
      "SubscriptionId",
      "ZoneId",
      "ConsumedUnit",
      "PricingUnit",
    ]) {
      if (
        row[field] !== undefined &&
        row[field] !== null &&
        typeof row[field] !== "string"
      )
        return fail("billing_invalid");
    }
    if (billStart <= nowMs && billStart > latestStart) latestStart = billStart;
  }
  if (latestStart === -Infinity) return fail("billing_unavailable");
  const periodRows = rows.filter(
    (row) => Date.parse(row.BillingPeriodStart) === latestStart,
  );
  const keys = new Set();
  let newestEnd = -Infinity;
  let usageUsd = 0;
  for (const row of periodRows) {
    const start = Date.parse(row.ChargePeriodStart);
    const end = Date.parse(row.ChargePeriodEnd);
    const identity = [
      row.ServiceName,
      row.ChargeDescription,
      row.ServiceFamilyName ?? "",
      row.SubscriptionId ?? "",
      row.ZoneId ?? "",
      row.ConsumedUnit ?? "",
      row.PricingUnit ?? "",
    ];
    const key = JSON.stringify([start, end, ...identity]);
    if (keys.has(key)) return fail("billing_invalid");
    keys.add(key);
    newestEnd = Math.max(newestEnd, end);
    usageUsd += row.ContractedCost;
  }
  if (
    !periodRows.length ||
    newestEnd === -Infinity ||
    nowMs - newestEnd > MAX_BILLING_AGE_MS
  )
    return fail("billing_stale");
  const totalUsd = usageUsd + fixedReserveUsd;
  return {
    tripped: totalUsd >= stopTotalUsd,
    reason: totalUsd >= stopTotalUsd ? "threshold" : "within_limit",
    usageUsd,
    totalUsd,
    periodStart: new Date(latestStart).toISOString(),
  };
}

function parseBody(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("invalid_response");
  }
}

function unwrap(body) {
  if (
    !body ||
    body.success !== true ||
    !Object.hasOwn(body, "result") ||
    (Array.isArray(body.errors) && body.errors.length > 0)
  )
    throw new Error("api_error");
  return body.result;
}

async function api(
  env,
  path,
  {
    fetcher,
    method = "GET",
    body,
    multipart = false,
    includeMeta = false,
    global = false,
    allowNoResult = false,
  } = {},
) {
  const headers = { Authorization: `Bearer ${env.CF_CONTROL_TOKEN}` };
  let payload = body;
  if (multipart) {
    payload = new FormData();
    payload.set("settings", JSON.stringify(body));
  } else if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetcher(
    `${API}${global ? "" : `/accounts/${encodeURIComponent(env.CF_ACCOUNT_ID)}`}${path}`,
    {
      method,
      headers,
      signal: AbortSignal.timeout(8_000),
      ...(payload === undefined
        ? {}
        : { body: multipart ? payload : JSON.stringify(payload) }),
    },
  );
  if (!response.ok) throw new Error("api_error");
  const responseText = await response.text();
  if (allowNoResult && method === "DELETE" && !responseText.trim())
    return undefined;
  const envelope = parseBody(responseText);
  if (
    allowNoResult &&
    method === "DELETE" &&
    envelope?.success === true &&
    !Object.hasOwn(envelope, "result") &&
    !(Array.isArray(envelope.errors) && envelope.errors.length > 0)
  )
    return undefined;
  const result = unwrap(envelope);
  return includeMeta ? { result, result_info: envelope.result_info } : result;
}

async function listAllPages(
  env,
  path,
  fetcher,
  pageSize = 100,
  global = false,
) {
  const items = [];
  let page = 1;
  let expectedPages = null;
  for (;;) {
    const query = path.includes("?") ? "&" : "?";
    const result = await api(
      env,
      `${path}${query}page=${page}&per_page=${pageSize}`,
      { fetcher, includeMeta: true, global },
    );
    if (!Array.isArray(result.result)) throw new Error("invalid_inventory");
    items.push(...result.result);
    const info = result.result_info;
    if (info && Number.isInteger(info.total_pages)) {
      if (info.total_pages < page) break;
      expectedPages = info.total_pages;
      if (page >= expectedPages) break;
    } else {
      if (result.result.length >= pageSize)
        throw new Error("inventory_pagination_unknown");
      break;
    }
    page++;
    if (page > 1000) throw new Error("inventory_too_large");
  }
  return items;
}

async function mapLimited(items, limit, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

async function readSnapshot(state, key, value) {
  const existing = await state.get(key);
  if (existing === null || existing === undefined)
    await state.put(key, JSON.stringify(value));
}

async function storedStatus(state) {
  const value = await state.get("status");
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return { tripped: true, reason: "state_invalid" };
    }
  }
  return value;
}

async function saveStatus(state, status) {
  await state.put("status", JSON.stringify(status));
}

async function actionResult(action, errors, actionName, target) {
  try {
    await action();
  } catch {
    errors.push({ ok: false, action: actionName, target });
  }
}

async function pauseQueue(env, queueId, fetcher, errors) {
  await actionResult(
    async () => {
      const path = `/queues/${encodeURIComponent(queueId)}`;
      const current = await api(env, path, { fetcher });
      const settings = current.settings;
      if (!settings || typeof settings !== "object")
        throw new Error("invalid_settings");
      await readSnapshot(env.STATE, `recovery:queue:${queueId}`, current);
      if (settings.delivery_paused === true) return;
      await api(env, path, {
        fetcher,
        method: "PATCH",
        body: { settings: { ...settings, delivery_paused: true } },
      });
    },
    errors,
    "queue",
    queueId,
  );
}

async function pauseScript(env, target, fetcher, errors) {
  await actionResult(
    async () => {
      const path = `/workers/scripts/${encodeURIComponent(target.script)}/settings`;
      const current = await api(env, path, { fetcher });
      if (!current || !Array.isArray(current.bindings))
        throw new Error("invalid_settings");
      await readSnapshot(
        env.STATE,
        `recovery:script:${target.script}`,
        current,
      );
      const overrides = target.variables;
      const alreadyPaused = Object.entries(overrides).every(([name, text]) =>
        current.bindings.some(
          (binding) =>
            binding.name === name &&
            binding.type === "plain_text" &&
            binding.text === text,
        ),
      );
      if (alreadyPaused) return;
      const bindings = current.bindings
        .filter((binding) => !Object.hasOwn(overrides, binding.name))
        .map((binding) => ({ type: "inherit", name: binding.name }));
      for (const [name, text] of Object.entries(overrides))
        bindings.push({ type: "plain_text", name, text });
      await api(env, path, {
        fetcher,
        method: "PATCH",
        multipart: true,
        body: { bindings },
      });
    },
    errors,
    "script",
    target.script,
  );
}

async function denyAiBinding(env, script, fetcher, errors) {
  await actionResult(
    async () => {
      const path = `/workers/scripts/${encodeURIComponent(script)}/settings`;
      const current = await api(env, path, { fetcher });
      if (!current || !Array.isArray(current.bindings))
        throw new Error("invalid_settings");
      const aiBindings = current.bindings.filter((binding) =>
        ["ai", "ai_search"].includes(binding.type),
      );
      if (!aiBindings.length) return;
      await readSnapshot(env.STATE, `recovery:ai-binding:${script}`, {
        script,
        bindings: aiBindings,
      });
      const bindings = current.bindings
        .filter((binding) => !["ai", "ai_search"].includes(binding.type))
        .map((binding) => ({ type: "inherit", name: binding.name }));
      await api(env, path, {
        fetcher,
        method: "PATCH",
        multipart: true,
        body: { bindings },
      });
    },
    errors,
    "cloudflare-ai-binding",
    script,
  );
}

async function disableWorkerSubdomain(env, script, fetcher, errors) {
  await actionResult(
    async () => {
      const path = `/workers/scripts/${encodeURIComponent(script)}/subdomain`;
      const current = await api(env, path, { fetcher });
      if (!current || typeof current.enabled !== "boolean")
        throw new Error("invalid_subdomain");
      await readSnapshot(env.STATE, `recovery:subdomain:${script}`, current);
      if (current.enabled === false && current.previews_enabled === false)
        return;
      const updated = await api(env, path, {
        fetcher,
        method: "POST",
        body: { enabled: false, previews_enabled: false },
      });
      if (
        !updated ||
        updated.enabled !== false ||
        updated.previews_enabled !== false
      )
        throw new Error("subdomain_not_disabled");
    },
    errors,
    "worker-subdomain",
    script,
  );
}

async function detachWorkerDomain(env, domain, fetcher, errors) {
  await actionResult(
    async () => {
      if (
        !domain ||
        typeof domain.id !== "string" ||
        !domain.id ||
        typeof domain.hostname !== "string" ||
        typeof domain.service !== "string"
      )
        throw new Error("invalid_domain");
      const snapshot = Object.fromEntries(
        [
          "hostname",
          "service",
          "enabled",
          "previews_enabled",
          "zone_id",
          "zone_name",
          "environment",
        ]
          .filter((key) => domain[key] !== undefined)
          .map((key) => [key, domain[key]]),
      );
      await readSnapshot(env.STATE, `recovery:domain:${domain.id}`, snapshot);
      await api(env, `/workers/domains/${encodeURIComponent(domain.id)}`, {
        fetcher,
        method: "DELETE",
        allowNoResult: true,
      });
    },
    errors,
    "worker-domain",
    domain?.id ?? "unknown",
  );
}

async function disableWorkerRoute(env, route, fetcher, errors) {
  await actionResult(
    async () => {
      if (
        !route ||
        typeof route.zoneId !== "string" ||
        typeof route.id !== "string" ||
        typeof route.pattern !== "string" ||
        typeof route.script !== "string"
      )
        throw new Error("invalid_route");
      const path = `/zones/${encodeURIComponent(route.zoneId)}/workers/routes/${encodeURIComponent(route.id)}`;
      await readSnapshot(
        env.STATE,
        `recovery:route:${route.zoneId}:${route.id}`,
        { pattern: route.pattern, script: route.script },
      );
      await api(env, path, {
        fetcher,
        method: "PUT",
        body: { pattern: route.pattern, script: null },
        global: true,
      });
    },
    errors,
    "worker-route",
    `${route?.zoneId ?? "unknown"}:${route?.id ?? "unknown"}`,
  );
}

async function discoverAccountTargets(env, policy, fetcher, errors) {
  const discovered = {
    scripts: [],
    schedules: [],
    queues: [],
    workflows: [],
    aiSearch: [],
    domains: [],
    routes: [],
  };
  if (!policy.accountWide) return discovered;
  try {
    const scripts = await listAllPages(env, "/workers/scripts", fetcher);
    discovered.scripts = scripts
      .map((script) => script?.id ?? script?.name)
      .filter((name) => typeof name === "string" && name.length > 0);
    if (discovered.scripts.length !== scripts.length)
      errors.push({
        ok: false,
        action: "inventory-workers",
        target: "account",
      });
    discovered.schedules = [...discovered.scripts];
  } catch {
    errors.push({ ok: false, action: "inventory-workers", target: "account" });
  }
  for (const [endpoint, key] of [
    ["/queues", "queues"],
    ["/workflows", "workflows"],
  ]) {
    try {
      const resources = await listAllPages(env, endpoint, fetcher);
      discovered[key] = resources
        .map((resource) =>
          key === "queues" ? resource?.queue_id : resource?.name,
        )
        .filter((name) => typeof name === "string" && name.length > 0);
      if (discovered[key].length !== resources.length)
        errors.push({
          ok: false,
          action: `inventory-${key}`,
          target: "account",
        });
    } catch {
      errors.push({ ok: false, action: `inventory-${key}`, target: "account" });
    }
  }
  try {
    const namespaces = await listAllPages(
      env,
      "/ai-search/namespaces",
      fetcher,
    );
    for (const namespace of namespaces) {
      if (typeof namespace?.name !== "string") {
        errors.push({
          ok: false,
          action: "inventory-ai-search",
          target: "account",
        });
        continue;
      }
      try {
        const instances = await listAllPages(
          env,
          `/ai-search/namespaces/${encodeURIComponent(namespace.name)}/instances`,
          fetcher,
        );
        for (const instance of instances) {
          if (typeof instance?.id !== "string") {
            errors.push({
              ok: false,
              action: "inventory-ai-search",
              target: namespace.name,
            });
            continue;
          }
          discovered.aiSearch.push({
            namespace: namespace.name,
            id: instance.id,
          });
        }
      } catch {
        errors.push({
          ok: false,
          action: "inventory-ai-search",
          target: namespace.name,
        });
      }
    }
  } catch {
    errors.push({
      ok: false,
      action: "inventory-ai-search",
      target: "account",
    });
  }
  try {
    discovered.domains = await listAllPages(env, "/workers/domains", fetcher);
    const invalidDomain = discovered.domains.some(
      (domain) =>
        !domain ||
        typeof domain.id !== "string" ||
        typeof domain.hostname !== "string" ||
        typeof domain.service !== "string",
    );
    if (invalidDomain)
      errors.push({
        ok: false,
        action: "inventory-domains",
        target: "account",
      });
    const protectedScripts = new Set([
      policy.guardScript,
      ...policy.backupBarrierScripts,
    ]);
    discovered.domains = discovered.domains.filter(
      (domain) => !protectedScripts.has(domain?.service),
    );
  } catch {
    errors.push({ ok: false, action: "inventory-domains", target: "account" });
  }
  try {
    const zones = await listAllPages(
      env,
      `/zones?account.id=${encodeURIComponent(env.CF_ACCOUNT_ID)}`,
      fetcher,
      100,
      true,
    );
    for (const zone of zones) {
      if (typeof zone?.id !== "string" || !zone.id) {
        errors.push({
          ok: false,
          action: "inventory-zones",
          target: "account",
        });
        continue;
      }
      try {
        const routes = await listAllPages(
          env,
          `/zones/${encodeURIComponent(zone.id)}/workers/routes`,
          fetcher,
          100,
          true,
        );
        for (const route of routes) {
          if (
            !route ||
            typeof route.id !== "string" ||
            typeof route.pattern !== "string"
          ) {
            errors.push({
              ok: false,
              action: "inventory-zone-routes",
              target: zone.id,
            });
            continue;
          }
          if (typeof route.script === "string")
            discovered.routes.push({ ...route, zoneId: zone.id });
        }
      } catch {
        errors.push({
          ok: false,
          action: "inventory-zone-routes",
          target: zone.id,
        });
      }
    }
  } catch {
    errors.push({ ok: false, action: "inventory-zones", target: "account" });
  }
  const excluded = new Set([
    policy.guardScript,
    ...policy.backupBarrierScripts,
  ]);
  discovered.schedules = discovered.schedules.filter(
    (name) =>
      !excluded.has(name) && !policy.maintenanceSchedules.includes(name),
  );
  discovered.routes = discovered.routes.filter(
    (route) => !excluded.has(route.script),
  );
  return discovered;
}

async function pauseSchedule(env, script, fetcher, errors) {
  await actionResult(
    async () => {
      const path = `/workers/scripts/${encodeURIComponent(script)}/schedules`;
      const current = await api(env, path, { fetcher });
      const schedules = current.schedules;
      if (!Array.isArray(schedules)) throw new Error("invalid_schedules");
      await readSnapshot(env.STATE, `recovery:schedule:${script}`, schedules);
      if (!schedules.length) return;
      await api(env, path, { fetcher, method: "PUT", body: [] });
    },
    errors,
    "schedule",
    script,
  );
}

async function pauseWorkflowInstance(env, workflow, instance, fetcher, errors) {
  if (
    !instance ||
    typeof instance.id !== "string" ||
    !instance.id ||
    typeof instance.status !== "string"
  ) {
    errors.push({ ok: false, action: "workflow-instance", target: workflow });
    return;
  }
  if (!["queued", "running"].includes(instance.status)) return;
  const snapshotKey = `recovery:workflow:${workflow}:${encodeURIComponent(instance.id)}`;
  await actionResult(
    async () => {
      await readSnapshot(env.STATE, snapshotKey, instance);
      const path = `/workflows/${encodeURIComponent(workflow)}/instances/${encodeURIComponent(instance.id)}/status`;
      await api(env, path, {
        fetcher,
        method: "PATCH",
        body: { status: "pause" },
      });
    },
    errors,
    "workflow-instance",
    `${workflow}:${instance.id}`,
  );
}

async function pauseWorkflow(env, workflow, fetcher, errors) {
  const cursorKey = `progress:workflow:${workflow}`;
  let progress = await env.STATE.get(cursorKey);
  if (typeof progress === "string") {
    try {
      progress = JSON.parse(progress);
    } catch {
      progress = {};
    }
  }
  if (!progress || typeof progress !== "object") progress = {};
  let changed = false;
  await Promise.all(
    ["queued", "running"].map(async (status) => {
      const cursor =
        typeof progress[status] === "string" ? progress[status] : "";
      const query = new URLSearchParams({ per_page: "20", status });
      if (cursor) query.set("cursor", cursor);
      try {
        const page = await api(
          env,
          `/workflows/${encodeURIComponent(workflow)}/instances?${query}`,
          { fetcher, includeMeta: true },
        );
        if (!Array.isArray(page.result)) throw new Error("invalid_instances");
        const listErrors = [];
        await Promise.all(
          page.result.map((instance) =>
            pauseWorkflowInstance(env, workflow, instance, fetcher, listErrors),
          ),
        );
        if (listErrors.length) {
          errors.push(...listErrors);
          return;
        }
        const next = page.result_info?.cursor;
        const hasMore = typeof next === "string" && next.length > 0;
        progress[status] = hasMore ? next : "";
        if (hasMore && page.result.length >= 20)
          errors.push({
            ok: false,
            action: "workflow-pending",
            target: workflow,
          });
        changed = true;
      } catch {
        errors.push({ ok: false, action: "workflow-list", target: workflow });
      }
    }),
  );
  if (changed) await env.STATE.put(cursorKey, JSON.stringify(progress));
}

async function pauseAiSearch(env, target, fetcher, errors) {
  await actionResult(
    async () => {
      const namespace = encodeURIComponent(target.namespace);
      const id = encodeURIComponent(target.id);
      const path = `/ai-search/namespaces/${namespace}/instances/${id}`;
      const current = await api(env, path, { fetcher });
      if (!current || typeof current.paused !== "boolean")
        throw new Error("invalid_instance");
      await readSnapshot(
        env.STATE,
        `recovery:ai-search:${target.namespace}:${target.id}`,
        current,
      );
      if (current.paused) return;
      const body = { paused: true };
      if (
        current.public_endpoint_params &&
        typeof current.public_endpoint_params === "object"
      ) {
        body.public_endpoint_params = current.public_endpoint_params;
      }
      await api(env, path, { fetcher, method: "PUT", body });
    },
    errors,
    "ai-search",
    `${target.namespace}:${target.id}`,
  );
}

export async function pauseTargets(
  env,
  policy,
  fetcher,
  discovered,
  previewApproved,
  productionApproved = false,
) {
  const errors = [];
  const results = [];
  const run = async ({ action, target, execute }) => {
    const actionErrors = [];
    try {
      await execute(actionErrors);
    } catch {
      actionErrors.push({ ok: false, action, target });
    }
    errors.push(...actionErrors);
    results.push({ action, target, ok: actionErrors.length === 0 });
  };
  const aiScripts = policy.denyCloudflareAi
    ? [
        ...new Set([
          ...policy.scripts.map(({ script }) => script),
          ...discovered.scripts,
        ]),
      ]
    : [];
  await mapLimited(aiScripts, 4, (script) =>
    run({
      action: "ai-binding",
      target: script,
      execute: (failures) => denyAiBinding(env, script, fetcher, failures),
    }),
  );
  const scriptTargets = [
    ...policy.scripts
      .filter(
        ({ script }) =>
          !(
            (previewApproved && PREVIEW_RESUME.scripts.has(script)) ||
            (productionApproved && PRODUCTION_RESUME.scripts.has(script))
          ),
      )
      .map((target) => ({ mode: "configured", ...target })),
    ...discovered.scripts
      .filter(
        (script) =>
          script !== policy.guardScript &&
          !policy.backupBarrierScripts.includes(script) &&
          !(
            (previewApproved && PREVIEW_RESUME.scripts.has(script)) ||
            (productionApproved && PRODUCTION_RESUME.scripts.has(script))
          ),
      )
      .map((script) => ({ mode: "account", script })),
  ];
  const queues = [...new Set([...policy.queues, ...discovered.queues])].filter(
    (queue) => !(previewApproved && PREVIEW_RESUME.queues.has(queue)),
  );
  const schedules = [
    ...new Set(
      [...policy.schedules, ...discovered.schedules].filter(
        (name) =>
          !policy.maintenanceSchedules.includes(name) &&
          !(
            (previewApproved && PREVIEW_RESUME.schedules.has(name)) ||
            (productionApproved && PRODUCTION_RESUME.schedules.has(name))
          ),
      ),
    ),
  ];
  const workflows = [
    ...new Set([...policy.workflows, ...discovered.workflows]),
  ].filter(
    (workflow) => !(previewApproved && PREVIEW_RESUME.workflows.has(workflow)),
  );
  const actions = [
    ...queues.map((id) => ({
      action: "queue",
      target: id,
      execute: (failures) => pauseQueue(env, id, fetcher, failures),
    })),
    ...scriptTargets.map((target) => ({
      action:
        target.mode === "configured" ? "worker-settings" : "worker-access",
      target: target.script,
      execute: (failures) =>
        target.mode === "configured"
          ? pauseScript(env, target, fetcher, failures)
          : disableWorkerSubdomain(env, target.script, fetcher, failures),
    })),
    ...schedules.map((script) => ({
      action: "schedule",
      target: script,
      execute: (failures) => pauseSchedule(env, script, fetcher, failures),
    })),
    ...workflows.map((workflow) => ({
      action: "workflow",
      target: workflow,
      execute: (failures) => pauseWorkflow(env, workflow, fetcher, failures),
    })),
    ...aiSearchTargets(policy, discovered).map((target) => ({
      action: "ai-search",
      target: `${target.namespace}:${target.id}`,
      execute: (failures) => pauseAiSearch(env, target, fetcher, failures),
    })),
    ...discovered.domains
      .filter(
        (domain) =>
          !(
            previewApproved &&
            domain.hostname === PREVIEW_RESUME.domain.hostname &&
            domain.service === PREVIEW_RESUME.domain.service
          ) &&
          !(
            productionApproved &&
            PRODUCTION_RESUME.domains.has(domain.hostname) &&
            domain.service === PRODUCTION_RESUME.service
          ),
      )
      .map((domain) => ({
        action: "domain",
        target: domain.hostname ?? domain.id,
        execute: (failures) =>
          detachWorkerDomain(env, domain, fetcher, failures),
      })),
    ...discovered.routes
      .filter(
        (route) =>
          !(
            previewApproved &&
            route.pattern === PREVIEW_RESUME.route.pattern &&
            route.script === PREVIEW_RESUME.route.script
          ) &&
          !(
            productionApproved &&
            PRODUCTION_RESUME.routes.has(route.pattern) &&
            route.script === PRODUCTION_RESUME.script
          ),
      )
      .map((route) => ({
        action: "route",
        target: route.pattern ?? route.id,
        execute: (failures) =>
          disableWorkerRoute(env, route, fetcher, failures),
      })),
  ];
  await mapLimited(actions, 4, run);
  return { errors, results };
}

function aiSearchTargets(policy, discovered) {
  return [
    ...new Map(
      [...policy.aiSearch, ...discovered.aiSearch].map((item) => [
        `${item.namespace}:${item.id}`,
        item,
      ]),
    ).values(),
  ];
}

async function billing(env, fetcher) {
  const result = await api(env, "/billable-usage", { fetcher });
  return Array.isArray(result) ? result : result?.result;
}

export async function executeCheck(
  env,
  { fetcher = fetch, now = Date.now(), manualStop = false } = {},
) {
  let prior = await storedStatus(env.STATE);
  const checkedAt = new Date(
    now instanceof Date ? now.getTime() : Number(now),
  ).toISOString();
  if (manualStop) {
    prior = {
      ...prior,
      tripped: true,
      reason: "manual_stop",
      manualStopAt: checkedAt,
      previewApproval: {
        ...(prior?.previewApproval?.approvedAt
          ? { approvedAt: prior.previewApproval.approvedAt }
          : {}),
        revokedAt: checkedAt,
      },
      productionApproval: {
        ...(prior?.productionApproval?.approvedAt
          ? { approvedAt: prior.productionApproval.approvedAt }
          : {}),
        revokedAt: checkedAt,
      },
      checkedAt,
      phase: "stopping",
      actionErrors: [],
      targetResults: [],
    };
    // Persist before billing, discovery or any other external request.
    await saveStatus(env.STATE, prior);
  }
  const policy = parsePolicy(env.POLICY);
  let measured;
  if (manualStop) {
    measured = {
      tripped: true,
      reason: "manual_stop",
      usageUsd: prior?.usageUsd ?? null,
      totalUsd: prior?.totalUsd ?? null,
      periodStart: prior?.periodStart ?? null,
    };
  } else {
    try {
      measured = evaluateBillableUsage(await billing(env, fetcher), {
        accountId: env.CF_ACCOUNT_ID,
        now,
      });
    } catch {
      measured = fail("billing_unavailable");
    }
  }
  const inventoryErrors = [];
  const discovered = await discoverAccountTargets(
    env,
    policy,
    fetcher,
    inventoryErrors,
  );
  const tripped = Boolean(prior?.tripped || measured.tripped);
  const status = {
    tripped,
    reason: prior?.tripped ? prior.reason : measured.reason,
    usageUsd: measured.usageUsd,
    totalUsd: measured.totalUsd,
    periodStart: measured.periodStart,
    checkedAt: new Date(
      now instanceof Date ? now.getTime() : Number(now),
    ).toISOString(),
    actionErrors: inventoryErrors,
    targetResults: [],
    phase: tripped ? "stopping" : "monitoring",
    ...(prior?.manualStopAt ? { manualStopAt: prior.manualStopAt } : {}),
    ...(prior?.previewApproval
      ? { previewApproval: prior.previewApproval }
      : {}),
    ...(prior?.productionApproval
      ? { productionApproval: prior.productionApproval }
      : {}),
    previewApproved: previewApprovalActive(prior),
    productionApproved: productionApprovalActive(prior),
  };
  if (policy.denyCloudflareAi && !tripped) {
    status.actionErrors = inventoryErrors;
    await mapLimited(
      [
        ...new Set([
          ...policy.scripts.map(({ script }) => script),
          ...discovered.scripts,
        ]),
      ].filter((script) => script !== policy.guardScript),
      4,
      (script) => denyAiBinding(env, script, fetcher, status.actionErrors),
    );
    await mapLimited(aiSearchTargets(policy, discovered), 4, (target) =>
      pauseAiSearch(env, target, fetcher, status.actionErrors),
    );
  }
  if (tripped) {
    await saveStatus(env.STATE, status);
    const paused = await pauseTargets(
      env,
      policy,
      fetcher,
      discovered,
      status.previewApproved,
      status.productionApproved,
    );
    status.actionErrors = [...inventoryErrors, ...paused.errors];
    status.targetResults = paused.results;
    status.phase = status.actionErrors.length ? "incomplete" : "paused";
    await saveStatus(env.STATE, status);
  } else {
    await saveStatus(env.STATE, status);
  }
  return status;
}

function equalToken(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++)
    difference |=
      (left[i % (left.length || 1)] ?? 0) ^
      (right[i % (right.length || 1)] ?? 0);
  return difference === 0;
}

function authorized(request, env) {
  const value = request.headers.get("authorization") ?? "";
  return (
    value.startsWith("Bearer ") &&
    typeof env.GUARD_ADMIN_TOKEN === "string" &&
    env.GUARD_ADMIN_TOKEN.length > 0 &&
    equalToken(value.slice(7), env.GUARD_ADMIN_TOKEN)
  );
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health")
    return Response.json({ ok: true });
  if (
    (request.method === "GET" &&
      ["/status", "/recovery"].includes(url.pathname)) ||
    (request.method === "POST" &&
      ["/check", "/stop", "/resume-preview", "/resume-production"].includes(
        url.pathname,
      ))
  ) {
    if (!authorized(request, env))
      return Response.json({ error: "unauthorized" }, { status: 401 });
    if (url.pathname === "/status")
      return Response.json(
        (await storedStatus(env.STATE)) ?? {
          tripped: false,
          reason: "not_checked",
        },
      );
    if (url.pathname === "/recovery") {
      const startAfter =
        url.searchParams.get("cursor") ??
        url.searchParams.get("startAfter") ??
        "";
      if (
        startAfter &&
        (!startAfter.startsWith("recovery:") || startAfter.length > 256)
      )
        return Response.json({ error: "invalid_cursor" }, { status: 400 });
      if (typeof env.STATE.list !== "function")
        return Response.json(
          { error: "recovery_unavailable" },
          { status: 503 },
        );
      try {
        const values = await env.STATE.list({
          prefix: "recovery:",
          ...(startAfter ? { startAfter } : {}),
          limit: 100,
        });
        const entries =
          values instanceof Map
            ? [...values.entries()]
            : Object.entries(values ?? {});
        const records = entries.slice(0, 100).map(([key, value]) => {
          let parsed;
          try {
            parsed = typeof value === "string" ? JSON.parse(value) : value;
          } catch {
            parsed = { error: "invalid_snapshot" };
          }
          return { key, value: parsed };
        });
        return Response.json({
          records,
          nextCursor:
            entries.length >= 100 && records.length
              ? records[records.length - 1].key
              : null,
        });
      } catch {
        return Response.json(
          { error: "recovery_unavailable" },
          { status: 503 },
        );
      }
    }
    if (
      ["/stop", "/resume-preview", "/resume-production"].includes(url.pathname)
    ) {
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin)
        return Response.json({ error: "forbidden_origin" }, { status: 403 });
      if (
        request.headers.get("content-type")?.split(";")[0].trim() !==
        "application/json"
      )
        return Response.json(
          { error: "confirmation_required" },
          { status: 400 },
        );
      try {
        const text = await request.text();
        if (
          text.length > 128 ||
          JSON.parse(text)?.confirm !==
            (url.pathname === "/stop"
              ? "PAUSE_ALL_ENVIRONMENTS"
              : url.pathname === "/resume-preview"
                ? "RESUME_SAVIA_PREVIEW_ONLY"
                : "RESUME_SAVIA_PRODUCTION_ONLY")
        )
          return Response.json(
            { error: "confirmation_required" },
            { status: 400 },
          );
      } catch {
        return Response.json(
          { error: "confirmation_required" },
          { status: 400 },
        );
      }
    }
    try {
      if (["/resume-preview", "/resume-production"].includes(url.pathname)) {
        const prior = await storedStatus(env.STATE);
        const production = url.pathname === "/resume-production";
        if (
          !prior?.tripped ||
          prior.phase !== "paused" ||
          !Array.isArray(prior.actionErrors) ||
          prior.actionErrors.length !== 0 ||
          (production &&
            (prior.reason !== "manual_stop" ||
              timestamp(prior.manualStopAt) === null))
        )
          return Response.json(
            { error: "guard_not_fully_paused" },
            { status: 409 },
          );
        if (
          production
            ? productionApprovalActive(prior)
            : previewApprovalActive(prior)
        )
          return Response.json(prior);
        const approvedAt = new Date().toISOString();
        const approved = {
          ...prior,
          ...(production
            ? {
                productionApproval: { approvedAt },
                productionApproved: true,
              }
            : { previewApproval: { approvedAt }, previewApproved: true }),
        };
        // Persist the narrow, auditable approval before checks can run.
        await saveStatus(env.STATE, approved);
        const result = await executeCheck(env, { now: Date.parse(approvedAt) });
        return Response.json(result);
      }
      return Response.json(
        await executeCheck(env, { manualStop: url.pathname === "/stop" }),
      );
    } catch {
      return Response.json({ error: "check_failed" }, { status: 503 });
    }
  }
  return new Response("not found", { status: 404 });
}

function controller(env) {
  const id = env.CONTROLLER.idFromName("account-budget");
  return env.CONTROLLER.get(id);
}

export class CostGuard {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.state = {
      get: (key) => ctx.storage.get(key).then((value) => value ?? null),
      put: (key, value) => ctx.storage.put(key, value),
      list: (options) => ctx.storage.list(options),
    };
  }

  async fetch(request) {
    return this.ctx.blockConcurrencyWhile(() =>
      handleRequest(request, { ...this.env, STATE: this.state }),
    );
  }
}

async function runScheduledCheck(env) {
  let status;
  if (env.CONTROLLER) {
    const request = new Request("https://cost-guard.internal/check", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.GUARD_ADMIN_TOKEN}` },
    });
    const response = await controller(env).fetch(request);
    if (!response.ok) throw new Error("cost guard check failed");
    try {
      status = await response.json();
    } catch {
      throw new Error("cost guard check failed");
    }
  } else {
    status = await executeCheck(env);
  }
  if (
    !status ||
    typeof status !== "object" ||
    !Array.isArray(status.actionErrors) ||
    status.actionErrors.length
  ) {
    throw new Error("cost guard pause actions incomplete");
  }
  return status;
}

function secureResponse(response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, { status: response.status, headers });
}

function controlPanel() {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  return secureResponse(
    new Response(renderControlPanel({ nonce }), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
      },
    }),
  );
}

const worker = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/" && request.method === "GET") {
      return secureResponse(Response.redirect(new URL("/control", url), 302));
    }
    if (url.pathname === "/control" || url.pathname.startsWith("/control/")) {
      // Only platform-verified Access context is trusted, never caller headers.
      const allowed = String(env.ACCESS_ADMIN_EMAILS || "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean);
      let identity;
      try {
        identity = await ctx?.access?.getIdentity();
      } catch {
        /* Fail closed. */
      }
      if (!identity?.email || !allowed.includes(identity.email.toLowerCase())) {
        return secureResponse(
          Response.json({ error: "access_session_required" }, { status: 403 }),
        );
      }
      if (
        request.method === "GET" &&
        ["/control", "/control/"].includes(url.pathname)
      )
        return controlPanel();
      const target = {
        "GET /control/status": "/status",
        "POST /control/stop": "/stop",
        "POST /control/resume-preview": "/resume-preview",
        "POST /control/resume-production": "/resume-production",
      }[`${request.method} ${url.pathname}`];
      if (!target)
        return secureResponse(new Response("not found", { status: 404 }));
      if (!env.GUARD_ADMIN_TOKEN)
        return secureResponse(
          Response.json({ error: "controller_unavailable" }, { status: 503 }),
        );
      url.pathname = target;
      const headers = new Headers(request.headers);
      headers.set("Authorization", `Bearer ${env.GUARD_ADMIN_TOKEN}`);
      request = new Request(url, {
        method: request.method,
        headers,
        ...(request.method === "POST"
          ? { body: request.body, duplex: "half" }
          : {}),
      });
    }
    const response = env.CONTROLLER
      ? await controller(env).fetch(request)
      : await handleRequest(request, env);
    return secureResponse(response);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runScheduledCheck(env));
  },
};

export default worker;
