const SPEND_PAUSE = `    if (this.env.MODEL_SPEND_PAUSED === "true") throw new DossierError("MODEL_SPEND_PAUSED", 503, false);\n`;
const GATEWAY_MARKER = "const requestInit = {";

function replaceUnique(source, anchor, replacement, label) {
  const first = source.indexOf(anchor);
  if (first === -1 || source.indexOf(anchor, first + anchor.length) !== -1) {
    throw new Error(
      `SECOP gateway patch anchor ${label} is missing or ambiguous`,
    );
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + anchor.length)}`;
}

function patchNativeGateway(source) {
  if (typeof source !== "string" || source.length === 0) {
    throw new TypeError("SECOP source must be a non-empty string");
  }

  if (source.includes(GATEWAY_MARKER)) {
    if (
      source.includes(SPEND_PAUSE.trim()) &&
      source.includes('"MODEL_GATEWAY_UNAVAILABLE"') &&
      source.includes('"MODEL_GATEWAY_LIMIT_REACHED"') &&
      source.includes(
        '.run({ provider: "openrouter", endpoint: "chat/completions"',
      )
    )
      return source;
    throw new Error(
      "SECOP gateway patch is partially applied; refusing to guess",
    );
  }

  let patched = source;
  patched = replaceUnique(
    patched,
    "  async generate(input) {\n",
    `  async generate(input) {\n${SPEND_PAUSE}`,
    "model spend pause",
  );
  patched = replaceUnique(
    patched,
    '    if (useWorkersAI && !workersAiModel) throw new DossierError("MODEL_UNCONFIGURED", 503);\n',
    '    if (useWorkersAI && !workersAiModel) throw new DossierError("MODEL_UNCONFIGURED", 503);\n    if (this.env.AI_GATEWAY_ID && useWorkersAI) throw new DossierError("MODEL_GATEWAY_PROVIDER_UNSUPPORTED", 503, false);\n',
    "Workers AI gateway guard",
  );
  patched = replaceUnique(
    patched,
    '      if (url2.protocol !== "https:" || url2.username || url2.password || !key2) throw new DossierError("MODEL_UNCONFIGURED", 503);\n',
    '      if (url2.protocol !== "https:" || url2.username || url2.password || !key2) throw new DossierError("MODEL_UNCONFIGURED", 503);\n      if (this.env.AI_GATEWAY_ID && (!openrouter || typeof this.env.AI?.gateway !== "function")) throw new DossierError("MODEL_GATEWAY_UNAVAILABLE", 503, false);\n',
    "OpenRouter gateway availability guard",
  );
  patched = replaceUnique(
    patched,
    "          const response = await fetch(url2, {\n",
    "          const requestInit = {\n",
    "OpenRouter request start",
  );
  patched = replaceUnique(
    patched,
    "\n          });\n          if (!response.ok) {\n",
    '\n          };\n          const response = this.env.AI_GATEWAY_ID\n            ? await this.env.AI.gateway(this.env.AI_GATEWAY_ID).run({ provider: "openrouter", endpoint: "chat/completions", headers: { Authorization: "Bearer " + key2 }, query: JSON.parse(requestInit.body) }, { signal: requestInit.signal, gateway: { collectLog: false } })\n            : await fetch(url2, requestInit);\n          if (this.env.AI_GATEWAY_ID && response.status === 429) {\n            try {\n              await response.body?.cancel();\n            } catch {\n            }\n            throw new DossierError("MODEL_GATEWAY_LIMIT_REACHED", 429, false);\n          }\n          if (!response.ok) {\n',
    "OpenRouter request dispatch",
  );

  return patched;
}

// Upgrade both the original verified bundle and the previously deployed native
// gateway patch. HTTP transport must never need a Workers AI binding.
export function patchSecopGateway(source) {
  if (source.includes("var openRouterGatewayUrl =")) {
    if (
      source.includes('"cf-aig-authorization"') &&
      source.includes("MODEL_CLOUDFLARE_AI_FORBIDDEN")
    )
      return source;
    throw new Error("Incomplete HTTP gateway migration");
  }
  let patched = patchNativeGateway(source);
  patched = replaceUnique(
    patched,
    '    if (this.env.AI_GATEWAY_ID && useWorkersAI) throw new DossierError("MODEL_GATEWAY_PROVIDER_UNSUPPORTED", 503, false);',
    '    if (useWorkersAI) throw new DossierError("MODEL_CLOUDFLARE_AI_FORBIDDEN", 503, false);',
    "prohibit Cloudflare inference",
  );
  patched = replaceUnique(
    patched,
    '      if (this.env.AI_GATEWAY_ID && (!openrouter || typeof this.env.AI?.gateway !== "function")) throw new DossierError("MODEL_GATEWAY_UNAVAILABLE", 503, false);',
    '      if (!openrouter || !this.env.AI_GATEWAY_ID || !this.env.CF_ACCOUNT_ID || !this.env.CF_AIG_TOKEN) throw new DossierError("MODEL_GATEWAY_UNAVAILABLE", 503, false);\n      var openRouterGatewayUrl = "https://gateway.ai.cloudflare.com/v1/" + encodeURIComponent(this.env.CF_ACCOUNT_ID) + "/" + encodeURIComponent(this.env.AI_GATEWAY_ID) + "/openrouter/chat/completions";',
    "HTTP gateway prerequisites",
  );
  patched = replaceUnique(
    patched,
    '          const response = this.env.AI_GATEWAY_ID\n            ? await this.env.AI.gateway(this.env.AI_GATEWAY_ID).run({ provider: "openrouter", endpoint: "chat/completions", headers: { Authorization: "Bearer " + key2 }, query: JSON.parse(requestInit.body) }, { signal: requestInit.signal, gateway: { collectLog: false } })\n            : await fetch(url2, requestInit);',
    '          const response = await fetch(openRouterGatewayUrl, { ...requestInit, headers: { ...requestInit.headers, "cf-aig-authorization": "Bearer " + this.env.CF_AIG_TOKEN, "cf-aig-collect-log": "false" } });',
    "HTTP gateway dispatch",
  );
  return patched;
}
