import { expect, it, vi } from "vitest";
import { runWhatsappScheduledLanes } from "../src/whatsapp/scheduler";

it("runs queued action delivery independently of a slow inbox drain", async () => {
  let releaseInbox!: () => void;
  const inbox = new Promise<void>((resolve) => {
    releaseInbox = resolve;
  });
  let releaseFirstAction!: () => void;
  const firstAction = new Promise<void>((resolve) => {
    releaseFirstAction = resolve;
  });
  const processInbox = vi.fn(() => inbox);
  const processActions = vi.fn(async () => {
    if (processActions.mock.calls.length === 1) await firstAction;
  });

  const scheduled = runWhatsappScheduledLanes(processInbox, processActions);
  await vi.waitFor(() => expect(processActions).toHaveBeenCalledOnce());
  expect(processInbox).toHaveBeenCalledOnce();
  releaseInbox();
  await vi.waitFor(() => expect(processActions).toHaveBeenCalledTimes(2));
  releaseFirstAction();
  await expect(scheduled).resolves.toBeUndefined();
  expect(processActions).toHaveBeenCalledTimes(2);
});

it("waits for both lanes and reports either lane failure", async () => {
  const inboxFailure = new Error("inbox failed");
  const actionsFailure = new Error("actions failed");
  const processActions = vi.fn(async () => {
    throw actionsFailure;
  });

  await expect(
    runWhatsappScheduledLanes(async () => {
      throw inboxFailure;
    }, processActions),
  ).rejects.toMatchObject({
    errors: expect.arrayContaining([inboxFailure, actionsFailure]),
  });
  expect(processActions).toHaveBeenCalledOnce();
});

it("delivers existing results before a slow inbox and defers newly queued action execution until its acknowledgement", async () => {
  const { runWhatsappEventLanes } = await import("../src/whatsapp/scheduler");
  const events: string[] = [];
  let acknowledge!: () => void;
  const acknowledgement = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  const batch = runWhatsappEventLanes(
    async () => {
      events.push("ready-result");
      return 1;
    },
    async () => {
      events.push("inbox");
      await acknowledgement;
      events.push("acknowledged");
      return { processed: 1, failed: 0 };
    },
    async () => ({ processed: 0, delivered: 0 }),
  );
  await vi.waitFor(() => expect(events).toEqual(["ready-result", "inbox"]));
  acknowledge();
  expect(await batch).toBe(true);
  expect(events).toEqual(["ready-result", "inbox", "acknowledged"]);
});

it("executes a queued action when no inbox input is ready and sleeps when all lanes are empty", async () => {
  const { runWhatsappEventLanes } = await import("../src/whatsapp/scheduler");
  const events: string[] = [];
  expect(
    await runWhatsappEventLanes(
      async () => 0,
      async () => ({ processed: 0, failed: 0 }),
      async () => {
        events.push("action");
        return { processed: 1, delivered: 1 };
      },
    ),
  ).toBe(true);
  expect(events).toEqual(["action"]);
  expect(
    await runWhatsappEventLanes(
      async () => 0,
      async () => ({ processed: 0, failed: 0 }),
      async () => ({ processed: 0, delivered: 0 }),
    ),
  ).toBe(false);
});

it("does not starve a confirmed action behind continuously arriving messages", async () => {
  const { runWhatsappEventLanes } = await import("../src/whatsapp/scheduler");
  const events: string[] = [];
  await runWhatsappEventLanes(
    async () => 0,
    async () => {
      events.push("inbox");
      return { processed: 1, failed: 0 };
    },
    async () => {
      events.push("action");
      return { processed: 1, delivered: 1 };
    },
  );
  expect(events).toEqual(["action"]);
});
