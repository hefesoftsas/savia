import { describe, expect, it, vi } from "vitest";
import type { WhatsappAssistantBinding } from "../src/whatsapp/inbound-contracts";
import {
  buildNativeMessage,
  defaultNativeConfiguration,
  nativeConfigurationSchema,
  nativeReplySchema,
  nativeReplyText,
  sendNativeMessage,
  sendReadIndicator,
} from "../src/whatsapp/native";

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

const config = nativeConfigurationSchema.parse({
  replyButtons: true,
  listMessages: true,
  flows: [
    {
      key: "vehicle-intake",
      label: "Vehicle details",
      flowId: "50001",
      screen: "VEHICLE",
    },
  ],
  catalogs: [
    {
      key: "vehicles",
      label: "Vehicles",
      catalogId: "60001",
      products: [
        { id: "sedan", label: "Compact sedan" },
        { id: "suv", label: "Family SUV" },
      ],
    },
  ],
  templates: [
    {
      key: "follow-up",
      label: "Approved follow-up",
      name: "follow_up",
      language: "es_CO",
      parameterCount: 2,
    },
  ],
  media: [
    {
      key: "brochure",
      label: "Vehicle brochure",
      type: "document",
      mediaId: "70001",
      filename: "vehicles.pdf",
    },
  ],
  locations: [
    {
      key: "office",
      label: "Main office",
      latitude: 4.711,
      longitude: -74.072,
      name: "Savia",
      address: "Bogotá",
    },
  ],
});

describe("WhatsApp native configuration", () => {
  it("defaults every capability off and every resource list empty", () => {
    expect(defaultNativeConfiguration).toEqual({
      replyButtons: false,
      listMessages: false,
      mediaUnderstanding: false,
      readReceipts: false,
      typingIndicator: false,
      flows: [],
      catalogs: [],
      templates: [],
      media: [],
      locations: [],
    });
  });

  it("requires read receipts when typing indicators are enabled", () => {
    expect(() =>
      nativeConfigurationSchema.parse({ typingIndicator: true }),
    ).toThrow();
    expect(
      nativeConfigurationSchema.parse({ readReceipts: true }).typingIndicator,
    ).toBe(false);
    expect(
      nativeConfigurationSchema.parse({
        readReceipts: true,
        typingIndicator: true,
      }),
    ).toMatchObject({ readReceipts: true, typingIndicator: true });
  });

  it("rejects repeated resource keys and repeated reply option IDs", () => {
    expect(() =>
      nativeConfigurationSchema.parse({
        flows: [
          { key: "same", label: "First", flowId: "12345", screen: "START" },
          { key: "same", label: "Second", flowId: "23456", screen: "START" },
        ],
      }),
    ).toThrow();
    expect(() =>
      nativeConfigurationSchema.parse({
        flows: [{ key: "flow", label: "Flow", flowId: 12345, screen: "START" }],
      }),
    ).toThrow();
    expect(() =>
      nativeReplySchema.parse({
        kind: "buttons",
        text: "Choose",
        options: [
          { id: "yes", title: "Yes" },
          { id: "yes", title: "Also yes" },
        ],
      }),
    ).toThrow();
  });
});

