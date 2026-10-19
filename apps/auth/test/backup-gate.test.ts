import { expect, it } from "vitest";
import worker from "../src/index";

const backupEnv = {
  SAVIA_BACKUP_GATE_REQUIRED: "true",
  BACKUP_GATE: {
    idFromName: (name: string) => ({ toString: () => `id:${name}` }),
    get: () => ({ fetch: async () => Response.json({}) }),
  },
} as never;

it("exposes backup barrier capability without initializing the auth database", async () => {
  const response = await worker.fetch(
    new Request("https://auth.internal/_internal/savia-backup-capability"),
    backupEnv,
    {} as ExecutionContext,
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    version: 1,
    required: true,
    gateId: "id:production-backup-v1",
  });
});

it("fails closed when the backup gate is required but not bound", async () => {
  await expect(
    worker.fetch(
      new Request("https://auth.internal/health"),
      { SAVIA_BACKUP_GATE_REQUIRED: "true" } as never,
      {} as ExecutionContext,
    ),
  ).rejects.toThrow("BACKUP_GATE binding is required");
});
