import { expect, it, vi } from "vitest";
import {
  createWhatsappQuotePresentationFactory,
  type QuoteCompletionInput,
} from "../src/whatsapp/quote-presentation";
import type { ChannelAction } from "../src/whatsapp/channel-contracts";
import type { WhatsappAssistantBinding } from "../src/whatsapp/inbound-contracts";
import type { WhatsappChannelRepository } from "../src/whatsapp/channel-repository";
import type { VirtualEmployeesRepository } from "../src/assistant/virtual-employees";
import type { AssistantConfigurationRepository } from "../src/assistant/configuration";

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
      apiKey: "test-api-key",
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
  const { presentation, complete, publish } = presentationFactory({
    current: false,
  });
  const result = await presentation.finish({ quoteId: "quote-1", proposals });

  expect(complete).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
  expect(result).toEqual({ quoteId: "quote-1", proposals });
});

it("stops all quote presentation when the employee loses quote collection access", async () => {
  const { presentation, complete, publish } = presentationFactory({
    allowedCollections: ["cotizaciones"],
  });
  const result = await presentation.finish({ quoteId: "quote-1", proposals });

  expect(complete).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
  expect(result).toEqual({ quoteId: "quote-1", proposals });
});

it("falls back without a model when the summary model is outside the allowed list or public origin is absent", async () => {
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
