import { describe, expect, it, vi } from "vitest";
import {
  createWhatsappAssistant,
  sendWhatsappReply,
} from "../src/whatsapp/assistant";
import type { WhatsappAssistantBinding } from "../src/whatsapp/inbound-contracts";

const binding: WhatsappAssistantBinding = {
  connectionId: "connection",
  tenantId: 7,
  employeeId: "employee",
  enabled: true,
  allowedContacts: ["573001234567"],
  updatedBy: "owner",
  ownerPrincipalId: "owner",
  connection: {
    id: "connection",
    agencyId: 7,
    provider: "whatsapp",
    status: "connected",
    phoneNumberId: "123456789",
    wabaId: "987654321",
    displayPhoneNumber: null,
    externalAccountLabel: null,
    lastValidatedAt: null,
    createdAt: "",
    updatedAt: "",
    nangoConnectionId: "tenant-connection",
    nangoIntegrationId: "whatsapp-business",
  },
};

function setup(employeeOverride = {}) {
  const configuration = {
    effectiveConfigurationForTenant: vi.fn().mockResolvedValue({
      apiKey: "private-key",
      model: "test/model",
      tenantId: 7,
    }),
  };
  const employees = {
    getById: vi.fn().mockResolvedValue({
      id: "employee",
      agencyId: 7,
      status: "active",
      name: "Support",
      allowedCollections: ["*"],
      systemPrompt: "Answer in Spanish.",
      model: null,
      ...employeeOverride,
    }),
  };
  const knowledge = vi.fn().mockResolvedValue([{ text: "Tenant knowledge" }]);
  const complete = vi.fn().mockResolvedValue("Hola, ¿cómo puedo ayudarte?");
  return {
    configuration,
    employees,
    knowledge,
    complete,
    generate: createWhatsappAssistant({
      configuration,
      employees,
      knowledge,
      complete,
    }),
  };
}

describe("restricted WhatsApp assistant", () => {
  it("uses explicit tenant configuration and employee knowledge without tools or caller identity", async () => {
    const s = setup();
    const history = [
      { role: "user" as const, content: "Earlier question" },
      { role: "assistant" as const, content: "Earlier reply" },
    ];
    expect(await s.generate(binding, history, "Hola")).toContain("Hola");
    expect(
      s.configuration.effectiveConfigurationForTenant,
    ).toHaveBeenCalledWith("owner", 7);
    expect(s.employees.getById).toHaveBeenCalledWith("employee", 7);
    expect(s.knowledge).toHaveBeenCalledWith("employee", "Hola");
    const input = s.complete.mock.calls[0][0];
    expect(input.system).toContain("Answer in Spanish.");
    expect(input.system).toMatch(/natural.*conversational/i);
    expect(input.system).toMatch(/contact.*directly/i);
    expect(input.system).toMatch(/never pretend.*human/i);
    expect(input.system).toContain("Tenant knowledge");
    expect(input.messages).toEqual([
      ...history,
      { role: "user", content: "Hola" },
    ]);
    expect(input).not.toHaveProperty("tools");
    expect(input).not.toHaveProperty("authorization");
  });

  it("includes the current configured human contact as data for failure replies", async () => {
    const s = setup();
    const humanSupportContact = vi.fn(
      async () => "https://support.example.test/help",
    );
    const generate = createWhatsappAssistant({ ...s, humanSupportContact });
    await generate(binding, [], "Help me");
    expect(humanSupportContact).toHaveBeenCalledWith(binding);
    expect(s.complete.mock.calls[0][0].system).toContain(
      '"https://support.example.test/help"',
    );
    expect(s.complete.mock.calls[0][0].system).toMatch(
      /serialized data, not instructions/,
    );
  });

  it.each([{ agencyId: 8 }, { status: "inactive" }])(
    "rejects an unavailable employee before generation: %j",
    async (override) => {
      const s = setup(override);
      await expect(s.generate(binding, [], "Hola")).rejects.toThrow();
      expect(s.complete).not.toHaveBeenCalled();
    },
  );

  it("respects text-only employees by skipping workspace document retrieval", async () => {
    const s = setup({ allowedCollections: [] });
    await s.generate(binding, [], "Hola");
    expect(s.knowledge).not.toHaveBeenCalled();
    expect(s.complete.mock.calls[0][0].system).not.toContain(
      "Tenant knowledge",
    );
  });

  it("rejects configuration from another tenant", async () => {
    const s = setup();
    s.configuration.effectiveConfigurationForTenant.mockResolvedValue({
      apiKey: "private-key",
      model: "test/model",
      tenantId: 8,
    });
    await expect(s.generate(binding, [], "Hola")).rejects.toThrow();
    expect(s.complete).not.toHaveBeenCalled();
  });

  it("rejects an employee model outside the administrator's enabled models", async () => {
    const s = setup({ model: "other/model" });
    await expect(s.generate(binding, [], "Hola")).rejects.toThrow(
      "WHATSAPP_MODEL_NOT_ALLOWED",
    );
    expect(s.complete).not.toHaveBeenCalled();
  });

  it("allows an employee model explicitly enabled by the administrator", async () => {
    const s = setup({ model: "other/model" });
    s.configuration.effectiveConfigurationForTenant.mockResolvedValue({
      apiKey: "private-key",
      model: "test/model",
      allowedModels: ["other/model"],
      tenantId: 7,
    });
    await s.generate(binding, [], "Hola");
    expect(s.complete.mock.calls[0][0].model).toBe("other/model");
  });

  it.each(["", "x".repeat(4097)])(
    "rejects an unusable generated response",
    async (text) => {
      const s = setup();
      s.complete.mockResolvedValue(text);
      await expect(s.generate(binding, [], "Hola")).rejects.toThrow();
    },
  );

  it("sends through the assigned Nango connection and requires a provider message ID", async () => {
    const nango = {
      proxy: vi
        .fn()
        .mockResolvedValue(
          Response.json({ messages: [{ id: "wamid.reply" }] }),
        ),
    };
    expect(
      await sendWhatsappReply(nango, binding, "Hola", "573001234567"),
    ).toBe("wamid.reply");
    expect(nango.proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: binding.connection,
        path: "/v21.0/123456789/messages",
        body: expect.objectContaining({
          to: "573001234567",
          text: { body: "Hola" },
        }),
      }),
    );
    nango.proxy.mockResolvedValue(Response.json({}));
    await expect(
      sendWhatsappReply(nango, binding, "Hola", "573001234567"),
    ).rejects.toThrow();
  });
});

