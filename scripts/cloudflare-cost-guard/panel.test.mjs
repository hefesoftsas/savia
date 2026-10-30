import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { renderControlPanel } from "./panel.mjs";

function makeHarness(fetcher) {
  const elements = new Map();
  const navigations = [];
  const makeElement = (id = "") => ({
    id,
    value: "",
    textContent: "",
    className: "",
    hidden: false,
    disabled: false,
    children: [],
    handlers: {},
    addEventListener(type, handler) {
      this.handlers[type] = handler;
    },
    append(...items) {
      this.children.push(...items);
    },
    replaceChildren(...items) {
      this.children = [...items];
    },
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
    focus() {
      this.focused = true;
    },
  });
  const ids = [
    "session-error",
    "workspace",
    "logout",
    "pause-button",
    "preview-button",
    "production-button",
    "confirm-dialog",
    "cancel-stop",
    "confirm-stop",
    "action-message",
    "status-indicator",
    "stop-reason",
    "manual-stop-at",
    "checked-at",
    "preview-approved-at",
    "production-approved-at",
    "incomplete-summary",
    "action-errors",
    "target-results",
    "status-view",
    "refresh-button",
  ];
  for (const id of ids) elements.set(id, makeElement(id));
  elements.get("workspace").hidden = true;
  elements.get("status-view").hidden = true;
  elements.get("status-indicator").textContent = "—";
  const context = {
    document: {
      getElementById: (id) => elements.get(id),
      createElement: () => makeElement(),
    },
    fetch: fetcher,
    location: { assign: (url) => navigations.push(url) },
    window: { confirm: () => true },
    Date,
    JSON,
    Error,
    Number,
    String,
    Array,
    AbortSignal: { timeout: (milliseconds) => ({ milliseconds }) },
  };
  const html = renderControlPanel({ nonce: "test-nonce" });
  const script = html.match(/<script nonce="[^"]*">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "panel contains its inline controller");
  vm.runInNewContext(script, context);
  const event = (extra = {}) => ({ preventDefault() {}, ...extra });
  return { elements, event, navigations };
}

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("panel output is static, nonce-safe, and contains no browser persistence or remote assets", async () => {
  const html = renderControlPanel({ nonce: `x" onload="alert(1)&` });
  assert.match(html, /nonce="x&quot; onload=&quot;alert\(1\)&amp;"/);
  assert.doesNotMatch(
    html,
    /<form|type="password"|admin-key|administrator key/i,
  );
  assert.match(html, /Cloudflare Access/);
  assert.match(html, /Pause all environments/);
  assert.match(html, /Approve Savia preview only/);
  assert.match(html, /Confirm pause/);
  assert.match(html, /Backup coordinators/);
  assert.match(html, /Daily cleanup/);
  assert.match(html, /cdn-cgi\/access\/logout/);
  assert.doesNotMatch(
    html,
    /(?:localStorage|sessionStorage|indexedDB|caches\.|CacheStorage)/i,
  );
  assert.doesNotMatch(
    html,
    /(?:https?:)?\/\/(?:[^"'\s>]+)|<\s*(?:img|link)[^>]+(?:src|href)=/i,
  );
  assert.doesNotMatch(html, /\b(?:co|dex)\s*branding\b/i);
  const source = await readFile(
    new URL("./panel.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /(?:localStorage|sessionStorage|indexedDB|caches\.)/i,
  );
});

test("preview approval appears only after a complete pause and submits one confirmed request", async () => {
  let resolveApproval;
  const calls = [];
  const h = makeHarness((path, options) => {
    calls.push({ path, options });
    if (path === "/control/status")
      return response(200, {
        tripped: true,
        phase: "paused",
        actionErrors: [],
      });
    return new Promise((resolve) => {
      resolveApproval = resolve;
    });
  });
  await tick();
  const preview = h.elements.get("preview-button");
  assert.equal(preview.hidden, false);

  const approval = preview.handlers.click();
  assert.equal(
    preview.disabled,
    true,
    "the pending request disables duplicate approval",
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[1].path, "/control/resume-preview");
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[1].options.credentials, "same-origin");
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    confirm: "RESUME_SAVIA_PREVIEW_ONLY",
  });
  await preview.handlers.click();
  assert.equal(
    calls.length,
    2,
    "a pending preview approval cannot be repeated",
  );

  resolveApproval(
    response(200, {
      tripped: true,
      phase: "paused",
      previewApproved: true,
      previewApproval: { approvedAt: "2026-10-24T12:00:00Z" },
      manualStopAt: "2026-10-24T11:00:00Z",
      actionErrors: [],
    }),
  );
  await approval;
  assert.equal(preview.hidden, true);
  assert.notEqual(h.elements.get("preview-approved-at").textContent, "—");
  assert.match(
    h.elements.get("action-message").textContent,
    /SECOP stays paused/,
  );
});

