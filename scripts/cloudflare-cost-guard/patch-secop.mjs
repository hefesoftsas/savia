import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import assert from "node:assert/strict";
import { patchSecopGateway } from "./secop-gateway-patch.mjs";

process.umask(0o077);
const here = dirname(fileURLToPath(import.meta.url));
const recovery = resolve(here, "../../infra/secrets/cloudflare-cost-guard");
await mkdir(recovery, { recursive: true, mode: 0o700 });
const run = join(
  recovery,
  "secop-" + new Date().toISOString().replaceAll(":", "-"),
);
await mkdir(run, { mode: 0o700 });
const auth = await readFile(
  join(homedir(), "Library/Preferences/.wrangler/config/default.toml"),
  "utf8",
);
const token =
  process.env.CLOUDFLARE_API_TOKEN ??
  auth.match(/^oauth_token\s*=\s*"([^\"]+)"/m)?.[1];
assert(token, "Cloudflare deployment authentication required");
const base =
  "https://api.cloudflare.com/client/v4/accounts/08a0d36f8b0357684f83e4bfeb6628b6/workers/scripts/secop-live-worker";
async function request(suffix, init = {}) {
  const r = await fetch(base + suffix, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`Cloudflare operation failed (${r.status})`);
  return r;
}
async function settings() {
  const d = await (await request("/settings")).json();
  assert(d.success);
  return d.result;
}
async function modules() {
  const response = await request("");
  if (!response.headers.get("content-type")?.includes("multipart/"))
    throw new Error(
      "Expected a module Worker; refusing to replace an unknown source layout",
    );
  const form = await response.formData();
  return Promise.all(
    [...form.entries()]
      .filter(([name]) => name !== "metadata")
      .map(async ([name, value]) => ({
        name,
        text: typeof value === "string" ? value : await value.text(),
        type: value.type ?? "application/javascript+module",
      })),
  );
}
const before = await settings();
const original = await modules();
assert.equal(
  original.length,
  1,
  "Expected the verified single-module SECOP build",
);
const changed = patchSecopGateway(original[0].text);
await writeFile(
  join(run, "settings-before.private.json"),
  JSON.stringify(before, null, 2),
);
await writeFile(
  join(run, "modules-before.private.json"),
  JSON.stringify(original),
);
await writeFile(join(run, "module-patched.private.mjs"), changed);
const overrides = {
  AI_GATEWAY_ID: "default",
  CF_ACCOUNT_ID: "08a0d36f8b0357684f83e4bfeb6628b6",
  MODEL_SPEND_PAUSED: "true",
  AI_PROVIDER_LABEL: "OpenRouter through Cloudflare AI Gateway",
};
const vars = Object.fromEntries(
  before.bindings
    .filter((b) => b.type === "plain_text")
    .map((b) => [b.name, b.text]),
);
assert.equal(vars.MODEL_NAME, "openai/gpt-oss-120b");
assert.equal(vars.MODEL_URL, "https://openrouter.ai/api/v1/chat/completions");
assert.equal(
  vars.MODEL_TRANSPORT,
  undefined,
  "Workers AI transport must remain disabled",
);
assert.equal(vars.MODEL_MAX_PRICE_PROMPT, "0.15");
assert.equal(vars.MODEL_MAX_PRICE_COMPLETION, "0.75");
// Native AI bindings must be removed, including the prior gateway binding.
const bindings = before.bindings.filter(
  (b) =>
    b.type !== "secret_text" &&
    b.type !== "ai" &&
    !Object.hasOwn(overrides, b.name),
);
for (const [name, text] of Object.entries(overrides))
  bindings.push({ name, type: "plain_text", text });
const metadata = {
  main_module: original[0].name,
  bindings,
  keep_bindings: ["secret_text"],
  annotations: {
    "workers/message": "Route SECOP analysis through budget-limited AI Gateway",
  },
};
for (const key of [
  "compatibility_date",
  "compatibility_flags",
  "usage_model",
  "tags",
  "tail_consumers",
  "logpush",
  "observability",
  "limits",
])
  if (before[key] !== undefined) metadata[key] = before[key];
console.log(
  "Prepared SECOP gateway routing with model spend paused. Recovery:",
  run,
);
if (!process.argv.includes("--apply")) process.exit(0);
const form = new FormData();
form.set("metadata", JSON.stringify(metadata));
form.set(
  original[0].name,
  new File([changed], original[0].name, {
    type: original[0].type || "application/javascript+module",
  }),
);
const result = await (await request("", { method: "PUT", body: form })).json();
assert(result.success, "SECOP upload unsuccessful");
const after = await settings();
const deployed = await modules();
assert.equal(deployed[0].text, changed);
const normalize = (list) =>
  list
    .filter((b) => b.type !== "ai" && !Object.hasOwn(overrides, b.name))
    .sort((a, b) => a.name.localeCompare(b.name));
assert.deepEqual(normalize(after.bindings), normalize(before.bindings));
for (const [name, text] of Object.entries(overrides))
  assert(after.bindings.some((b) => b.name === name && b.text === text));
await writeFile(
  join(run, "settings-after.private.json"),
  JSON.stringify(after, null, 2),
);
assert(!after.bindings.some((b) => b.type === "ai"));
const health = await fetch(
  "https://secop-live-worker.jose-douglas-dev.workers.dev/health",
);
assert(health.ok);
console.log(
  "SECOP routing deployed and verified; source/bindings preserved, price limits retained, analysis stays paused.",
);