describe("WhatsApp native message payloads", () => {
  it("builds bounded reply buttons and a list from assistant choices", () => {
    expect(
      buildNativeMessage(
        {
          kind: "buttons",
          text: "Choose one",
          options: [
            { id: "quote", title: "Get quote" },
            { id: "help", title: "Get help" },
          ],
        },
        config,
        "+57 300 123 4567",
      ),
    ).toEqual({
      messaging_product: "whatsapp",
      to: "573001234567",
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "Choose one" },
        action: {
          buttons: [
            { type: "reply", reply: { id: "quote", title: "Get quote" } },
            { type: "reply", reply: { id: "help", title: "Get help" } },
          ],
        },
      },
    });
    expect(
      buildNativeMessage(
        {
          kind: "list",
          text: "Pick a vehicle",
          buttonLabel: "View",
          options: [{ id: "sedan", title: "Sedan", description: "Four doors" }],
        },
        config,
        "573001234567",
      ),
    ).toEqual({
      messaging_product: "whatsapp",
      to: "573001234567",
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: "Pick a vehicle" },
        action: {
          button: "View",
          sections: [
            {
              title: "Options",
              rows: [
                { id: "sedan", title: "Sedan", description: "Four doors" },
              ],
            },
          ],
        },
      },
    });
  });

  it("maps configured Flows, catalog products, media, locations, and templates without accepting provider IDs from the reply", () => {
    const flow = buildNativeMessage(
      {
        kind: "flow",
        text: "Tell us about the vehicle",
        resourceKey: "vehicle-intake",
      },
      config,
      "573001234567",
    );
    expect(flow).toMatchObject({
      type: "interactive",
      interactive: {
        type: "flow",
        body: { text: "Tell us about the vehicle" },
        action: {
          name: "flow",
          parameters: {
            flow_message_version: "3",
            flow_id: "50001",
            flow_cta: "Open",
            flow_action: "navigate",
            flow_action_payload: { screen: "VEHICLE" },
          },
        },
      },
    });
    expect(
      (flow.interactive as { action: { parameters: { flow_token: string } } })
        .action.parameters.flow_token,
    ).toMatch(/^[0-9a-f-]{36}$/i);
    expect(
      buildNativeMessage(
        {
          kind: "catalog",
          text: "Available vehicles",
          resourceKey: "vehicles",
          productIds: ["sedan", "suv"],
        },
        config,
        "573001234567",
      ),
    ).toEqual({
      messaging_product: "whatsapp",
      to: "573001234567",
      type: "interactive",
      interactive: {
        type: "product_list",
        header: { type: "text", text: "Vehicles" },
        body: { text: "Available vehicles" },
        action: {
          catalog_id: "60001",
          sections: [
            {
              title: "Vehicles",
              product_items: [
                { product_retailer_id: "sedan" },
                { product_retailer_id: "suv" },
              ],
            },
          ],
        },
      },
    });
    expect(
      buildNativeMessage(
        { kind: "media", resourceKey: "brochure", caption: "Read this" },
        config,
        "573001234567",
      ),
    ).toEqual({
      messaging_product: "whatsapp",
      to: "573001234567",
      type: "document",
      document: { id: "70001", filename: "vehicles.pdf", caption: "Read this" },
    });
    expect(
      buildNativeMessage(
        { kind: "location", resourceKey: "office" },
        config,
        "573001234567",
      ),
    ).toEqual({
      messaging_product: "whatsapp",
      to: "573001234567",
      type: "location",
      location: {
        latitude: 4.711,
        longitude: -74.072,
        name: "Savia",
        address: "Bogotá",
      },
    });
    expect(
      buildNativeMessage(
        {
          kind: "template",
          resourceKey: "follow-up",
          parameters: ["Ana", "Auto"],
        },
        config,
        "573001234567",
      ),
    ).toEqual({
      messaging_product: "whatsapp",
      to: "573001234567",
      type: "template",
      template: {
        name: "follow_up",
        language: { code: "es_CO" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Ana" },
              { type: "text", text: "Auto" },
            ],
          },
        ],
      },
    });
  });

  it("rejects disabled features, missing resources, foreign products, and incorrect template parameter counts", () => {
    expect(() =>
      buildNativeMessage(
        { kind: "buttons", text: "Choose", options: [{ id: "x", title: "X" }] },
        defaultNativeConfiguration,
        "573001234567",
      ),
    ).toThrow();
    expect(() =>
      buildNativeMessage(
        {
          kind: "list",
          text: "Choose",
          buttonLabel: "Open",
          options: [{ id: "x", title: "X" }],
        },
        config,
        "573001234567",
      ),
    ).not.toThrow();
    expect(() =>
      buildNativeMessage(
        { kind: "flow", text: "Open", resourceKey: "missing" },
        config,
        "573001234567",
      ),
    ).toThrow();
    expect(() =>
      buildNativeMessage(
        {
          kind: "catalog",
          text: "Vehicles",
          resourceKey: "vehicles",
          productIds: ["unknown"],
        },
        config,
        "573001234567",
      ),
    ).toThrow();
    expect(() =>
      buildNativeMessage(
        {
          kind: "template",
          resourceKey: "follow-up",
          parameters: ["only one"],
        },
        config,
        "573001234567",
      ),
    ).toThrow();
  });

  it("summarizes native replies as safe conversational text", () => {
    expect(nativeReplyText("Existing plain-text reply")).toBe(
      "Existing plain-text reply",
    );
    expect(
      nativeReplyText(
        {
          kind: "buttons",
          text: "Choose",
          options: [
            { id: "a", title: "One" },
            { id: "b", title: "Two" },
          ],
        },
        config,
      ),
    ).toBe("Choose [One / Two]");
    expect(nativeReplyText({ kind: "media", resourceKey: "missing" })).toBe(
      "missing",
    );
    expect(
      nativeReplyText(
        { kind: "media", resourceKey: "brochure", caption: "Read this" },
        config,
      ),
    ).toBe("Vehicle brochure: Read this");
  });
});

