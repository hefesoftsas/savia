import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { setupChannelFixture } from "./whatsapp-channel-fixture";
import { WhatsappChannelRepository } from "../src/whatsapp/channel-repository";
import { routeEmployeeInput } from "../src/whatsapp/employee-router";

it("buffers the initial task once and navigates from any selected employee", async () => {
  const s = await setupChannelFixture();
  const repo = new WhatsappChannelRepository(env.DB);
  await repo.configure(
    s.tenantId,
    s.connectionId,
    {
      routingEnabled: true,
      tasks: [
        {
          id: "insurance",
          employeeId: s.employeeId,
          title: "Consultar seguros",
          description: "",
          order: 0,
          audiences: ["external"],
        },
        {
          id: "support",
          employeeId: s.employeeId,
          title: "Consultar soporte",
          description: "",
          order: 1,
          audiences: ["external"],
        },
      ],
      staff: [],
      internalCapabilities: [],
      externalCapabilities: [],
    },
    s.principal.id,
  );
  const access = await repo.getAccess({
    tenantId: s.tenantId,
    connectionId: s.connectionId,
    contact: "573001234567",
  });
  const input = {
    phoneNumberId: s.phoneNumberId,
    wabaId: s.wabaId,
    messageId: "route-1",
    contactPhone: access.contact,
    text: "RHO121",
    timestamp: new Date().toISOString(),
  };
  expect(await routeEmployeeInput(access, input, repo)).toMatchObject({
    kind: "reply",
  });
  expect(
    await routeEmployeeInput(access, { ...input, text: "1" }, repo),
  ).toMatchObject({ kind: "employee", text: "RHO121" });
  expect(
    await routeEmployeeInput(access, { ...input, text: "MENÚ" }, repo),
  ).toMatchObject({ kind: "reply" });
  expect(await repo.getSession(access)).toBeNull();
  expect(
    await routeEmployeeInput(access, { ...input, text: "2" }, repo),
  ).toMatchObject({
    kind: "employee",
    text: "Presenta brevemente cómo puedes ayudarme con esta tarea.",
  });
});
