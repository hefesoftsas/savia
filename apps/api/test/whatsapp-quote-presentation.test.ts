import { expect, it, vi } from "vitest";
import { generateText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  completeWithOpenRouter,
  createWhatsappQuotePresentationFactory,
  type QuoteCompletionInput,
} from "../src/whatsapp/quote-presentation";
import type { ChannelAction } from "../src/whatsapp/channel-contracts";
import type { WhatsappAssistantBinding } from "../src/whatsapp/inbound-contracts";
import type { WhatsappChannelRepository } from "../src/whatsapp/channel-repository";
import type { VirtualEmployeesRepository } from "../src/assistant/virtual-employees";
import type { AssistantConfigurationRepository } from "../src/assistant/configuration";

vi.mock("ai", async () => ({
  ...(await vi.importActual<typeof import("ai")>("ai")),
  generateText: vi.fn(),
}));
vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: vi.fn(),
}));

const access = {
  tenantId: 7,
  connectionId: "connection-1",
  contact: "15551234567",
  audience: "external" as const,
  generation: "generation-1",
  principalId: null,
  profileId: "external",
  capabilities: ["insurance", "insurance:quote-auto"],
};
const action = {
  id: "action-quote-1",
  session: { access, employeeId: "employee-1", selectionRevision: 3 },
  revision: 1,
  domain: "insurance",
  command: "quote-auto",
  input: {},
} as ChannelAction;
const binding = {
  connectionId: "connection-1",
  tenantId: 7,
  employeeId: "default-employee",
  enabled: true,
  allowedContacts: [access.contact],
  updatedBy: "owner-1",
  ownerPrincipalId: "owner-1",
  connection: {
    phoneNumberId: "phone-number-1",
    wabaId: "waba-1",
  },
} as unknown as WhatsappAssistantBinding;

function presentationFactory(options: {
  current?: boolean;
  allowedCollections?: string[];
  apiKey?: string;
  model?: string;
  allowedModels?: string[];
  publicOrigin?: string;
  complete?: (input: QuoteCompletionInput) => Promise<string>;
  publish?: (
    report: unknown,
  ) => Promise<{ id: string; url: string; expiresAt: string }>;
  enqueue?: (eventKey: string, text: string) => Promise<void>;
}) {
  const employee = {
    id: "employee-1",
    agencyId: 7,
    status: "active" as const,
    model: options.model ?? null,
    allowedCollections: options.allowedCollections ?? [
      "cotizaciones",
      "cotizaciones_detalle",
    ],
  };
  const repository = {
    db: {},
    getSession: vi.fn(async () =>
      options.current === false ? null : action.session,
    ),
    listTasks: vi.fn(async () => [{ employeeId: "employee-1" }]),
  } as unknown as WhatsappChannelRepository;
  const employees = {
    getById: vi.fn(async () => employee),
  } as unknown as VirtualEmployeesRepository;
  const configuration = {
    effectiveConfigurationForTenant: vi.fn(async () => ({
      apiKey: Object.prototype.hasOwnProperty.call(options, "apiKey")
        ? options.apiKey
        : "test-api-key",
      tenantId: 7,
      model: "provider/model-main",
      summaryModel: options.model,
      allowedModels: options.allowedModels ?? ["provider/model-main"],
    })),
  } as unknown as AssistantConfigurationRepository;
  const enqueue = vi.fn(options.enqueue ?? (async () => {}));
  const publish = vi.fn(
    options.publish ??
      (async () => ({
        id: "link-1",
        url: "https://savia.test/public/quotes/token",
        expiresAt: "2026-10-14T00:00:00.000Z",
      })),
  );
  const complete = vi.fn(
    options.complete ??
      (async () =>
        JSON.stringify({
          proposals: [
            {
              id: "product-1",
              explanation: "La propuesta incluye el hecho verificado.",
            },
          ],
          suggestion: "Compara también las condiciones no disponibles.",
          limitations: [],
        })),
  );
  const factory = createWhatsappQuotePresentationFactory({
    repository,
    configuration,
    employees,
    resolveBinding: async () => binding,
    publicOrigin: Object.prototype.hasOwnProperty.call(options, "publicOrigin")
      ? options.publicOrigin
      : "https://savia.test",
    complete,
    publish: (async (_db, input) => publish(input.report)) as never,
    enqueueProgress: (async (_repository, _action, eventKey, text) => {
      await enqueue(eventKey, text);
    }) as never,
  });
  return {
    presentation: factory(binding, action),
    repository,
    employees,
    configuration,
    complete,
    publish,
    enqueue,
  };
}