test("preview approval stays hidden unless the account-wide pause completed cleanly", async () => {
  for (const status of [
    { tripped: false, phase: "monitoring" },
    { tripped: true, phase: "incomplete", actionErrors: [] },
    { tripped: true, phase: "paused", actionErrors: [{ action: "queue" }] },
  ]) {
    const h = makeHarness(async () => response(200, status));
    await tick();
    assert.equal(h.elements.get("preview-button").hidden, true);
  }
});

test("production approval is separate and sends the scoped confirmation", async () => {
  const calls = [];
  const h = makeHarness(async (path, options) => {
    calls.push({ path, options });
    return response(200, {
      tripped: true,
      phase: "paused",
      actionErrors: [],
      ...(path === "/control/resume-production"
        ? {
            productionApproved: true,
            productionApproval: { approvedAt: "2026-10-29T00:00:00Z" },
          }
        : {}),
    });
  });
  await tick();
  const button = h.elements.get("production-button");
  assert.equal(button.hidden, false);
  await button.handlers.click();
  assert.equal(calls[1].path, "/control/resume-production");
  assert.equal(calls[1].options.credentials, "same-origin");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    confirm: "RESUME_SAVIA_PRODUCTION_ONLY",
  });
  assert.equal(button.hidden, true);
  assert.notEqual(h.elements.get("production-approved-at").textContent, "—");
});

test("production approval is unavailable until a clean pause is complete", async () => {
  for (const status of [
    { tripped: false, phase: "monitoring" },
    { tripped: true, phase: "incomplete", actionErrors: [] },
    { tripped: true, phase: "paused", actionErrors: [{ action: "queue" }] },
  ]) {
    const h = makeHarness(async () => response(200, status));
    await tick();
    assert.equal(h.elements.get("production-button").hidden, true);
  }
});

test("Access session auto-loads status and confirmation gates same-origin POST /control/stop", async () => {
  const calls = [];
  const h = makeHarness(async (path, options) => {
    calls.push({ path, options });
    return response(200, {
      tripped: false,
      reason: "within_limit",
      checkedAt: "2026-10-24T12:00:00Z",
    });
  });
  await tick();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/control/status");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.headers["X-Requested-With"], "XMLHttpRequest");
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[0].options.signal.milliseconds, 90000);
  assert.equal(h.elements.get("workspace").hidden, false);
  assert.equal(h.elements.get("status-indicator").textContent, "ACTIVE");

  h.elements.get("pause-button").handlers.click();
  assert.equal(h.elements.get("confirm-dialog").open, true);
  assert.equal(
    calls.length,
    1,
    "opening confirmation does not send a stop request",
  );
  h.elements.get("confirm-stop").handlers.click();
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].path, "/control/stop");
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[1].options.credentials, "same-origin");
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.headers["X-Requested-With"], "XMLHttpRequest");
  assert.equal(calls[1].options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    confirm: "PAUSE_ALL_ENVIRONMENTS",
  });
});

