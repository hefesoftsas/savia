import { describe, expect, it } from "vitest";
import { PageSaveQueue } from "./save-queue";

describe("page autosave", () => {
  it("serializes edits and uses the acknowledged version for the newer draft", async () => {
    let release!: () => void;
    const calls: Array<[string, number]> = [];
    const queue = new PageSaveQueue(3, async (draft: string, version) => {
      calls.push([draft, version]);
      if (calls.length === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return { version: version + 1 };
    });
    const first = queue.save("first");
    const second = queue.save("second");
    expect(calls).toEqual([["first", 3]]);
    release();
    await Promise.all([first, second]);
    expect(calls).toEqual([
      ["first", 3],
      ["second", 4],
    ]);
  });
  it("stops queued writes after a conflict instead of overwriting newer server data", async () => {
    let calls = 0;
    const queue = new PageSaveQueue(3, async () => {
      calls++;
      throw new Error("conflict");
    });
    await expect(queue.save("draft")).rejects.toThrow("conflict");
    await expect(queue.save("newer draft")).rejects.toThrow("conflict");
    expect(calls).toBe(1);
  });
});