const proposals = [
  {
    id: "product-1",
    provider: "Carrier",
    product: "Carrier · Product",
    state: "priced" as const,
    premium: 123456,
    currency: "COP" as const,
    facts: [
      {
        label: "RCE",
        value: "Verified provider value",
        source: "provider" as const,
      },
    ],
  },
];

it("disables OpenRouter reasoning and returns bounded finish metadata", async () => {
  const model = vi.fn((modelId: string) => modelId);
  vi.mocked(createOpenRouter).mockReturnValue(model as never);
  vi.mocked(generateText).mockResolvedValue({
    text: "{}",
    finishReason: "length",
    usage: { inputTokens: 800, outputTokens: 980 },
  } as never);
  const signal = new AbortController().signal;

  const result = await completeWithOpenRouter({
    apiKey: "private-key",
    model: "provider/model",
    system: "system prompt",
    prompt: "private prompt",
    maxOutputTokens: 980,
    signal,
  });

  expect(generateText).toHaveBeenCalledWith(
    expect.objectContaining({
      providerOptions: {
        openrouter: {
          reasoning: { effort: "none", exclude: true },
        },
      },
      maxRetries: 0,
      abortSignal: signal,
    }),
  );
  expect(result).toEqual({
    text: "{}",
    finishReason: "length",
    inputTokens: 800,
    outputTokens: 980,
  });
});

it("uses authorized tenant model analysis, emits a checked explanation, then publishes the final report", async () => {
  let completionInput: QuoteCompletionInput | undefined;
  const { presentation, complete, publish, enqueue } = presentationFactory({
    complete: async (input) => {
      completionInput = input;
      return JSON.stringify({
        proposals: [
          {
            id: "product-1",
            explanation: "La oferta informa el valor verificado.",
          },
        ],
        suggestion: "Compara las condiciones verificadas.",
        preferredProposalId: "product-1",
        limitations: [],
      });
    },
  });

  presentation.record(proposals[0]);
  const result = await presentation.finish({
    quoteId: "quote-1",
    reference: expect.stringMatching(/^COT-\d{8}-[A-F0-9]{8}$/),
    proposals,
    pricedOffers: 1,
  });

  expect(complete).toHaveBeenCalledTimes(1);
  expect(completionInput?.model).toBe("provider/model-main");
  expect(completionInput?.maxOutputTokens).toBe(620);
  expect(completionInput?.signal).toBeInstanceOf(AbortSignal);
  expect(completionInput?.system).toContain("No inventes");
  expect(completionInput?.prompt).toContain("Verified provider value");
  expect(enqueue).toHaveBeenCalledWith(
    "explanation:product-1",
    expect.stringContaining("La oferta informa el valor verificado."),
  );
  expect(publish).toHaveBeenCalledWith(
    expect.objectContaining({
      reference: expect.stringMatching(/^COT-\d{8}-[A-F0-9]{8}$/),
      proposals,
      analysis: expect.objectContaining({ preferredProposalId: "product-1" }),
    }),
  );
  expect(result).toMatchObject({
    publicUrl: "https://savia.test/public/quotes/token",
    publicLinkId: "link-1",
    recommendation: "Compara las condiciones verificadas.",
  });
});

it("does not call the model or publish after channel generation access is revoked", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const { presentation, complete, publish } = presentationFactory({
    current: false,
  });
  const result = await presentation.finish({ quoteId: "quote-1", proposals });

  expect(complete).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    quoteId: "quote-1",
    proposals,
    analysisUnavailable: true,
    analysisUnavailableReason: "authorization_unavailable",
  });
  expect(log).toHaveBeenCalledWith(
    expect.stringContaining('"error_code":"authorization_unavailable"'),
  );
  log.mockRestore();
});

it("logs a safe configuration skip reason without exposing model credentials", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    const { presentation, complete } = presentationFactory({ apiKey: "" });
    presentation.record(proposals[0]);
    const result = await presentation.finish({ quoteId: "quote-1", proposals });

    const entries = log.mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(entries).toContainEqual(
      expect.objectContaining({
        event: "whatsapp_quote_analysis",
        outcome: "skipped",
        error_code: "configuration_unavailable",
      }),
    );
    expect(complete).not.toHaveBeenCalled();
    expect(result.analysisUnavailableReason).toBe("configuration_unavailable");
    expect(JSON.stringify(entries)).not.toContain("test-api-key");
    expect(JSON.stringify(entries)).not.toContain(access.contact);
  } finally {
    log.mockRestore();
  }
});

