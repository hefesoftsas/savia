import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { setupChannelFixture } from "./whatsapp-channel-fixture";
import { WhatsappChannelRepository } from "../src/whatsapp/channel-repository";
import { createRoutedWhatsappGenerator } from "../src/whatsapp/channel-runtime";
import { processWhatsappInbox } from "../src/whatsapp/inbound-processor";

it("routes the selected employee and revokes a reply if staff/profile changes before send", async () => {
  const s = await setupChannelFixture();
  const repo = new WhatsappChannelRepository(env.DB);
  const config = {
    routingEnabled: true,
    tasks: [
      {
        id: "support",
        employeeId: s.employeeId,
        title: "Consultar soporte",
        description: "",
        order: 0,
        audiences: ["external"],
      },
    ],
    staff: [],
    internalCapabilities: [],
    externalCapabilities: [],
  };
  await repo.configure(s.tenantId, s.connectionId, config, s.principal.id);
  const generate = vi.fn(async () => {
    await repo.configure(
      s.tenantId,
      s.connectionId,
      { ...config, externalCapabilities: ["studio.records.read"] },
      s.principal.id,
    );
    return "Respuesta";
  });
  const routed = createRoutedWhatsappGenerator(repo, generate);
  const input = {
    phoneNumberId: s.phoneNumberId,
    wabaId: s.wabaId,
    messageId: "routed-message",
    contactPhone: "573001234567",
    text: "Hola",
    timestamp: new Date().toISOString(),
  };
  await s.repository.receive(input);
  const send = vi.fn(async () => "wamid.reply");
  await processWhatsappInbox(s.repository, {
    generate: routed.generate,
    authorizeReply: routed.authorizeReply,
    send,
  });
  expect(generate).toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

it("rejects an outgoing menu rendered from an older channel configuration", async () => {
  const s = await setupChannelFixture();
  const repo = new WhatsappChannelRepository(env.DB);
  const config = {
    routingEnabled: true,
    tasks: [
      {
        id: "support",
        employeeId: s.employeeId,
        title: "Soporte",
        description: "",
        order: 0,
        audiences: ["external"],
      },
    ],
    staff: [],
    internalCapabilities: [],
    externalCapabilities: [],
  };
  await repo.configure(s.tenantId, s.connectionId, config, s.principal.id);
  const routed = createRoutedWhatsappGenerator(
    repo,
    vi.fn(async () => "Respuesta"),
  );
  const input = {
    phoneNumberId: s.phoneNumberId,
    wabaId: s.wabaId,
    messageId: "stale-menu-message",
    contactPhone: "573001234567",
    text: "Hola",
    timestamp: new Date().toISOString(),
  };
  await s.repository.receive(input);
  await routed.generate(
    {
      tenantId: s.tenantId,
      connectionId: s.connectionId,
      employeeId: s.employeeId,
    },
    [],
    input.text,
    input,
  );
  await repo.configure(
    s.tenantId,
    s.connectionId,
    {
      ...config,
      tasks: [{ ...config.tasks[0], title: "Nuevo nombre" }],
    },
    s.principal.id,
  );
  expect(
    await routed.authorizeReply(
      {
        tenantId: s.tenantId,
        connectionId: s.connectionId,
        employeeId: s.employeeId,
      },
      input,
    ),
  ).toBe(false);
});

it("rejects an outgoing menu when its employee is no longer on the active roster", async () => {
  const s = await setupChannelFixture();
  const repo = new WhatsappChannelRepository(env.DB);
  const config = {
    routingEnabled: true,
    tasks: [
      {
        id: "support",
        employeeId: s.employeeId,
        title: "Soporte",
        description: "",
        order: 0,
        audiences: ["external"],
      },
    ],
    staff: [],
    internalCapabilities: [],
    externalCapabilities: [],
  };
  await repo.configure(s.tenantId, s.connectionId, config, s.principal.id);
  const routed = createRoutedWhatsappGenerator(
    repo,
    vi.fn(async () => "Respuesta"),
  );
  const input = {
    phoneNumberId: s.phoneNumberId,
    wabaId: s.wabaId,
    messageId: "inactive-roster-menu-message",
    contactPhone: "573001234567",
    text: "Hola",
    timestamp: new Date().toISOString(),
  };
  await s.repository.receive(input);
  const binding = {
    tenantId: s.tenantId,
    connectionId: s.connectionId,
    employeeId: s.employeeId,
  };
  await routed.generate(binding, [], input.text, input);
  await env.DB.prepare(
    "UPDATE assistant_virtual_employees SET status='inactive' WHERE id=?",
  )
    .bind(s.employeeId)
    .run();
  expect(await routed.authorizeReply(binding, input)).toBe(false);
});

it("keeps one exact employee identity header and removes it from scoped history", async () => {
  const s = await setupChannelFixture();
  const repo = new WhatsappChannelRepository(env.DB);
  await env.DB.prepare(
    "UPDATE assistant_virtual_employees SET name='alice' WHERE id=?",
  )
    .bind(s.employeeId)
    .run();
  await repo.configure(
    s.tenantId,
    s.connectionId,
    {
      routingEnabled: true,
      tasks: [
        {
          id: "support",
          employeeId: s.employeeId,
          title: "Soporte",
          description: "",
          order: 0,
          audiences: ["external"],
        },
      ],
      staff: [],
      internalCapabilities: [],
      externalCapabilities: [],
    },
    s.principal.id,
  );
  const binding = {
    tenantId: s.tenantId,
    connectionId: s.connectionId,
    employeeId: s.employeeId,
  };
  const firstInput = {
    phoneNumberId: s.phoneNumberId,
    wabaId: s.wabaId,
    messageId: "identity-header-first",
    contactPhone: "573001234567",
    text: "Hola",
    timestamp: new Date().toISOString(),
  };
  await s.repository.receive(firstInput);
  const complete = vi
    .fn()
    .mockResolvedValueOnce(
      "alice · Asistente virtual\n\nALICE · ASISTENTE VIRTUAL\n\nHola, ¿en qué te ayudo? Alice · Asistente virtual y Bob · Asistente virtual son nombres que aparecen en el texto.",
    )
    .mockResolvedValueOnce("Hola de nuevo");
  const routed = createRoutedWhatsappGenerator(repo, complete);
  const firstReply = await routed.generate(
    binding,
    [],
    firstInput.text,
    firstInput,
  );
  expect(firstReply).toBe(
    "alice · Asistente virtual\n\nHola, ¿en qué te ayudo? Alice · Asistente virtual y Bob · Asistente virtual son nombres que aparecen en el texto.",
  );
  await routed.afterReply(binding, firstInput, firstReply);

  const secondInput = {
    ...firstInput,
    messageId: "identity-header-second",
    text: "Otra pregunta",
  };
  await s.repository.receive(secondInput);
  await routed.generate(binding, [], secondInput.text, secondInput);
  const usedHistory = complete.mock.calls[1]?.[1];
  expect(usedHistory).toEqual([
    { role: "user", content: "Hola" },
    {
      role: "assistant",
      content:
        "Hola, ¿en qué te ayudo? Alice · Asistente virtual y Bob · Asistente virtual son nombres que aparecen en el texto.",
    },
  ]);
});

it("normalizes native text and media captions without changing reply authorization data", async () => {
  const s = await setupChannelFixture();
  const repo = new WhatsappChannelRepository(env.DB);
  await env.DB.prepare(
    "UPDATE assistant_virtual_employees SET name='alice' WHERE id=?",
  )
    .bind(s.employeeId)
    .run();
  await repo.configure(
    s.tenantId,
    s.connectionId,
    {
      routingEnabled: true,
      tasks: [
        {
          id: "support",
          employeeId: s.employeeId,
          title: "Soporte",
          description: "",
          order: 0,
          audiences: ["external"],
        },
      ],
      staff: [],
      internalCapabilities: [],
      externalCapabilities: [],
    },
    s.principal.id,
  );
  const binding = {
    tenantId: s.tenantId,
    connectionId: s.connectionId,
    employeeId: s.employeeId,
  };
  const input = {
    phoneNumberId: s.phoneNumberId,
    wabaId: s.wabaId,
    messageId: "identity-header-buttons",
    contactPhone: "573001234567",
    text: "Hola",
    timestamp: new Date().toISOString(),
  };
  await s.repository.receive(input);
  const buttons = {
    kind: "buttons" as const,
    text: "ALICE · ASISTENTE VIRTUAL\n\nElige una opción",
    options: [{ id: "confirm:abc", title: "Confirmar" }],
  };
  const routed = createRoutedWhatsappGenerator(
    repo,
    vi.fn(async () => buttons),
  );
  const reply = await routed.generate(binding, [], input.text, input);
  expect(reply).toEqual({
    kind: "buttons",
    text: "alice · Asistente virtual\n\nElige una opción",
    options: [{ id: "confirm:abc", title: "Confirmar" }],
  });

  const mediaInput = { ...input, messageId: "identity-header-media" };
  await s.repository.receive(mediaInput);
  const media = {
    kind: "media" as const,
    resourceKey: "help-image",
    caption:
      "alice · Asistente virtual\n\nAlice · Asistente Virtual\n\nMira esta imagen. Alice · Asistente virtual y Bob · Asistente virtual también aparecen.",
  };
  const mediaComplete = vi.fn(async () => media);
  const mediaRouted = createRoutedWhatsappGenerator(repo, mediaComplete);
  const mediaReply = await mediaRouted.generate(
    binding,
    [],
    mediaInput.text,
    mediaInput,
  );
  expect(mediaReply).toEqual({
    kind: "media",
    resourceKey: "help-image",
    caption:
      "alice · Asistente virtual\n\nMira esta imagen. Alice · Asistente virtual y Bob · Asistente virtual también aparecen.",
  });
  await mediaRouted.afterReply(binding, mediaInput, mediaReply);
  const savedMediaHistory = await env.DB.prepare(
    "SELECT assistant_text FROM whatsapp_channel_history WHERE message_id=?",
  )
    .bind(mediaInput.messageId)
    .first<{ assistant_text: string }>();
  expect(savedMediaHistory?.assistant_text).toBe(
    "help-image: Mira esta imagen. Alice · Asistente virtual y Bob · Asistente virtual también aparecen.",
  );

  const followup = { ...mediaInput, messageId: "identity-header-media-next" };
  await s.repository.receive(followup);
  await mediaRouted.generate(binding, [], followup.text, followup);
  expect(mediaComplete.mock.calls[1]?.[1]).toContainEqual({
    role: "assistant",
    content:
      "help-image: Mira esta imagen. Alice · Asistente virtual y Bob · Asistente virtual también aparecen.",
  });
});

it("scrubs mixed-case confirmation codes from saved assistant history", async () => {
  const s = await setupChannelFixture();
  const repo = new WhatsappChannelRepository(env.DB);
  await repo.configure(
    s.tenantId,
    s.connectionId,
    {
      routingEnabled: true,
      tasks: [
        {
          id: "support",
          employeeId: s.employeeId,
          title: "Soporte",
          description: "",
          order: 0,
          audiences: ["external"],
        },
      ],
      staff: [],
      internalCapabilities: [],
      externalCapabilities: [],
    },
    s.principal.id,
  );
  const binding = {
    tenantId: s.tenantId,
    connectionId: s.connectionId,
    employeeId: s.employeeId,
  };
  const input = {
    phoneNumberId: s.phoneNumberId,
    wabaId: s.wabaId,
    messageId: "lowercase-confirmation-code",
    contactPhone: "573001234567",
    text: "  confirmar abcdefghjk  ",
    timestamp: new Date().toISOString(),
  };
  await s.repository.receive(input);
  const routed = createRoutedWhatsappGenerator(
    repo,
    vi.fn(async () => "CONFIRMAR abcdefghjk"),
  );
  const reply = await routed.generate(binding, [], input.text, input);
  await routed.afterReply(binding, input, reply);
  const row = await env.DB.prepare(
    "SELECT assistant_text FROM whatsapp_channel_history WHERE message_id=?",
  )
    .bind(input.messageId)
    .first<{ assistant_text: string }>();
  expect(row?.assistant_text).not.toContain("abcdefghjk");
  expect(row?.assistant_text).toContain("[Confirmación pendiente]");
  const inbox = await env.DB.prepare(
    "SELECT message_text,input_payload FROM whatsapp_inbox WHERE message_id=?",
  )
    .bind(input.messageId)
    .first<{ message_text: string; input_payload: string | null }>();
  expect(inbox?.message_text).toBe("[Action confirmation]");
  expect(inbox?.input_payload).toBeNull();
});
