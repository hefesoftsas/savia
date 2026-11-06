import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { setupChannelFixture } from "./whatsapp-channel-fixture";
import { WhatsappChannelRepository } from "../src/whatsapp/channel-repository";
import { ChannelDrafts } from "../src/whatsapp/drafts";
it("keeps verified vehicle fields when only applicant data is updated", async () => {
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
  const drafts = new ChannelDrafts(repo, "test-secret");
  await drafts.save(session, {
    vehicle: { plate: "TESTCAR", productionYear: 2011 },
  });
  await drafts.save(session, {
    vehicle: undefined,
    applicant: { firstName: "Test" },
  });
  await drafts.save(session, {
    consentPrompt: "versioned canonical draft",
    consent: true,
  });
  await drafts.save(session, { applicant: { surname: "Changed" } });
  expect(await drafts.get(session)).toMatchObject({
    consent: false,
    consentPrompt: null,
  });
  expect(await drafts.get(session)).toMatchObject({
    vehicle: { plate: "TESTCAR", productionYear: 2011 },
    applicant: { firstName: "Test" },
  });
  await drafts.save(session, { vehicle: { plate: "TESTNEW" } });
  expect((await drafts.get(session)).vehicle).toEqual({ plate: "TESTNEW" });
});
