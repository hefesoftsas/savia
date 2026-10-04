import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { CompanionSessions } from "../src/companion/sessions";
import { CompanionSessionJobs } from "../src/companion/session-jobs";
import type { CompanionService } from "../src/companion/service";
import type { EffectiveAssistantConfiguration } from "../src/assistant/configuration";

const scheduledItems = (keys: string[]) => {
  const items = new Map(
    keys.map((key) => [
      key,
      {
        access: { ownerId: "queue-test", requireTenant: false },
        id: key,
        runId: "00000000-0000-4000-8000-000000000001",
      },
    ]),
  );
  let remaining = keys.slice();
  return {
    takeJobCandidates: vi.fn(async (limit: number) => {
      const page = remaining.slice(0, limit);
      remaining = remaining.slice(page.length);
      return page;
    }),
    readSchedule: vi.fn(async (key: string) => items.get(key) ?? null),
    readInternal: vi.fn(async (_access: unknown, id: string) => ({
      id,
      job: {
        runId: "00000000-0000-4000-8000-000000000001",
        status: "queued",
        lease: null,
      },
    })),
    deleteSchedule: vi.fn(async () => undefined),
  };
};

const engineWith = (
  sessions: ReturnType<typeof scheduledItems>,
  process: (id: string) => Promise<void>,
) => {
  const engine = new CompanionSessionJobs(
    sessions as unknown as CompanionSessions,
    {} as CompanionService,
    async () => ({}) as EffectiveAssistantConfiguration,
  );
  vi.spyOn(engine, "process").mockImplementation(async (_access, id) =>
    process(id),
  );
  return engine;
};

const queuePrefix = "companion/session-jobs/";
const checkpointKey = "companion/session-job-scheduler/checkpoint.json";

const saveCheckpoint = async () => {
  const object = await env.DOCUMENTS.get(checkpointKey);
  return object ? await object.text() : null;
};

const restoreCheckpoint = async (saved: string | null) => {
  if (saved === null) await env.DOCUMENTS.delete(checkpointKey);
  else await env.DOCUMENTS.put(checkpointKey, saved);
};

const putDummyJobs = async (directory: string, count: number) => {
  const keys = Array.from(
    { length: count },
    (_, index) =>
      `${queuePrefix}${directory}/${String(index).padStart(4, "0")}.json`,
  );
  for (let offset = 0; offset < keys.length; offset += 100) {
    await Promise.all(
      keys
        .slice(offset, offset + 100)
        .map((key) => env.DOCUMENTS.put(key, "dummy queue index")),
    );
  }
  return keys;
};

const deleteKeys = async (keys: string[]) => {
  for (let offset = 0; offset < keys.length; offset += 1000)
    await env.DOCUMENTS.delete(keys.slice(offset, offset + 1000));
};

