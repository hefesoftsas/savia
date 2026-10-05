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
    expect(input.system).toContain("Tenant knowledge");
    expect(input.messages).toEqual([
      ...history,
      { role: "user", content: "Hola" },
    ]);
    expect(input).not.toHaveProperty("tools");
    expect(input).not.toHaveProperty("authorization");
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
