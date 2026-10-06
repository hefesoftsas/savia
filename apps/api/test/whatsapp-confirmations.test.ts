import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { setupChannelFixture } from "./whatsapp-channel-fixture";
import { WhatsappChannelRepository } from "../src/whatsapp/channel-repository";
import { WhatsappChannelActions } from "../src/whatsapp/confirmations";

async function setup() {
  const s = await setupChannelFixture();
  const repo = new WhatsappChannelRepository(env.DB);
  await repo.configure(
    s.tenantId,
    s.connectionId,
    {
      routingEnabled: true,
      tasks: [
        {
          id: "t",
          employeeId: s.employeeId,
          title: "Consultar seguros",
          description: "",
          order: 0,
          audiences: ["external"],
        },
      ],
      staff: [],
      internalCapabilities: [],
      externalCapabilities: ["insurance"],
    },
    s.principal.id,
  );
  const access = await repo.getAccess({
    tenantId: s.tenantId,
    connectionId: s.connectionId,
    contact: "573001234567",
  });
  const menu = await repo.issueMenu(access);
  const session = (await repo.selectTask(access, "t", menu.id))!;
  const actions = new WhatsappChannelActions(repo, "test-encryption-secret");
  return { ...s, repo, session, actions };
}
it("stores encrypted input and consumes a contact-bound confirmation only once", async () => {
  const s = await setup();
  const action = {
    id: crypto.randomUUID(),
    session: s.session,
    revision: 1,
    domain: "insurance",
    command: "quote-auto",
    input: { private: "personal-data" },
  };
  const reply = await s.actions.prepare(action, "Test action", true);
  expect(reply).toMatchObject({ kind: "buttons" });
  const stored = await env.DB.prepare(
    "SELECT action_json FROM whatsapp_channel_actions WHERE id=?",
  )
    .bind(action.id)
    .first<any>();
  expect(stored.action_json).not.toContain("personal-data");
  const id = (reply as any).options[0].id;
  expect(
    await s.actions.consume(
      {
        ...s.session,
        access: { ...s.session.access, contact: "573009999999" },
      },
      id,
    ),
  ).toBeNull();
  expect(await s.actions.consume(s.session, id)).toMatchObject({
    state: "queued",
  });
  expect(await s.actions.consume(s.session, id)).toBeNull();
});
it("invalidates the fifth wrong code and a menu switch cancels pending previews", async () => {
  const s = await setup();
  const id = crypto.randomUUID();
  await s.actions.prepare(
    {
      id,
      session: s.session,
      revision: 1,
      domain: "insurance",
      command: "quote-auto",
      input: {},
    },
    "Test",
    false,
  );
  for (let i = 0; i < 5; i++)
    await s.actions.consume(s.session, "CONFIRMAR AAAAAAAAAA");
  expect(
    await env.DB.prepare(
      "SELECT status FROM whatsapp_channel_actions WHERE id=?",
    )
      .bind(id)
      .first("status"),
  ).toBe("cancelled");
  const other = crypto.randomUUID();
  await s.actions.prepare(
    {
      id: other,
      session: s.session,
      revision: 1,
      domain: "insurance",
      command: "quote-auto",
      input: {},
    },
    "Test",
    true,
  );
  await s.repo.returnToMenu(s.session.access);
  expect(
    await env.DB.prepare(
      "SELECT status FROM whatsapp_channel_actions WHERE id=?",
    )
      .bind(other)
      .first("status"),
  ).toBe("cancelled");
});
