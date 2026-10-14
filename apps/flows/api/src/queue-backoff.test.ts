import { describe, expect, it } from "vitest";
import { queueExecutionId, queueRetryDelaySeconds } from "./queue-backoff";

describe("Flows queue backoff", () => {
  it("uses 60-second exponential delays and caps them at one hour", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 100].map(queueRetryDelaySeconds)).toEqual([
      60, 120, 240, 480, 960, 1920, 3600, 3600, 3600,
    ]);
    expect(queueRetryDelaySeconds(0)).toBe(60);
    expect(queueRetryDelaySeconds(Number.NaN)).toBe(60);
  });

  it("derives a stable, workflow-specific runtime execution ID", async () => {
    const first = await queueExecutionId("queue-message", "workflow-a");
    expect(first).toBe(await queueExecutionId("queue-message", "workflow-a"));
    expect(first).toMatch(/^savia-[a-f0-9]{40}$/);
    expect(await queueExecutionId("queue-message", "workflow-b")).not.toBe(
      first,
    );
  });
});
