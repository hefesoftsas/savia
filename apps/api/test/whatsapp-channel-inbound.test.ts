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
    await repo.configure(s.tenantId, s.connectionId, config, s.principal.id);
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
