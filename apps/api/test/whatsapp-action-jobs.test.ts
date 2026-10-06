import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { setupChannelFixture } from "./whatsapp-channel-fixture";
import { WhatsappChannelRepository } from "../src/whatsapp/channel-repository";
import { WhatsappChannelActions } from "../src/whatsapp/confirmations";
import { processChannelActions } from "../src/whatsapp/action-jobs";

it("never replays a dispatched action after a timeout or duplicate job processing", async () => {
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
          title: "Test",
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
  const access = await repo.getAccess({
    tenantId: s.tenantId,
    connectionId: s.connectionId,
    contact: "573001234567",
  });
  const menu = await repo.issueMenu(access);
  const session = (await repo.selectTask(access, "t", menu.id))!;
  const actions = new WhatsappChannelActions(repo, "test-secret");
  const reply = await actions.prepare(
    {
      id: crypto.randomUUID(),
      session,
      revision: 1,
      domain: "test",
      command: "test",
      input: {},
    },
    "Test",
    true,
  );
  await actions.consume(session, (reply as any).options[0].id);
  const execute = vi.fn(async () => {
    throw new Error("Response lost");
  });
  expect(await processChannelActions(actions, execute)).toMatchObject({
    uncertain: 1,
  });
  await processChannelActions(actions, execute);
  expect(execute).toHaveBeenCalledTimes(1);
});