describe("WhatsApp native delivery helpers", () => {
  it("sends one validated native message through the tenant Nango connection and requires a message ID", async () => {
    const proxy = vi
      .fn()
      .mockResolvedValue(Response.json({ messages: [{ id: "wamid.native" }] }));
    const nango = { proxy };
    expect(
      await sendNativeMessage(
        nango,
        binding,
        { kind: "location", resourceKey: "office" },
        config,
        "573001234567",
      ),
    ).toBe("wamid.native");
    expect(proxy).toHaveBeenCalledTimes(1);
    expect(proxy).toHaveBeenCalledWith({
      connection: binding.connection,
      method: "POST",
      path: "/v21.0/123456789/messages",
      body: expect.objectContaining({ type: "location", to: "573001234567" }),
    });
    proxy.mockResolvedValue(Response.json({}));
    await expect(
      sendNativeMessage(
        nango,
        binding,
        { kind: "text", text: "Hi" },
        config,
        "573001234567",
      ),
    ).rejects.toThrow();
    expect(proxy).toHaveBeenCalledTimes(2);
  });

  it("checks that Flow and template resources remain published and approved before sending", async () => {
    const flowProxy = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: "50002", status: "PUBLISHED" }] }),
      );
    await expect(
      sendNativeMessage(
        { proxy: flowProxy },
        binding,
        { kind: "flow", text: "Continue", resourceKey: "vehicle-intake" },
        config,
        "573001234567",
      ),
    ).rejects.toThrow();
    expect(flowProxy).toHaveBeenCalledTimes(1);
    expect(flowProxy.mock.calls[0][0].path).toContain("/v21.0/987654321/flows");

    const endpointFlowProxy = vi.fn().mockResolvedValueOnce(
      Response.json({
        data: [
          {
            id: "50001",
            status: "PUBLISHED",
            endpoint_uri: "https://tenant.example/flow-endpoint",
          },
        ],
      }),
    );
    await expect(
      sendNativeMessage(
        { proxy: endpointFlowProxy },
        binding,
        { kind: "flow", text: "Continue", resourceKey: "vehicle-intake" },
        config,
        "573001234567",
      ),
    ).rejects.toThrow();
    expect(endpointFlowProxy).toHaveBeenCalledTimes(1);
    expect(endpointFlowProxy.mock.calls[0][0].path).toContain("endpoint_uri");

    const templateProxy = vi.fn().mockResolvedValueOnce(
      Response.json({
        data: [
          {
            name: "follow_up",
            language: "es_CO",
            status: "PENDING",
            components: [{ type: "BODY", text: "Hola {{1}} {{2}}" }],
          },
        ],
      }),
    );
    await expect(
      sendNativeMessage(
        { proxy: templateProxy },
        binding,
        {
          kind: "template",
          resourceKey: "follow-up",
          parameters: ["Ana", "Auto"],
        },
        config,
        "573001234567",
      ),
    ).rejects.toThrow();
    expect(templateProxy).toHaveBeenCalledTimes(1);
    expect(templateProxy.mock.calls[0][0].path).toContain("message_templates");

    const namedParameterProxy = vi.fn().mockResolvedValueOnce(
      Response.json({
        data: [
          {
            name: "follow_up",
            language: "es_CO",
            status: "APPROVED",
            components: [{ type: "BODY", text: "Hola {{first_name}}" }],
          },
        ],
      }),
    );
    await expect(
      sendNativeMessage(
        { proxy: namedParameterProxy },
        binding,
        {
          kind: "template",
          resourceKey: "follow-up",
          parameters: [],
        },
        nativeConfigurationSchema.parse({
          ...config,
          templates: [
            {
              key: "follow-up",
              label: "Approved follow-up",
              name: "follow_up",
              language: "es_CO",
              parameterCount: 0,
            },
          ],
        }),
        "573001234567",
      ),
    ).rejects.toThrow();
    expect(namedParameterProxy).toHaveBeenCalledTimes(1);
  });

  it("rechecks route state after Flow validation and immediately before sending", async () => {
    const proxy = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: "50001", status: "PUBLISHED" }] }),
      )
      .mockResolvedValueOnce(
        Response.json({ messages: [{ id: "wamid.flow" }] }),
      );
    const beforeSend = vi.fn();
    await sendNativeMessage(
      { proxy },
      binding,
      { kind: "flow", text: "Continue", resourceKey: "vehicle-intake" },
      config,
      "573001234567",
      beforeSend,
    );
    expect(beforeSend).toHaveBeenCalledTimes(1);
    expect(proxy).toHaveBeenCalledTimes(2);
    expect(proxy.mock.calls[1][0].method).toBe("POST");
  });

  it("marks an inbound message read and optionally starts text typing in one best-effort request", async () => {
    const proxy = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    await sendReadIndicator({ proxy }, binding, "wamid.inbound", true);
    expect(proxy).toHaveBeenCalledTimes(1);
    expect(proxy).toHaveBeenCalledWith({
      connection: binding.connection,
      method: "POST",
      path: "/v21.0/123456789/messages",
      body: {
        messaging_product: "whatsapp",
        status: "read",
        message_id: "wamid.inbound",
        typing_indicator: { type: "text" },
      },
    });
  });
});

it("includes the required text header and bounds catalog section titles to Meta limits", () => {
  const label = "A catalog with a sufficiently long name ".repeat(2);
  const configuration = nativeConfigurationSchema.parse({
    catalogs: [
      {
        key: "catalog",
        label,
        catalogId: "60001",
        products: [{ id: "sku", label: "Product" }],
      },
    ],
  });
  const payload = buildNativeMessage(
    {
      kind: "catalog",
      resourceKey: "catalog",
      text: "Choose a product",
      productIds: ["sku"],
    },
    configuration,
    "573001234567",
  ) as {
    interactive: {
      header?: { type: string; text: string };
      action: { sections: Array<{ title: string }> };
    };
  };
  expect(payload.interactive.header).toEqual({
    type: "text",
    text: label.trim().slice(0, 60),
  });
  expect(payload.interactive.action.sections[0].title).toHaveLength(24);
});