test("partial stop results and action errors remain visible as text", async () => {
  let requestCount = 0;
  const h = makeHarness(async () => {
    requestCount += 1;
    if (requestCount === 1) return response(200, { tripped: false });
    return response(200, {
      tripped: true,
      reason: "manual_stop",
      phase: "incomplete",
      manualStopAt: "2026-10-24T12:30:00Z",
      actionErrors: [
        {
          action: "pause-worker",
          target: "edge-api",
          message: "Remote API unavailable",
        },
      ],
      targetResults: [
        { action: "pause-worker", target: "edge-api", ok: false },
        { action: "pause-worker", target: "queue-worker", ok: true },
      ],
    });
  });
  await tick();
  h.elements.get("pause-button").handlers.click();
  h.elements.get("confirm-stop").handlers.click();
  await tick();

  assert.equal(
    h.elements.get("status-indicator").textContent,
    "PAUSE INCOMPLETE",
  );
  assert.equal(h.elements.get("stop-reason").textContent, "Manual pause");
  assert.match(
    h.elements.get("incomplete-summary").textContent,
    /1 incomplete action/,
  );
  assert.equal(
    h.elements.get("action-errors").children[0].textContent,
    "pause-worker · edge-api · Remote API unavailable",
  );
  assert.equal(h.elements.get("target-results").children.length, 2);
  assert.match(
    h.elements.get("target-results").children[0].children[1].textContent,
    /Failed/,
  );
  assert.match(
    h.elements.get("target-results").children[1].children[1].textContent,
    /Applied/,
  );
  assert.match(h.elements.get("action-message").textContent, /incomplete/);
  assert.equal(
    h.elements.get("target-results").children[0].children[0].textContent,
    "pause-worker · edge-api",
  );
});

test("ordinary stop failure keeps status and confirmation visible for recovery", async () => {
  const h = makeHarness(async (path) =>
    path === "/control/status"
      ? response(200, { tripped: false })
      : response(503, { error: "stop_unavailable" }),
  );
  await tick();
  h.elements.get("pause-button").handlers.click();
  await h.elements.get("confirm-stop").handlers.click();

  assert.equal(h.elements.get("workspace").hidden, false);
  assert.equal(h.elements.get("status-indicator").textContent, "ACTIVE");
  assert.equal(h.elements.get("confirm-dialog").open, true);
  assert.match(
    h.elements.get("action-message").textContent,
    /Unable to confirm pause completion/,
  );
  assert.match(
    h.elements.get("action-message").textContent,
    /stop_unavailable/,
  );
});

test("403 during a stop clears prior status and partial outcomes", async () => {
  let stopRequested = false;
  const h = makeHarness(async (path) => {
    if (path === "/control/status") {
      return response(200, {
        tripped: true,
        phase: "incomplete",
        actionErrors: [{ action: "queue", target: "private-queue" }],
        targetResults: [
          { action: "queue", target: "private-queue", ok: false },
        ],
      });
    }
    stopRequested = true;
    return response(403, { error: "session_expired" });
  });
  await tick();
  assert.equal(h.elements.get("action-errors").children.length, 1);
  assert.equal(h.elements.get("target-results").children.length, 1);
  h.elements.get("pause-button").handlers.click();
  await h.elements.get("confirm-stop").handlers.click();

  assert.equal(stopRequested, true);
  assert.match(h.elements.get("session-error").textContent, /session expired/i);
  assert.equal(h.elements.get("workspace").hidden, true);
  assert.equal(h.elements.get("action-errors").children.length, 0);
  assert.equal(h.elements.get("target-results").children.length, 0);
  assert.equal(h.elements.get("status-indicator").textContent, "—");
});

test("403 marks the Access session expired and fails closed", async () => {
  const h = makeHarness(async () => response(403, { error: "access_denied" }));
  await tick();
  assert.match(h.elements.get("session-error").textContent, /session expired/i);
  assert.equal(h.elements.get("workspace").hidden, true);
  assert.equal(h.elements.get("status-indicator").textContent, "—");
  assert.equal(h.elements.get("target-results").children.length, 0);
  assert.equal(h.elements.get("pause-button").disabled, true);
});