describe("Companion session queue batches", () => {
  it("processes each candidate once and reports the batch counts", async () => {
    const keys = ["job-a", "job-b", "job-c"];
    const sessions = scheduledItems(keys);
    const process = vi.fn(async (_id: string) => undefined);
    const engine = engineWith(sessions, process);

    await expect(engine.processBatch()).resolves.toEqual({
      scanned: 3,
      processed: 3,
      failed: 0,
    });
    expect(process.mock.calls.map(([id]) => id).sort()).toEqual(keys);
  });

  it("keeps processing other candidates when one candidate fails", async () => {
    const keys = ["job-a", "job-b", "job-c"];
    const sessions = scheduledItems(keys);
    const process = vi.fn(async (id: string) => {
      if (id === "job-b") throw new Error("transient failure");
    });
    const engine = engineWith(sessions, process);

    await expect(engine.processBatch({ concurrency: 1 })).resolves.toEqual({
      scanned: 3,
      processed: 2,
      failed: 1,
    });
    expect(process.mock.calls.map(([id]) => id)).toEqual(keys);
  });

  it("bounds concurrent processing to four candidates", async () => {
    const keys = Array.from({ length: 8 }, (_, index) => `job-${index}`);
    const sessions = scheduledItems(keys);
    let active = 0;
    let peak = 0;
    const process = vi.fn(async (_id: string) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    });
    const engine = engineWith(sessions, process);

    await expect(engine.processBatch({ concurrency: 20 })).resolves.toEqual({
      scanned: 8,
      processed: 8,
      failed: 0,
    });
    expect(peak).toBe(4);
  });

  it("caps a batch at 128 candidates even when larger limits are requested", async () => {
    const keys = Array.from({ length: 200 }, (_, index) => `job-${index}`);
    const sessions = scheduledItems(keys);
    let active = 0;
    let peak = 0;
    const process = vi.fn(async (_id: string) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
    });
    const engine = engineWith(sessions, process);

    await expect(
      engine.processBatch({ maxCandidates: 999, concurrency: 999 }),
    ).resolves.toEqual({ scanned: 128, processed: 128, failed: 0 });
    expect(process).toHaveBeenCalledTimes(128);
    expect(peak).toBe(4);
    expect(sessions.takeJobCandidates.mock.calls).toHaveLength(32);
    expect(
      sessions.takeJobCandidates.mock.calls.every(([limit]) => limit <= 4),
    ).toBe(true);
    expect(
      sessions.takeJobCandidates.mock.calls.reduce(
        (total, [limit]) => total + limit,
        0,
      ),
    ).toBe(128);
  });

  it("does not claim more work after the time budget expires", async () => {
    const keys = ["job-a", "job-b", "job-c"];
    const sessions = scheduledItems(keys);
    const process = vi.fn(async (_id: string) => undefined);
    const engine = engineWith(sessions, process);
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    process.mockImplementationOnce(async () => {
      now = 20;
    });

    try {
      await expect(
        engine.processBatch({ concurrency: 1, budgetMs: 15 }),
      ).resolves.toEqual({ scanned: 1, processed: 1, failed: 0 });
      expect(process.mock.calls.map(([id]) => id)).toEqual(["job-a"]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("finishes a claimed wave after the budget expires and resumes with the remaining candidates", async () => {
    const keys = Array.from({ length: 8 }, (_, index) => `job-${index}`);
    const sessions = scheduledItems(keys);
    let now = 0;
    let expireBudget = true;
    const process = vi.fn(async (_id: string) => {
      if (expireBudget) now = 100;
    });
    const engine = engineWith(sessions, process);
    vi.spyOn(Date, "now").mockImplementation(() => now);

    try {
      await expect(engine.processBatch({ budgetMs: 5 })).resolves.toEqual({
        scanned: 4,
        processed: 4,
        failed: 0,
      });
      expect(process.mock.calls.map(([id]) => id)).toEqual(keys.slice(0, 4));

      expireBudget = false;
      await expect(engine.processBatch({ budgetMs: 50 })).resolves.toEqual({
        scanned: 4,
        processed: 4,
        failed: 0,
      });
      expect(process.mock.calls.map(([id]) => id)).toEqual(keys);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("continues past a thousand entries across repository instances and leaves claimed entries durable", async () => {
    const savedCheckpoint = await saveCheckpoint();
    const keys = await putDummyJobs(`test-${crypto.randomUUID()}`, 1105);
    const claimed = new Set<string>();
    try {
      for (let page = 0; page < 20 && claimed.size < keys.length; page++) {
        const repo = new CompanionSessions(env.DOCUMENTS);
        for (const key of await repo.takeJobCandidates(128)) claimed.add(key);
      }
      expect(keys.every((key) => claimed.has(key))).toBe(true);
      expect(
        (await Promise.all(keys.map((key) => env.DOCUMENTS.head(key)))).every(
          Boolean,
        ),
      ).toBe(true);
    } finally {
      await deleteKeys(keys);
      await restoreCheckpoint(savedCheckpoint);
    }
  }, 45000);

  it("gives concurrent scans disjoint ranges and keeps their index entries", async () => {
    const savedCheckpoint = await saveCheckpoint();
    const keys = await putDummyJobs(`test-${crypto.randomUUID()}`, 100);
    try {
      const [first, second] = await Promise.all([
        new CompanionSessions(env.DOCUMENTS).takeJobCandidates(32),
        new CompanionSessions(env.DOCUMENTS).takeJobCandidates(32),
      ]);
      expect(first.length).toBeGreaterThan(0);
      expect(second.length).toBeGreaterThan(0);
      expect(first.filter((key) => second.includes(key))).toEqual([]);
      expect(
        (
          await Promise.all(
            [...first, ...second].map((key) => env.DOCUMENTS.head(key)),
          )
        ).every(Boolean),
      ).toBe(true);
    } finally {
      await deleteKeys(keys);
      await restoreCheckpoint(savedCheckpoint);
    }
  }, 45000);

  it("continues after its saved key is deleted and wraps at the end of the index", async () => {
    const savedCheckpoint = await saveCheckpoint();
    const directory = `test-${crypto.randomUUID()}`;
    const [cursorKey, nextKey] = await putDummyJobs(directory, 2);
    try {
      await env.DOCUMENTS.put(
        checkpointKey,
        JSON.stringify({ after: cursorKey, revision: crypto.randomUUID() }),
      );
      await env.DOCUMENTS.delete(cursorKey);
      await expect(
        new CompanionSessions(env.DOCUMENTS).takeJobCandidates(1),
      ).resolves.toContain(nextKey);

      await env.DOCUMENTS.put(
        checkpointKey,
        JSON.stringify({
          after: `${queuePrefix}zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz`,
          revision: crypto.randomUUID(),
        }),
      );
      const wrapped = await new CompanionSessions(
        env.DOCUMENTS,
      ).takeJobCandidates(128);
      expect(wrapped).toContain(nextKey);
    } finally {
      await deleteKeys([cursorKey, nextKey]);
      await restoreCheckpoint(savedCheckpoint);
    }
  }, 45000);

  it("isolates a damaged manifest and processes the remaining candidates", async () => {
    const keys = ["job-a", "job-b", "job-c"];
    const sessions = scheduledItems(keys);
    sessions.readInternal.mockImplementation(async (_access, id) => {
      if (id === "job-b") throw new Error("damaged manifest");
      return {
        id,
        job: {
          runId: "00000000-0000-4000-8000-000000000001",
          status: "queued",
          lease: null,
        },
      };
    });
    const process = vi.fn(async (_id: string) => undefined);
    const engine = engineWith(sessions, process);

    await expect(engine.processBatch({ concurrency: 1 })).resolves.toEqual({
      scanned: 3,
      processed: 2,
      failed: 1,
    });
    expect(process.mock.calls.map(([id]) => id)).toEqual(["job-a", "job-c"]);
  });
});
