// Exact ConfiguredModel extract from deployed SECOP bundle audited 2026-10-24.
// Test compatibility fixture only; the runtime patch is applied to the live bundle separately.
var ConfiguredModel = class {
  env;
  heartbeat;
  consumeBudget;
  options;
  id;
  calls = 0;
  started = Date.now();
  constructor(env2, heartbeat, consumeBudget, options = {}) {
    this.env = env2;
    this.heartbeat = heartbeat;
    this.consumeBudget = consumeBudget;
    this.options = options;
    if (!env2.MODEL_NAME) throw new DossierError("MODEL_UNCONFIGURED", 503);
    this.id = env2.MODEL_NAME;
  }
  async generate(input) {
    const budget = Number(this.env.MODEL_MAX_CALLS ?? 64);
    if (!Number.isInteger(budget) || budget < 1 || budget > 1e3) throw new DossierError("MODEL_BUDGET_UNCONFIGURED", 503);
    const prompt = JSON.stringify(input);
    const inputBudget = Number(this.env.MODEL_MAX_INPUT_CHARS ?? 12e4);
    if (!Number.isInteger(inputBudget) || inputBudget < 1e4 || inputBudget > 12e4) throw new DossierError("MODEL_BUDGET_UNCONFIGURED", 503);
    if (prompt.length > inputBudget) throw new DossierError("MODEL_CONTEXT_LIMIT", 413);
    const providerSort = this.env.MODEL_PROVIDER_SORT ?? "price";
    if (!(/* @__PURE__ */ new Set([
      "price",
      "throughput",
      "latency"
    ])).has(providerSort)) throw new DossierError("MODEL_PROVIDER_SORT_INVALID", 503);
    const promptPriceSetting = this.env.MODEL_MAX_PRICE_PROMPT;
    const completionPriceSetting = this.env.MODEL_MAX_PRICE_COMPLETION;
    let maxPrice;
    if (promptPriceSetting !== void 0 || completionPriceSetting !== void 0) {
      const promptPrice = Number(promptPriceSetting);
      const completionPrice = Number(completionPriceSetting);
      if (promptPriceSetting === void 0 || completionPriceSetting === void 0 || !Number.isFinite(promptPrice) || promptPrice <= 0 || !Number.isFinite(completionPrice) || completionPrice <= 0) throw new DossierError("MODEL_MAX_PRICE_INVALID", 503);
      maxPrice = {
        prompt: promptPrice,
        completion: completionPrice
      };
    }
    if (this.env.MODEL_TRANSPORT !== void 0 && this.env.MODEL_TRANSPORT !== "workers_ai") throw new DossierError("MODEL_TRANSPORT_INVALID", 503);
    const useWorkersAI = this.env.MODEL_TRANSPORT === "workers_ai" || Boolean(this.env.AI) && this.id.startsWith("@cf/");
    if (useWorkersAI && !this.env.AI) throw new DossierError("MODEL_UNCONFIGURED", 503);
    const workersAiModel = this.env.MODEL_TRANSPORT === "workers_ai" ? explicitWorkersAIModels.get(this.id) : this.id.startsWith("@cf/") ? this.id : void 0;
    if (useWorkersAI && !workersAiModel) throw new DossierError("MODEL_UNCONFIGURED", 503);
    let provider = "unknown";
    if (useWorkersAI) provider = "Workers AI";
    let url2;
    let openrouter = false;
    let key2;
    if (!useWorkersAI) {
      try {
        url2 = new URL(this.env.MODEL_URL ?? "");
      } catch {
        throw new DossierError("MODEL_UNCONFIGURED", 503);
      }
      openrouter = url2.hostname === "openrouter.ai" && url2.pathname === "/api/v1/chat/completions";
      provider = openrouter ? "OpenRouter" : "unknown";
      key2 = openrouter ? this.env.OPENROUTER_API_KEY ?? this.env.MODEL_KEY : this.env.MODEL_KEY;
      if (url2.protocol !== "https:" || url2.username || url2.password || !key2) throw new DossierError("MODEL_UNCONFIGURED", 503);
    }
    const defaultProvider = provider;
    let result;
    let structuredResult = false;
    const requestStarted = Date.now();
    let contentType = "unknown";
    let finishReason;
    let providerErrorCode;
    let providerErrorType;
    let ignoredProviderSlugs = [];
    const invalidOutput2 = (phase, length) => new DossierError("MODEL_INVALID_OUTPUT", 502, true, {
      provider,
      phase,
      elapsedMs: Math.max(0, Date.now() - requestStarted),
      shape: {
        contentType,
        ...length === void 0 ? {} : { length }
      },
      ...finishReason ? { finishReason } : {},
      ...providerErrorCode === void 0 ? {} : { providerErrorCode },
      ...providerErrorType ? { errorType: providerErrorType } : {}
    });
    const providerError = (code, retryable, length) => new DossierError(code, 502, retryable, {
      provider,
      phase: "provider_error",
      elapsedMs: Math.max(0, Date.now() - requestStarted),
      shape: {
        contentType,
        ...length === void 0 ? {} : { length }
      },
      ...finishReason ? { finishReason } : {},
      ...providerErrorCode === void 0 ? {} : { providerErrorCode },
      ...providerErrorType ? { errorType: providerErrorType } : {}
    });
    for (let attempt = 0; attempt < MAX_PHYSICAL_ATTEMPTS; attempt++) {
      if (Date.now() - this.started > 6e5 || this.calls >= budget) throw new DossierError("MODEL_BUDGET_EXCEEDED", 429);
      provider = defaultProvider;
      contentType = "unknown";
      finishReason = void 0;
      providerErrorCode = void 0;
      providerErrorType = void 0;
      this.calls++;
      await this.heartbeat?.();
      await this.consumeBudget?.();
      let failedProviderSlug;
      try {
        if (useWorkersAI) {
          const aiResult = await this.env.AI.run(workersAiModel, {
            messages: [{
              role: "system",
              content: `${system} Current UTC date: ${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}. Compare source dates against this date, without inventing updates to source status.`
            }, {
              role: "user",
              content: prompt
            }],
            max_tokens: 6e3,
            temperature: 0,
            response_format: input.outputSchema ? {
              type: "json_schema",
              json_schema: input.outputSchema
            } : { type: "json_object" }
          }, { signal: AbortSignal.timeout(this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS) });
          const raw = aiResult?.response;
          if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
            result = raw;
            structuredResult = true;
          } else if (typeof raw === "string") {
            contentType = "workers_ai";
            result = raw;
          } else if (aiResult !== null && typeof aiResult === "object" && Array.isArray(aiResult.choices)) {
            contentType = "workers_ai";
            const choice = aiResult.choices[0];
            finishReason = safeFinishReason(choice?.finish_reason);
            const content = choice?.message?.content;
            const contentLength = typeof content === "string" ? content.length : void 0;
            if (finishReason === "length") throw new DossierError("MODEL_OUTPUT_TRUNCATED", 502, true, {
              provider,
              phase: "output_truncated",
              elapsedMs: Math.max(0, Date.now() - requestStarted),
              shape: {
                contentType,
                ...contentLength === void 0 ? {} : { length: contentLength }
              },
              finishReason
            });
            if (finishReason === "error") throw providerError("MODEL_UNAVAILABLE", true, contentLength);
            if (finishReason === "content_filter") throw providerError("MODEL_PROVIDER_ERROR", false, contentLength);
            if (typeof content === "string") result = content;
            else if (content !== null && typeof content === "object" && !Array.isArray(content)) {
              result = content;
              structuredResult = true;
            } else throw invalidOutput2("workers_ai_shape");
          } else {
            contentType = "workers_ai";
            throw invalidOutput2("workers_ai_shape");
          }
        } else {
          const response = await fetch(url2, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key2}`,
              "Content-Type": "application/json"
            },
            redirect: "manual",
            signal: AbortSignal.timeout(this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS),
            body: JSON.stringify({
              model: this.id,
              messages: [{
                role: "system",
                content: `${system} Current UTC date: ${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}. Compare source dates against this date, without inventing updates to source status.`
              }, {
                role: "user",
                content: prompt
              }],
              temperature: 0,
              max_tokens: 6e3,
              response_format: openrouter && input.outputSchema ? {
                type: "json_schema",
                json_schema: {
                  name: "secop_response",
                  schema: input.outputSchema,
                  strict: true
                }
              } : { type: "json_object" },
              ...openrouter ? {
                provider: {
                  sort: providerSort,
                  data_collection: "deny",
                  require_parameters: true,
                  ...openrouter && maxPrice ? { max_price: maxPrice } : {},
                  ...ignoredProviderSlugs.length ? { ignore: ignoredProviderSlugs } : {}
                },
                reasoning: { effort: "low" }
              } : {}
            })
          });
          if (!response.ok) {
            let diagnostic;
            if (openrouter) diagnostic = await openRouterHttpErrorDiagnostic(response, Date.now() - requestStarted);
            else try {
              await response.body?.cancel();
            } catch {
            }
            throw new DossierError(`MODEL_PROVIDER_HTTP_${response.status}`, 502, response.status === 429 || response.status >= 500, diagnostic);
          }
          let body;
          try {
            body = new TextDecoder().decode(await boundedBytes(response, 2e6));
          } catch (error2) {
            if (error2 instanceof DossierError) throw error2;
            throw modelUnavailable();
          }
          contentType = safeContentType(response.headers.get("content-type"));
          let payload;
          try {
            payload = JSON.parse(body);
          } catch {
            throw invalidOutput2("provider_envelope_json", body.length);
          }
          if (typeof payload?.provider === "string") provider = safeProviderLabel(payload.provider) ?? "unknown";
          finishReason = safeFinishReason(payload?.choices?.[0]?.finish_reason);
          const choiceError = payload?.choices?.[0]?.error;
          const rootError = payload?.error;
          const embeddedError = rootError ?? choiceError;
          providerErrorCode = numericProviderErrorCode(rootError?.code) ?? numericProviderErrorCode(choiceError?.code);
          providerErrorType = safeProviderErrorType(rootError?.metadata?.error_type ?? rootError?.error_type) ?? safeProviderErrorType(choiceError?.metadata?.error_type ?? choiceError?.error_type);
          const errorProviderName = rootError?.metadata?.provider_name ?? choiceError?.metadata?.provider_name;
          if (typeof errorProviderName === "string") {
            const errorProvider = safeProviderLabel(errorProviderName);
            if (errorProvider) provider = errorProvider;
          }
          failedProviderSlug = safeProviderSlug(payload?.provider) ?? safeProviderSlug(rootError?.metadata?.provider_name) ?? safeProviderSlug(choiceError?.metadata?.provider_name);
          if (embeddedError != null || finishReason === "error" || finishReason === "content_filter") {
            const hasTransientStatus = providerErrorCode === 408 || providerErrorCode === 429 || providerErrorCode !== void 0 && providerErrorCode >= 500 && providerErrorCode <= 599;
            const retryableType = providerErrorType !== void 0 && retryableProviderErrorTypes.has(providerErrorType);
            const nonRetryableType = providerErrorType !== void 0 && nonRetryableProviderErrorTypes.has(providerErrorType);
            const lengthType = providerErrorType !== void 0 && outputLengthErrorTypes.has(providerErrorType);
            const partialContent = payload?.choices?.[0]?.message?.content;
            const partialLength = typeof partialContent === "string" ? partialContent.length : void 0;
            if (nonRetryableType || finishReason === "content_filter" || providerErrorCode === 401 || providerErrorCode === 402 || providerErrorCode === 403) throw providerError("MODEL_PROVIDER_ERROR", false, partialLength);
            if (lengthType) throw providerError("MODEL_OUTPUT_TRUNCATED", true, partialLength);
            if (providerErrorCode !== void 0 && providerErrorCode >= 400 && providerErrorCode <= 499 && providerErrorCode !== 408 && providerErrorCode !== 429) throw providerError("MODEL_PROVIDER_ERROR", false, partialLength);
            if (hasTransientStatus || retryableType) throw providerError(providerErrorCode === 429 || providerErrorType === "rate_limit_exceeded" ? "MODEL_PROVIDER_HTTP_429" : providerErrorCode === 408 ? "MODEL_UNAVAILABLE" : providerErrorCode !== void 0 && providerErrorCode >= 500 && providerErrorCode <= 599 ? `MODEL_PROVIDER_HTTP_${providerErrorCode}` : "MODEL_PROVIDER_HTTP_503", true, partialLength);
            throw providerError("MODEL_UNAVAILABLE", true, partialLength);
          }
          if (finishReason === "length") throw new DossierError("MODEL_OUTPUT_TRUNCATED", 502, true);
          result = payload?.choices?.[0]?.message?.content;
          if (typeof result !== "string") throw invalidOutput2("missing_content");
        }
      } catch (error2) {
        const failure2 = providerFailure(error2);
        if (!isTransientProviderFailure(failure2) || attempt + 1 >= MAX_PHYSICAL_ATTEMPTS) throw failure2;
        if (failedProviderSlug && !ignoredProviderSlugs.includes(failedProviderSlug)) ignoredProviderSlugs = [...ignoredProviderSlugs, failedProviderSlug];
        const delay = Math.min((this.options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS) * 2 ** attempt, 1e3);
        await (this.options.sleep ?? ((milliseconds) => new Promise((resolve3) => setTimeout(resolve3, milliseconds))))(delay);
        continue;
      }
      await this.heartbeat?.();
      break;
    }
    if (structuredResult) return result;
    if (typeof result !== "string") throw invalidOutput2("missing_content");
    try {
      return JSON.parse(result.trim().replace(/^```json\s*/, "").replace(/\s*```$/, ""));
    } catch {
      throw invalidOutput2("content_json", result.length);
    }
  }
};
