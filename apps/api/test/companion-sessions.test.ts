import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { opusFixture } from "./fixtures/companion-tone";
import { CompanionSessions } from "../src/companion/sessions";
import { CompanionSessionJobs } from "../src/companion/session-jobs";
import {
  CompanionError,
  type CompanionService,
} from "../src/companion/service";
import type { RecordingAccess } from "../src/companion/recordings";
import type { EffectiveAssistantConfiguration } from "../src/assistant/configuration";

const fixture = opusFixture();
const data = btoa(
  Array.from(fixture, (byte) => String.fromCharCode(byte)).join(""),
);
const chunk = (sequence = 0, startSeconds = 0) => ({
  source: "microphone" as const,
  sequence,
  startSeconds,
  audio: { data, format: "ogg" as const },
});
const clean = async (owner: string, tenantId?: number) => {
  const prefixBytes = new TextEncoder().encode(`${owner}\0${tenantId ?? ""}`);
  const prefixHash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", prefixBytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const prefix = `companion/sessions/${prefixHash}/`;
  let cursor: string | undefined;
  do {
    const result = await env.DOCUMENTS.list({ prefix, limit: 1000, cursor });
    if (result.objects.length)
      await env.DOCUMENTS.delete(result.objects.map((object) => object.key));
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
};
const ownerAccess = (ownerId: string, tenantId?: number): RecordingAccess => ({
  ownerId,
  ...(tenantId !== undefined ? { tenantId } : {}),
  requireTenant: tenantId !== undefined,
});

describe("private Companion sessions", () => {
  it("keeps tenant namespaces isolated and makes same-byte chunk retries idempotent", async () => {
    const owner = crypto.randomUUID();
    const id = crypto.randomUUID();
    const one = ownerAccess(owner, 101);
    const two = ownerAccess(owner, 202);
    const repo = new CompanionSessions(env.DOCUMENTS);
    try {
      await repo.create(one, {
        id,
        name: "Interview",
        sources: ["microphone"],
        consent: true,
      });
      await repo.create(two, {
        id,
        name: "Other interview",
        sources: ["microphone"],
        consent: true,
      });
      const saved = await repo.putChunk(one, id, chunk());
      const retried = await repo.putChunk(one, id, chunk());
      expect(retried.chunks).toEqual(saved.chunks);
      await expect(repo.get(two, id)).resolves.toMatchObject({
        name: "Other interview",
        chunks: [],
      });
      await expect(repo.get(ownerAccess(owner, 303), id)).rejects.toMatchObject(
        { status: 404 },
      );
      await expect(
        repo.putChunk(one, id, { ...chunk(), startSeconds: 1 }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        repo.getAudio(two, id, "microphone", 0),
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      await clean(owner, 101);
      await clean(owner, 202);
    }
  });

  it("rejects partial or noncontiguous uploads and locks chunks after finalization", async () => {
    const owner = crypto.randomUUID();
    const access = ownerAccess(owner, 77);
    const id = crypto.randomUUID();
    const repo = new CompanionSessions(env.DOCUMENTS);
    try {
      await repo.create(access, {
        id,
        name: "Draft",
        sources: ["microphone"],
        consent: true,
      });
      await repo.putChunk(access, id, chunk(1, 2));
      await expect(
        repo.finalize(access, id, { expectedChunks: 2, durationSeconds: 3 }),
      ).rejects.toMatchObject({ code: "SESSION_INCOMPLETE" });
      await expect(
        repo.finalize(access, id, { expectedChunks: 1, durationSeconds: 3 }),
      ).rejects.toMatchObject({ code: "SESSION_INCOMPLETE" });
    } finally {
      await clean(owner, 77);
    }
  });

  it("paginates sessions by directory when one workspace has over a thousand chunk objects", async () => {
    const owner = crypto.randomUUID();
    const access = ownerAccess(owner, 78);
    const repo = new CompanionSessions(env.DOCUMENTS);
    const ids = Array.from({ length: 55 }, () => crypto.randomUUID());
    const ownerPrefixBytes = new TextEncoder().encode(
      `${owner}\0${access.tenantId}`,
    );
    const ownerHash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", ownerPrefixBytes)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const storagePrefix = `companion/sessions/${ownerHash}/`;
    try {
      await Promise.all(
        ids.map((id, index) =>
          repo.create(access, {
            id,
            name: `Session ${index}`,
            sources: ["microphone"],
            consent: true,
          }),
        ),
      );
      for (let batch = 0; batch < 11; batch++) {
        await Promise.all(
          Array.from({ length: 100 }, (_, index) => {
            const sequence = batch * 100 + index;
            return env.DOCUMENTS.put(
              `${storagePrefix}bulk/chunks/${sequence}.ogg`,
              "fixture",
            );
          }),
        );
      }
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await repo.list(access, cursor);
        seen.push(...page.sessions.map((session) => session.id));
        cursor = page.cursor ?? undefined;
      } while (cursor);
      expect(new Set(seen)).toEqual(new Set(ids));
    } finally {
      await clean(owner, 78);
    }
  }, 45000);

  it("persists an ambiguous provider outcome and requires explicit retry consent", async () => {
    const owner = crypto.randomUUID();
    const access = ownerAccess(owner, 88);
    const id = crypto.randomUUID();
    const repo = new CompanionSessions(env.DOCUMENTS);
    let transcribeCalls = 0;
    const fakeService = {
      async transcribe() {
        transcribeCalls++;
        if (transcribeCalls === 1)
          throw new CompanionError(
            "PROVIDER_TIMEOUT",
            "Provider outcome unknown.",
            504,
          );
        return {
          text: "The session has started.",
          source: "microphone",
          model: "test/model",
          durationSeconds: 0.1,
        };
      },
      async summarize() {
        return {
          summary: "A session began.",
          decisions: [],
          actions: [],
          openQuestions: [],
        };
      },
    } as unknown as CompanionService;
    const engine = new CompanionSessionJobs(
      repo,
      fakeService,
      async () => ({}) as EffectiveAssistantConfiguration,
    );
    try {
      await repo.create(access, {
        id,
        name: "Processing",
        sources: ["microphone"],
        consent: true,
      });
      await repo.putChunk(access, id, chunk());
      await repo.finalize(access, id, {
        expectedChunks: 1,
        durationSeconds: 1,
      });
      await repo.requestProcessing(access, id, { consent: true });
      await engine.processOne();
      expect(await repo.get(access, id)).toMatchObject({
        job: {
          status: "needs_attention",
          completedChunks: 0,
          error: "PROVIDER_TIMEOUT",
        },
      });
      expect(await engine.processOne()).toEqual({ processed: false });
      expect(transcribeCalls).toBe(1);
      await expect(
        repo.requestProcessing(access, id, { consent: true }),
      ).rejects.toMatchObject({ code: "PROCESSING_RECONCILIATION_REQUIRED" });
      await repo.requestProcessing(access, id, {
        consent: true,
        retryAmbiguous: true,
      });
      await engine.processOne();
      await engine.processOne();
      expect(transcribeCalls).toBe(2);
      expect(await repo.get(access, id)).toMatchObject({
        job: {
          status: "complete",
          completedChunks: 1,
          summary: { summary: "A session began." },
        },
      });
    } finally {
      await clean(owner, 88);
    }
  }, 45000);

  it("lets one isolate own a lease when scheduled workers race", async () => {
    const owner = crypto.randomUUID();
    const access = ownerAccess(owner, 89);
    const id = crypto.randomUUID();
    const repo = new CompanionSessions(env.DOCUMENTS);
    let transcribeCalls = 0;
    const fakeService = {
      async transcribe() {
        transcribeCalls++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          text: "One durable transcript.",
          source: "microphone",
          model: "test/model",
          durationSeconds: 0.1,
        };
      },
      async summarize() {
        return {
          summary: "Done.",
          decisions: [],
          actions: [],
          openQuestions: [],
        };
      },
    } as unknown as CompanionService;
    const engineA = new CompanionSessionJobs(
      repo,
      fakeService,
      async () => ({}) as EffectiveAssistantConfiguration,
    );
    const engineB = new CompanionSessionJobs(
      repo,
      fakeService,
      async () => ({}) as EffectiveAssistantConfiguration,
    );
    try {
      await repo.create(access, {
        id,
        name: "Race",
        sources: ["microphone"],
        consent: true,
      });
      await repo.putChunk(access, id, chunk());
      await repo.finalize(access, id, {
        expectedChunks: 1,
        durationSeconds: 1,
      });
      await repo.requestProcessing(access, id, { consent: true });
      await Promise.all([engineA.processOne(), engineB.processOne()]);
      expect(transcribeCalls).toBe(1);
      expect(await repo.get(access, id)).toMatchObject({
        job: { completedChunks: 1, status: "summarizing" },
      });
    } finally {
      await clean(owner, 89);
    }
  });

  it("marks an expired in-flight lease for reconciliation and stops before a cancelled call", async () => {
    const owner = crypto.randomUUID();
    const access = ownerAccess(owner, 90);
    const id = crypto.randomUUID();
    const repo = new CompanionSessions(env.DOCUMENTS);
    let transcribeCalls = 0;
    const fakeService = {
      async transcribe() {
        transcribeCalls++;
        return {
          text: "Never called.",
          source: "microphone",
          model: "test/model",
          durationSeconds: 0.1,
        };
      },
      async summarize() {
        return {
          summary: "Done.",
          decisions: [],
          actions: [],
          openQuestions: [],
        };
      },
    } as unknown as CompanionService;
    try {
      await repo.create(access, {
        id,
        name: "Recovery",
        sources: ["microphone"],
        consent: true,
      });
      await repo.putChunk(access, id, chunk());
      await repo.finalize(access, id, {
        expectedChunks: 1,
        durationSeconds: 1,
      });
      await repo.requestProcessing(access, id, { consent: true });
      await repo.writeJob(access, id, (manifest) => {
        manifest.job.status = "transcribing";
        manifest.job.lease = {
          token: crypto.randomUUID(),
          expiresAt: new Date(0).toISOString(),
          phase: "transcribe",
          chunkKey: "microphone:0",
          providerStarted: true,
        };
        return manifest;
      });
      await new CompanionSessionJobs(
        repo,
        fakeService,
        async () => ({}) as EffectiveAssistantConfiguration,
      ).processOne();
      expect(await repo.get(access, id)).toMatchObject({
        job: { status: "needs_attention", error: "PROVIDER_OUTCOME_UNKNOWN" },
      });
      expect(transcribeCalls).toBe(0);

      const cancelId = crypto.randomUUID();
      await repo.create(access, {
        id: cancelId,
        name: "Cancel",
        sources: ["microphone"],
        consent: true,
      });
      await repo.putChunk(access, cancelId, chunk());
      await repo.finalize(access, cancelId, {
        expectedChunks: 1,
        durationSeconds: 1,
      });
      await repo.requestProcessing(access, cancelId, { consent: true });
      const engine = new CompanionSessionJobs(repo, fakeService, async () => {
        await repo.cancelProcessing(access, cancelId);
        return {} as EffectiveAssistantConfiguration;
      });
      await engine.processOne();
      expect(await repo.get(access, cancelId)).toMatchObject({
        job: { status: "cancelled" },
      });
      expect(transcribeCalls).toBe(0);
    } finally {
      await clean(owner, 90);
    }
  });
});
