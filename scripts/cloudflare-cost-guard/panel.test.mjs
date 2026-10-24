import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { renderControlPanel } from "./panel.mjs";

function makeHarness(fetcher) {
  const elements = new Map();
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
    "login-form",
    "admin-key",
    "login-error",
    "login-button",
    "workspace",
    "disconnect",
    "pause-button",
    "confirm-dialog",
    "cancel-stop",
    "confirm-stop",
    "action-message",
    "status-indicator",
    "stop-reason",
    "manual-stop-at",
    "checked-at",
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
  return { elements, event };
}

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test("panel output is static, nonce-safe, and contains no browser persistence or remote assets", async () => {
  const html = renderControlPanel({ nonce: `x" onload="alert(1)&` });
  assert.match(html, /nonce="x&quot; onload=&quot;alert\(1\)&amp;"/);
  assert.match(html, /<form id="login-form"/);
  assert.match(html, /type="password"/);
  assert.match(html, /Pause all environments/);
  assert.match(html, /Confirm pause/);
  assert.match(html, /Backup coordinators/);
  assert.match(html, /Daily cleanup/);
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
    /\b(?:localStorage|sessionStorage|indexedDB|caches\.)/i,
  );
});

test("login keeps key in memory, loads status, and confirmation gates POST /stop", async () => {
  const calls = [];
  const h = makeHarness(async (path, options) => {
    calls.push({ path, options });
    return response(200, {
      tripped: false,
      reason: "within_limit",
      checkedAt: "2026-10-24T12:00:00Z",
    });
  });
  h.elements.get("admin-key").value = "existing-admin-key";
  await h.elements.get("login-form").handlers.submit(h.event());

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/status");
  assert.equal(
    calls[0].options.headers.Authorization,
    "Bearer existing-admin-key",
  );
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.signal.milliseconds, 90000);
  assert.equal(h.elements.get("admin-key").value, "");
  assert.equal(h.elements.get("workspace").hidden, false);
  assert.equal(h.elements.get("status-indicator").textContent, "ACTIVE");
  assert.equal(
    h.elements.get("pause-button").handlers.click !== undefined,
    true,
  );

  h.elements.get("pause-button").handlers.click();
  assert.equal(h.elements.get("confirm-dialog").open, true);
  assert.equal(
    calls.length,
    1,
    "opening confirmation does not send a stop request",
  );
  h.elements.get("confirm-stop").handlers.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].path, "/stop");
  assert.equal(calls[1].options.method, "POST");
  assert.equal(
    calls[1].options.headers.Authorization,
    "Bearer existing-admin-key",
  );
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    confirm: "PAUSE_ALL_ENVIRONMENTS",
  });
  h.elements.get("disconnect").handlers.click();
  assert.equal(h.elements.get("workspace").hidden, true);
  assert.equal(h.elements.get("status-indicator").textContent, "—");
  assert.equal(h.elements.get("target-results").children.length, 0);
  assert.equal(h.elements.get("login-form").hidden, false);
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
  h.elements.get("admin-key").value = "session-secret";
  await h.elements.get("login-form").handlers.submit(h.event());
  h.elements.get("pause-button").handlers.click();
  h.elements.get("confirm-stop").handlers.click();
  await new Promise((resolve) => setImmediate(resolve));

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

test("failed status authentication and failed stop requests explain recovery", async () => {
  let statusDenied = true;
  const h = makeHarness(async (path) => {
    if (path === "/status" && statusDenied) {
      statusDenied = false;
      return response(401, { error: "unauthorized" });
    }
    if (path === "/status") return response(200, { tripped: false });
    return response(503, { error: "stop_unavailable" });
  });
  h.elements.get("admin-key").value = "bad-key";
  await h.elements.get("login-form").handlers.submit(h.event());
  assert.match(h.elements.get("login-error").textContent, /not accepted/);
  assert.equal(h.elements.get("admin-key").value, "bad-key");
  assert.equal(h.elements.get("workspace").hidden, true);

  h.elements.get("admin-key").value = "good-key";
  await h.elements.get("login-form").handlers.submit(h.event());
  h.elements.get("pause-button").handlers.click();
  await h.elements.get("confirm-stop").handlers.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(
    h.elements.get("action-message").textContent,
    /Unable to confirm pause completion/,
  );
  assert.match(
    h.elements.get("action-message").textContent,
    /pause may already be saved/,
  );
  assert.match(
    h.elements.get("action-message").textContent,
    /Refresh status to check/,
  );
  assert.match(
    h.elements.get("action-message").textContent,
    /stop_unavailable/,
  );
  assert.equal(h.elements.get("confirm-dialog").open, true);
});

test("status badge follows guard phase and malformed status never appears active", async () => {
  const statuses = [
    { tripped: true, phase: "stopping" },
    { tripped: true, phase: "paused", actionErrors: [] },
    { tripped: true },
  ];
  const h = makeHarness(async () => response(200, statuses.shift()));
  h.elements.get("admin-key").value = "session-key";
  await h.elements.get("login-form").handlers.submit(h.event());
  assert.equal(h.elements.get("status-indicator").textContent, "STOPPING");
  await h.elements.get("refresh-button").handlers.click();
  assert.equal(h.elements.get("status-indicator").textContent, "PAUSED");
  await h.elements.get("refresh-button").handlers.click();
  assert.equal(h.elements.get("status-indicator").textContent, "STOP ACTIVE");

  const malformed = makeHarness(async () =>
    response(200, { phase: "monitoring" }),
  );
  malformed.elements.get("admin-key").value = "session-key";
  await malformed.elements.get("login-form").handlers.submit(h.event());
  assert.match(
    malformed.elements.get("login-error").textContent,
    /invalid status/,
  );
  assert.equal(malformed.elements.get("status-indicator").textContent, "—");
  assert.equal(malformed.elements.get("status-view").hidden, true);
});

test("disconnect ignores an older in-flight stop response", async () => {
  let resolveStop;
  const pending = new Promise((resolve) => {
    resolveStop = resolve;
  });
  const h = makeHarness(async (path) =>
    path === "/stop" ? pending : response(200, { tripped: false }),
  );
  h.elements.get("admin-key").value = "session-key";
  await h.elements.get("login-form").handlers.submit(h.event());
  h.elements.get("pause-button").handlers.click();
  const stopping = h.elements.get("confirm-stop").handlers.click();
  h.elements.get("disconnect").handlers.click();
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
  assert.equal(h.elements.get("status-view").hidden, true);
  assert.equal(h.elements.get("target-results").children.length, 0);
  assert.equal(h.elements.get("status-indicator").textContent, "—");
  assert.equal(h.elements.get("admin-key").value, "");
  assert.equal(h.elements.get("confirm-dialog").open, false);
});