test("401 on refresh clears the loaded status and marks the Access session expired", async () => {
  let statusCount = 0;
  const h = makeHarness(async () => {
    statusCount += 1;
    return statusCount === 1
      ? response(200, {
          tripped: true,
          phase: "incomplete",
          actionErrors: [{ action: "queue", target: "private-queue" }],
          targetResults: [
            { action: "queue", target: "private-queue", ok: false },
          ],
        })
      : response(401, { error: "unauthorized" });
  });
  await tick();
  assert.equal(h.elements.get("action-errors").children.length, 1);
  assert.equal(h.elements.get("target-results").children.length, 1);

  await h.elements.get("refresh-button").handlers.click();

  assert.match(h.elements.get("session-error").textContent, /session expired/i);
  assert.equal(h.elements.get("workspace").hidden, true);
  assert.equal(h.elements.get("action-errors").children.length, 0);
  assert.equal(h.elements.get("target-results").children.length, 0);
  assert.equal(h.elements.get("status-indicator").textContent, "—");
});

test("redirected HTML sign-in response clears loaded status as an expired session", async () => {
  let statusCount = 0;
  const h = makeHarness(async () => {
    statusCount += 1;
    if (statusCount === 1) {
      return response(200, {
        tripped: true,
        phase: "incomplete",
        actionErrors: [{ action: "queue", target: "private-queue" }],
        targetResults: [
          { action: "queue", target: "private-queue", ok: false },
        ],
      });
    }
    return {
      ok: true,
      status: 200,
      redirected: true,
      url: "https://guard.example/cdn-cgi/access/login",
      headers: { get: () => "text/html; charset=utf-8" },
      json: async () => {
        throw new SyntaxError("Unexpected token '<'");
      },
    };
  });
  await tick();
  assert.equal(h.elements.get("action-errors").children.length, 1);
  assert.equal(h.elements.get("target-results").children.length, 1);

  await h.elements.get("refresh-button").handlers.click();

  assert.match(h.elements.get("session-error").textContent, /session expired/i);
  assert.equal(h.elements.get("workspace").hidden, true);
  assert.equal(h.elements.get("action-errors").children.length, 0);
  assert.equal(h.elements.get("target-results").children.length, 0);
  assert.equal(h.elements.get("status-indicator").textContent, "—");
});

test("status badge follows guard phase and malformed status never appears active", async () => {
  const statuses = [
    { tripped: true, phase: "stopping" },
    { tripped: true, phase: "paused", actionErrors: [] },
    { tripped: true },
  ];
  const h = makeHarness(async () => response(200, statuses.shift()));
  await tick();
  assert.equal(h.elements.get("status-indicator").textContent, "STOPPING");
  await h.elements.get("refresh-button").handlers.click();
  assert.equal(h.elements.get("status-indicator").textContent, "PAUSED");
  await h.elements.get("refresh-button").handlers.click();
  assert.equal(h.elements.get("status-indicator").textContent, "STOP ACTIVE");

  const malformed = makeHarness(async () =>
    response(200, { phase: "monitoring" }),
  );
  await tick();
  assert.match(
    malformed.elements.get("session-error").textContent,
    /invalid status/i,
  );
  assert.equal(malformed.elements.get("status-indicator").textContent, "—");
  assert.equal(malformed.elements.get("status-view").hidden, true);
});

test("logout clears the panel before navigation and ignores an older stop response", async () => {
  let resolveStop;
  const pending = new Promise((resolve) => {
    resolveStop = resolve;
  });
  const h = makeHarness(async (path) =>
    path === "/control/stop" ? pending : response(200, { tripped: false }),
  );
  await tick();
  h.elements.get("pause-button").handlers.click();
  const stopping = h.elements.get("confirm-stop").handlers.click();
  h.elements.get("logout").handlers.click();
  assert.deepEqual(h.navigations, ["/cdn-cgi/access/logout"]);
  assert.equal(h.elements.get("workspace").hidden, true);
  assert.equal(h.elements.get("status-view").hidden, true);
  assert.equal(h.elements.get("target-results").children.length, 0);
  assert.equal(h.elements.get("status-indicator").textContent, "—");
  assert.equal(h.elements.get("confirm-dialog").open, false);

  resolveStop(
    response(200, {
      tripped: true,
      phase: "paused",
      reason: "manual_stop",
      targetResults: [{ action: "queue", target: "private-target", ok: true }],
    }),
  );
  await stopping;
  assert.equal(h.elements.get("workspace").hidden, true);
  assert.equal(h.elements.get("target-results").children.length, 0);
  assert.equal(h.elements.get("status-indicator").textContent, "—");
});
