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

it("runs the result delivery hook after each queued action", async () => {
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
  for (let index = 0; index < 2; index++) {
    const reply = await actions.prepare(
      {
        id: crypto.randomUUID(),
        session,
        revision: 1,
        domain: "test",
        command: "test",
        input: { index },
      },
      "Test",
      true,
    );
    await actions.consume(session, (reply as any).options[0].id);
  }

  const events: string[] = [];
  const execute = vi.fn(async (_action: unknown, id: string) => {
    events.push(`execute:${id}`);
    return { state: "completed" as const, result: {} };
  });
  await processChannelActions(actions, execute, 3, async (id) => {
    events.push(`deliver:${id}`);
  });

  expect(events).toEqual([
    `execute:${vi.mocked(execute).mock.calls[0][1]}`,
    `deliver:${vi.mocked(execute).mock.calls[0][1]}`,
    `execute:${vi.mocked(execute).mock.calls[1][1]}`,
    `deliver:${vi.mocked(execute).mock.calls[1][1]}`,
  ]);
});

it("does not dispatch a second action for a contact while one is active", async () => {
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
  for (let index = 0; index < 2; index++) {
    const reply = await actions.prepare(
      {
        id: crypto.randomUUID(),
        session,
        revision: 1,
        domain: "test",
        command: "test",
        input: { index },
      },
      "Test",
      true,
    );
    await actions.consume(session, (reply as any).options[0].id);
  }

  let releaseFirst!: () => void;
  const first = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let firstStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  const execute = vi.fn(async () => {
    if (execute.mock.calls.length === 1) {
      firstStarted();
      await first;
    }
    return { state: "completed" as const, result: {} };
  });

  const batchSpy = vi.spyOn(env.DB, "batch");
  const firstWorker = processChannelActions(actions, execute);
  await started;
  await processChannelActions(actions, execute);
  expect(execute).toHaveBeenCalledOnce();
  releaseFirst();
  await firstWorker;
  expect(execute).toHaveBeenCalledTimes(2);
  expect(batchSpy).toHaveBeenCalled();
  batchSpy.mockRestore();
});
