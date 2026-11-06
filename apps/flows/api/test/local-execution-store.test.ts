import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, expect, it } from "vitest";
import { CloudflareExecutionStore } from "../src/runtime/cloudflare-execution-store";
import type { Bindings } from "../src/context";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

it("persists local execution history without Analytics Engine and scopes reads to the tenant", async () => {
  const store = new CloudflareExecutionStore({
    ...env,
    SAVIA_FLOWS_LOCAL_ONLY: "true",
  } as unknown as Bindings);
  await store.save({
    id: "0199ebec-7eae-7000-8000-000000000001",
    workflowId: "0199ebec-7eae-7000-8000-000000000002",
    workflowName: "Local addition",
    organizationId: "tenant:101",
    userId: "user-1",
    status: "completed",
    startedAt: new Date("2026-10-12T00:00:00Z"),
    endedAt: new Date("2026-10-12T00:00:01Z"),
    nodeExecutions: [],
    definitionHash: "pinned-definition",
    rehearsal: true,
  });
  const freshStore = new CloudflareExecutionStore({
    ...env,
    SAVIA_FLOWS_LOCAL_ONLY: "true",
  } as unknown as Bindings);
  const listed = await freshStore.list("tenant:101");
  expect(listed).toHaveLength(1);
  expect(listed[0].workflowName).toBe("Local addition");
  expect(listed[0].startedAt?.toISOString()).toBe("2026-10-12T00:00:00.000Z");
  expect(listed[0].definitionHash).toBe("pinned-definition");
  expect(listed[0].rehearsal).toBe(true);
  expect(await freshStore.list("tenant:202")).toEqual([]);
  expect(
    await freshStore.getWithData(listed[0].id, "tenant:202"),
  ).toBeUndefined();
  expect(
    (await freshStore.getWithData(listed[0].id, "tenant:101"))?.data.status,
  ).toBe("completed");
});

it("updates one local execution receipt and filters history without interpolating input into SQL", async () => {
  const store = new CloudflareExecutionStore({
    ...env,
    SAVIA_FLOWS_LOCAL_ONLY: "true",
  } as unknown as Bindings);
  const record = {
    id: "0199ebec-7eae-7000-8000-000000000003",
    workflowId: "0199ebec-7eae-7000-8000-000000000004",
    workflowName: "Resume",
    organizationId: "tenant:101",
    userId: "user-1",
    nodeExecutions: [],
  };
  await store.save({ ...record, status: "executing" });
  await store.save({ ...record, status: "completed" });
  expect(
    await store.list("tenant:101", {
      workflowId: record.workflowId,
      status: "executing",
    }),
  ).toEqual([]);
  expect(
    await store.list("tenant:101", {
      workflowId: record.workflowId,
      status: "completed",
    }),
  ).toHaveLength(1);
  expect(await store.list("tenant:101", { workflowId: "' OR 1=1 --" })).toEqual(
    [],
  );
});
