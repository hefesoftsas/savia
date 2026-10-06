import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { setupChannelFixture } from "./whatsapp-channel-fixture";
import { upsertPrincipal } from "../src/auth/identity-repository";
import { WhatsappChannelRepository } from "../src/whatsapp/channel-repository";
import { createChannelOperationAdapter } from "../src/assistant/operation-adapter";
import { processChannelActions } from "../src/whatsapp/action-jobs";
import { deliverChannelActionResults } from "../src/whatsapp/action-results";
import { cleanupChannelState } from "../src/whatsapp/channel-cleanup";

it("uses the linked staff account for confirmed Studio and personal operations, even after menu navigation", async () => {
  const s = await setupChannelFixture();
  const repo = new WhatsappChannelRepository(env.DB);
  const staff = await upsertPrincipal(env.DB, {
    issuer: "test-staff",
    subject: String(s.tenantId),
    email: `staff-${s.tenantId}@example.test`,
    displayName: "Staff",
  });
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES(?,?,?,'operator',1,?,?)",
  )
    .bind(`staff-${s.tenantId}`, staff.id, s.tenantId, now, now)
    .run();
  await env.DB.prepare(
    "UPDATE assistant_virtual_employees SET allowed_collections='[\"customers\"]' WHERE id=?",
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
          id: "crm",
          employeeId: s.employeeId,
          title: "Consultar clientes",
          description: "",
          order: 0,
          audiences: ["internal"],
        },
      ],
      staff: [
        {
          phone: "573001234567",
          label: "Staff",
          active: true,
          principalId: staff.id,
        },
      ],
      internalCapabilities: ["studio", "personal-integrations"],
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
  const session = (await repo.selectTask(access, "crm", menu.id))!;
  const binding = (await s.repository.resolve(s.phoneNumberId, s.wabaId))!;
  const calls: any[] = [];
  const personal = vi.fn(async (input: any) => {
    calls.push(input);
    return { provider: "gmail", action: "send-email" };
  });
  const backend: typeof fetch = async (url, init) => {
    if (new URL(String(url)).pathname.endsWith("/objects"))
      return Response.json({ data: [{ name: "customers" }] });
    calls.push({ url: String(url), body: init?.body });
    return Response.json({ data: { id: "record", _version: 1 } });
  };
  const adapter = createChannelOperationAdapter({
    repository: repo,
    secret: "test-secret",
    backendForActor: async (actor) => {
      expect(actor.principal.id).toBe(staff.id);
      return backend;
    },
    personal: { executeConfirmedAction: personal } as any,
  });
  const caps = await adapter.capabilities({
    ...binding,
    channelSession: session,
  });
  await (caps!.tools.savia_prepare_command as any).execute({
    domain: "studio",
    command: "create-record",
    input: { collection: "customers", data: { name: "Test" } },
  });
  expect(calls).toHaveLength(0);
  let preview = caps!.reply!() as string;
  await adapter.actions!.consume(
    session,
    preview.match(/CONFIRMAR [A-Z2-7]{10}/)![0],
  );
  await repo.returnToMenu(access);
  expect(
    await processChannelActions(adapter.actions!, (action) =>
      adapter.execute(binding, action),
    ),
  ).toMatchObject({ completed: 1 });
  expect(calls).toHaveLength(1);
  const resultSend = vi.fn(async () => "wamid.result");
  const deliver = () =>
    deliverChannelActionResults(repo, async () => binding, resultSend);
  await deliver();
  expect(resultSend).not.toHaveBeenCalled();
  await s.repository.receive({
    phoneNumberId: s.phoneNumberId,
    wabaId: s.wabaId,
    messageId: "result-window",
    contactPhone: access.contact,
    text: "menu",
    timestamp: now,
  });
  await deliver();
  expect(resultSend).toHaveBeenCalledTimes(1);
  expect(resultSend.mock.calls[0]).toEqual(
    expect.arrayContaining([
      expect.stringContaining("Test employee · Asistente virtual"),
    ]),
  );
  await deliver();
  expect(resultSend).toHaveBeenCalledTimes(1);
  expect(await repo.getSession(access)).toBeNull();
  const issued = await repo.issueMenu(access);
  const next = (await repo.selectTask(access, "crm", issued.id))!;
  const personalCaps = await adapter.capabilities({
    ...binding,
    channelSession: next,
  });
  await (personalCaps!.tools.savia_prepare_command as any).execute({
    domain: "personal-integrations",
    command: "send-email",
    input: {
      provider: "gmail",
      to: ["test@example.test"],
      subject: "Test",
      body: "Message",
    },
  });
  preview = personalCaps!.reply!() as string;
  await adapter.actions!.consume(
    next,
    preview.match(/CONFIRMAR [A-Z2-7]{10}/)![0],
  );
  await processChannelActions(adapter.actions!, (action) =>
    adapter.execute(binding, action),
  );
  expect(personal).toHaveBeenCalledWith(
    expect.objectContaining({ principalId: staff.id }),
  );
  // History retention cannot erase unresolved dispatch evidence or resource ownership.
  await env.DB.prepare(
    "UPDATE whatsapp_channel_actions SET status='uncertain',created_at='2000-01-01T00:00:00.000Z' WHERE connection_id=?",
  )
    .bind(s.connectionId)
    .run();
  await cleanupChannelState(repo);
  expect(
    (await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM whatsapp_channel_actions WHERE connection_id=?",
    )
      .bind(s.connectionId)
      .first<any>())!.n,
  ).toBe(2);
  const external = await repo.getAccess({ ...access, contact: "573009999999" });
  expect(await repo.listTasks(external)).toEqual([]);
});
