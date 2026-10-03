import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { CompanionSessions } from "../src/companion/sessions";
import { CompanionSessionJobs } from "../src/companion/session-jobs";
import type { CompanionService } from "../src/companion/service";
import type { EffectiveAssistantConfiguration } from "../src/assistant/configuration";
import { m4aSegmentBase64 } from "./fixtures/companion-m4a";

it("accepts 120 independently readable mobile AAC segments across one hour and processes them durably", async () => {
  const sessions = new CompanionSessions(env.DOCUMENTS);
  const access = {
    ownerId: crypto.randomUUID(),
    tenantId: 31,
    requireTenant: true,
  };
  const id = crypto.randomUUID();
  await sessions.create(access, {
    id,
    name: "Synthetic hour",
    sources: ["microphone"],
    consent: true,
  });
  for (let sequence = 0; sequence < 120; sequence++)
    await sessions.putChunk(access, id, {
      source: "microphone",
      sequence,
      startSeconds: sequence * 30,
      audio: { data: m4aSegmentBase64, format: "m4a" },
    });
  const ready = await sessions.finalize(access, id, {
    expectedChunks: 120,
    durationSeconds: 3600,
  });
  expect(ready.chunks).toHaveLength(120);
  const audio = await sessions.getAudio(access, id, "microphone", 119);
  expect(audio.format).toBe("m4a");
  expect(audio.startSeconds).toBe(3570);
  const transcribeRecording = vi.fn(async () => ({
    text: "Synthetic test transcript",
    source: "microphone",
    model: "fixture",
    durationSeconds: 30,
  }));
  const jobs = new CompanionSessionJobs(
    sessions,
    { transcribeRecording } as unknown as CompanionService,
    async () => ({}) as EffectiveAssistantConfiguration,
  );
  await sessions.requestProcessing(access, id, { consent: true });
  await jobs.process(access, id);
  expect(transcribeRecording).toHaveBeenCalledOnce();
  expect(transcribeRecording.mock.calls[0]).toBeDefined();
  expect((await sessions.get(access, id)).job.completedChunks).toBe(1);
  await sessions.cancelProcessing(access, id);
  await expect(
    sessions.requestProcessing(access, id, { consent: true }),
  ).rejects.toMatchObject({ code: "PROCESSING_RECONCILIATION_REQUIRED" });
  await sessions.requestProcessing(access, id, {
    consent: true,
    retryAmbiguous: true,
  });
  expect((await sessions.get(access, id)).job.completedChunks).toBe(1);
}, 30000);

it("cannot remove a consented retry by cleaning up the previous processing run", async () => {
  const sessions = new CompanionSessions(env.DOCUMENTS);
  const access = {
    ownerId: crypto.randomUUID(),
    tenantId: 31,
    requireTenant: true,
  };
  const id = crypto.randomUUID();
  await sessions.create(access, {
    id,
    name: "Retry race",
    sources: ["microphone"],
    consent: true,
  });
  await sessions.putChunk(access, id, {
    source: "microphone",
    sequence: 0,
    startSeconds: 0,
    audio: { data: m4aSegmentBase64, format: "m4a" },
  });
  await sessions.finalize(access, id, {
    expectedChunks: 1,
    durationSeconds: 30,
  });
  await sessions.requestProcessing(access, id, { consent: true });
  const old = await sessions.readInternal(access, id);
  await sessions.cancelProcessing(access, id);
  await sessions.requestProcessing(access, id, {
    consent: true,
    retryAmbiguous: true,
  });
  const retried = await sessions.readInternal(access, id);
  expect(retried.job.runId).not.toBe(old.job.runId);
  await sessions.deleteSchedule(access, id, old.job.runId);
  const scheduled = await Promise.all(
    (await sessions.listJobCandidates()).map((key) =>
      sessions.readSchedule(key),
    ),
  );
  expect(
    scheduled.some(
      (item) => item?.id === id && item.runId === retried.job.runId,
    ),
  ).toBe(true);
});

it("revalidates workspace membership before submitting consented audio to the provider", async () => {
  const sessions = new CompanionSessions(env.DOCUMENTS);
  const access = {
    ownerId: crypto.randomUUID(),
    tenantId: 31,
    requireTenant: true,
  };
  const id = crypto.randomUUID();
  await sessions.create(access, {
    id,
    name: "Revoked membership",
    sources: ["microphone"],
    consent: true,
  });
  await sessions.putChunk(access, id, {
    source: "microphone",
    sequence: 0,
    startSeconds: 0,
    audio: { data: m4aSegmentBase64, format: "m4a" },
  });
  await sessions.finalize(access, id, {
    expectedChunks: 1,
    durationSeconds: 30,
  });
  await sessions.requestProcessing(access, id, { consent: true });
  const transcribeRecording = vi.fn();
  const configuration = vi.fn(async () => {
    throw new Error("Membership no longer active");
  });
  await new CompanionSessionJobs(
    sessions,
    { transcribeRecording } as unknown as CompanionService,
    configuration,
  ).process(access, id);
  expect(configuration).toHaveBeenCalledWith(access.ownerId, 31);
  expect(transcribeRecording).not.toHaveBeenCalled();
  expect((await sessions.get(access, id)).job.status).toBe("needs_attention");
});