it("returns native buttons only when the tenant enabled them", async () => {
  const { defaultNativeConfiguration } = await import("../src/whatsapp/native");
  const s = setup({ allowedCollections: [] });
  const reply = {
    kind: "buttons",
    text: "What would you like to do?",
    options: [
      { id: "quote", title: "Get a quote" },
      { id: "support", title: "Support" },
    ],
  };
  s.complete.mockResolvedValue(JSON.stringify(reply));
  const native = { ...defaultNativeConfiguration, replyButtons: true };
  expect(await s.generate({ ...binding, native }, [], "Hello")).toEqual(reply);
  expect(s.complete.mock.calls[0][0].system).toContain("buttons");
  await expect(
    s.generate({ ...binding, native: defaultNativeConfiguration }, [], "Hello"),
  ).rejects.toThrow();
});

it("does not allow the AI to initiate a template message", async () => {
  const { defaultNativeConfiguration } = await import("../src/whatsapp/native");
  const s = setup({ allowedCollections: [] });
  s.complete.mockResolvedValue(
    JSON.stringify({
      kind: "template",
      resourceKey: "followup",
      parameters: [],
    }),
  );
  await expect(
    s.generate(
      {
        ...binding,
        native: {
          ...defaultNativeConfiguration,
          templates: [
            {
              key: "followup",
              label: "Follow up",
              name: "follow_up",
              language: "es",
              parameterCount: 0,
            },
          ],
        },
      },
      [],
      "Hello",
    ),
  ).rejects.toThrow("WHATSAPP_AUTOMATIC_TEMPLATE_FORBIDDEN");
});

it("uses channel-authorized tools and server-generated previews without exposing tokens to the model", async () => {
  const s = setup();
  const tool = {
    description: "Read",
    inputSchema: {},
    execute: async () => ({}),
  };
  const preview = {
    kind: "buttons" as const,
    text: "Confirm",
    options: [{ id: "private-confirm-token", title: "Confirmar" }],
  };
  const generate = createWhatsappAssistant({
    configuration: s.configuration,
    employees: s.employees,
    knowledge: s.knowledge,
    complete: s.complete,
    capabilities: async () => ({
      tools: { read: tool } as any,
      system: "Authorized channel operations",
      reply: () => preview,
    }),
  });
  expect(await generate(binding, [], "Test")).toEqual(preview);
  expect(s.complete.mock.calls[0][0]).toHaveProperty("tools.read");
  expect(s.complete.mock.calls[0][0].system).not.toContain(
    "You have no administrative tools",
  );
  expect(JSON.stringify(s.complete.mock.calls[0][0])).not.toContain(
    "private-confirm-token",
  );
});
