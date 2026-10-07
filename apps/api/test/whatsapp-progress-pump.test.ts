import { expect, it } from "vitest";
import { createActionProgressPump } from "../src/whatsapp/progress-pump";

it("groups simultaneous notifications and serializes sends while providers continue", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => (release = resolve));
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  const pump = createActionProgressPump(async () => {
    calls++;
    active++;
    maxActive = Math.max(maxActive, active);
    if (calls === 1) await blocked;
    active--;
  }, 1);
  pump.notify();
  pump.notify();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(calls).toBe(1);
  pump.notify();
  pump.notify();
  release();
  await pump.drain();
  expect(calls).toBe(2);
  expect(maxActive).toBe(1);
});

it("contains delivery failures and can flush later persisted progress", async () => {
  let calls = 0;
  const pump = createActionProgressPump(async () => {
    if (++calls === 1) throw new Error("temporary database failure");
  }, 1);
  pump.notify();
  await expect(pump.drain()).resolves.toBeUndefined();
  pump.notify();
  await pump.drain();
  expect(calls).toBe(2);
});

it("drains multiple persisted batches after one notification", async () => {
  let remaining = 2;
  let calls = 0;
  const pump = createActionProgressPump(async () => {
    calls++;
    return remaining-- > 0;
  }, 1);
  pump.notify();
  await pump.drain();
  expect(calls).toBe(3);
});