it("persists a safe invalid-output reason without logging model text", async () => {
  const privateOutput = "invalid response containing private@example.test";
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    const { presentation } = presentationFactory({
      complete: async () => privateOutput,
    });
    const result = await presentation.finish({ quoteId: "quote-1", proposals });
    const entries = log.mock.calls.map(([line]) => JSON.parse(String(line)));

    expect(result.analysisUnavailableReason).toBe("invalid_json");
    expect(entries).toContainEqual(
      expect.objectContaining({
        event: "whatsapp_quote_analysis",
        stage: "final",
        outcome: "invalid_json",
        error_code: "invalid_json",
      }),
    );
    expect(JSON.stringify(entries)).not.toContain(privateOutput);
  } finally {
    log.mockRestore();
  }
});

it("persists only static validation fields and codes for malformed analysis", async () => {
  const privateValue = "private@example.test";
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    const { presentation } = presentationFactory({
      complete: async () =>
        JSON.stringify({
          proposals: [{ id: "product-1", explanation: 42 }],
          suggestion: "Compare verified evidence.",
          limitations: [],
          [privateValue]: privateValue,
        }),
    });
    const result = await presentation.finish({ quoteId: "quote-1", proposals });
    expect(result.analysisUnavailableReason).toBe("invalid_schema");
    expect(result.analysisValidationIssues).toContainEqual({
      field: "proposals/[index]/explanation",
      code: "invalid_type",
    });
    const entries = log.mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(entries).toContainEqual(
      expect.objectContaining({
        event: "whatsapp_quote_analysis_validation",
        validation_field: "proposals/[index]/explanation",
        validation_code: "invalid_type",
      }),
    );
    expect(JSON.stringify(entries)).not.toContain(privateValue);
    expect(JSON.stringify(result)).not.toContain(privateValue);
  } finally {
    log.mockRestore();
  }
});

it("persists the final deadline reason when the workflow and analyzer deadlines race", async () => {
  vi.useFakeTimers();
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    const { presentation } = presentationFactory({
      complete: (input) =>
        new Promise((_resolve, reject) => {
          input.signal.addEventListener(
            "abort",
            () => reject(new Error("request aborted")),
            { once: true },
          );
        }),
    });
    const finish = presentation.finish({ quoteId: "quote-1", proposals });
    await vi.advanceTimersByTimeAsync(20_001);
    const result = await finish;
    const entries = log.mock.calls.map(([line]) => JSON.parse(String(line)));

    expect(result.analysisUnavailableReason).toBe("timeout");
    expect(entries).toContainEqual(
      expect.objectContaining({
        event: "whatsapp_quote_analysis",
        stage: "final",
        error_code: "timeout",
      }),
    );
  } finally {
    vi.useRealTimers();
    log.mockRestore();
  }
});

it("stops all quote presentation when the employee loses quote collection access", async () => {
  const { presentation, complete, publish } = presentationFactory({
    allowedCollections: ["cotizaciones"],
  });
  const result = await presentation.finish({ quoteId: "quote-1", proposals });

  expect(complete).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    quoteId: "quote-1",
    proposals,
    analysisUnavailable: true,
    analysisUnavailableReason: "authorization_unavailable",
  });
});

it("falls back without a model when the summary model is outside the allowed list or public origin is absent", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    const { presentation, complete, publish } = presentationFactory({
      model: "provider/model-not-allowed",
      allowedModels: ["provider/model-main"],
      publicOrigin: undefined,
    });
    const result = await presentation.finish({
      quoteId: "quote-1",
      proposals,
      recommendation: "Existing quote response",
    });

    expect(complete).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("publicUrl");
    expect(result.persistenceWarnings).toEqual([
      "No se pudo crear el enlace público de esta cotización.",
    ]);
    expect(result.analysisUnavailableReason).toBe("model_not_allowed");
    const entries = log.mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(entries).toContainEqual(
      expect.objectContaining({
        event: "whatsapp_quote_analysis",
        outcome: "skipped",
        error_code: "model_not_allowed",
      }),
    );
  } finally {
    log.mockRestore();
  }
});

it("publishes a customer reference independent of the internal action identifier", async () => {
  const hooks = presentationFactory({});
  const result = await hooks.presentation.finish({
    quoteId: "saved-quote",
    proposals: [
      {
        id: "product-1",
        provider: "Insurer",
        product: "Plan",
        state: "priced",
        premium: 1500000,
        currency: "COP",
      },
    ],
  });
  expect(result.publicReference).toMatch(/^COT-\d{8}-[A-F0-9]{8}$/);
  expect(result.publicReference).not.toContain(action.id);
});
