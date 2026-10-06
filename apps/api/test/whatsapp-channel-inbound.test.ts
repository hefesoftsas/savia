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
