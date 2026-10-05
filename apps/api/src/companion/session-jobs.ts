import type { EffectiveAssistantConfiguration } from "../assistant/configuration";
import { CompanionError, type CompanionService } from "./service";
import { CompanionSessions, chunkIdentity } from "./sessions";
import type { RecordingAccess } from "./recordings";

type ResolveConfiguration = (
  ownerId: string,
  tenantId?: number,
) => Promise<EffectiveAssistantConfiguration>;

/** Durable bounded worker for consented session transcription and summaries. */
export class CompanionSessionJobs {
  constructor(
    private readonly sessions: CompanionSessions,
    private readonly service: CompanionService,
    private readonly resolveConfiguration: ResolveConfiguration,
    private readonly options: { leaseSeconds?: number } = {},
  ) {}

  /** Compatibility helper for callers that explicitly request a single operation. */
  async processOne(): Promise<{ processed: boolean; sessionId?: string }> {
    const candidates = await this.sessions.listJobCandidates();
    for (const key of candidates) {
      const sessionId = await this.processCandidate(key);
      if (sessionId) return { processed: true, sessionId };
    }
    return { processed: false };
  }

  /** Rotate through candidates with bounded dispatch and parallel provider calls. */
  async processBatch(
    options: {
      maxCandidates?: number;
      concurrency?: number;
      budgetMs?: number;
    } = {},
  ): Promise<{ scanned: number; processed: number; failed: number }> {
    const bounded = (
      value: number | undefined,
      fallback: number,
      max: number,
      min = 1,
    ) =>
      value !== undefined && Number.isFinite(value)
        ? Math.max(min, Math.min(max, Math.floor(value)))
        : fallback;
    const deadline = Date.now() + bounded(options.budgetMs, 45_000, 45_000, 0);
    const maximum = bounded(options.maxCandidates, 32, 128);
    const concurrency = bounded(options.concurrency, 4, 4);
    const report = { scanned: 0, processed: 0, failed: 0 };
    while (report.scanned < maximum && Date.now() < deadline) {
      // Claim only a wave we can start. Advancing over undispatched entries could
      // repeatedly starve the same tail when the time budget expires each tick.
      const candidates = await this.sessions.takeJobCandidates(
        Math.min(concurrency, maximum - report.scanned),
      );
      if (!candidates.length) break;
      report.scanned += candidates.length;
      await Promise.all(
        candidates.map(async (key) => {
          try {
            if (await this.processCandidate(key)) report.processed++;
          } catch {
            // Keep the index entry for another sweep; never leak private job data.
            report.failed++;
          }
        }),
      );
    }
    return report;
  }

  private async processCandidate(key: string): Promise<string | null> {
    const item = await this.sessions.readSchedule(key);
    if (!item) return null;
    const before = await this.sessions
      .readInternal(item.access, item.id)
      .catch((error) => {
        if (error instanceof CompanionError && error.status === 404)
          return null;
        throw error;
      });
    if (before && before.job.runId !== item.runId) {
      await this.sessions.deleteSchedule(item.access, item.id, item.runId);
      return null;
    }
    if (
      !before ||
      !["queued", "transcribing", "summarizing"].includes(before.job.status)
    ) {
      await this.sessions.deleteSchedule(item.access, item.id, item.runId);
      return null;
    }
    if (before.job.lease && Date.parse(before.job.lease.expiresAt) > Date.now())
      return null;
    await this.process(item.access, item.id);
    return item.id;
  }

  /** One call persists at most one transcript or one summary reduction. */
  async process(access: RecordingAccess, id: string): Promise<void> {
    const token = crypto.randomUUID();
    const leaseSeconds = Math.max(
      30,
      Math.min(this.options.leaseSeconds ?? 150, 300),
    );
    let claimed:
      Awaited<ReturnType<CompanionSessions["readInternal"]>> | undefined;
    try {
      claimed = await this.sessions.writeJob(access, id, (manifest) => {
        const { job } = manifest;
        if (
          [
            "complete",
            "cancelled",
            "failed",
            "idle",
            "needs_attention",
          ].includes(job.status)
        )
          return manifest;
        if (job.lease && Date.parse(job.lease.expiresAt) > Date.now())
          return manifest;
        if (job.lease?.providerStarted) {
          job.lease = null;
          job.status = "needs_attention";
          job.error = "PROVIDER_OUTCOME_UNKNOWN";
          return manifest;
        }
        const nextChunk = manifest.chunks
          .slice()
          .sort(
            (a, b) =>
              a.startSeconds - b.startSeconds ||
              a.source.localeCompare(b.source) ||
              a.sequence - b.sequence,
          )
          .find(
            (chunk) =>
              !job.transcripts[chunkIdentity(chunk.source, chunk.sequence)],
          );
        const phase = nextChunk ? "transcribe" : "summarize";
        const chunkKey = nextChunk
          ? chunkIdentity(nextChunk.source, nextChunk.sequence)
          : undefined;
        job.status = phase === "transcribe" ? "transcribing" : "summarizing";
        job.lease = {
          token,
          expiresAt: new Date(Date.now() + leaseSeconds * 1000).toISOString(),
          phase,
          ...(chunkKey ? { chunkKey } : {}),
          providerStarted: false,
        };
        job.totalChunks = manifest.chunks.length;
        if (phase === "summarize" && job.summaryWork.length === 0) {
          const batches: Array<{
            source: "microphone" | "system";
            text: string;
          }> = [];
          for (const source of manifest.sources) {
            let active:
              { source: "microphone" | "system"; text: string } | undefined;
            const timeline = manifest.chunks
              .filter((chunk) => chunk.source === source)
              .sort(
                (a, b) =>
                  a.startSeconds - b.startSeconds || a.sequence - b.sequence,
              );
            for (const chunk of timeline) {
              const text =
                job.transcripts[chunkIdentity(chunk.source, chunk.sequence)]
                  ?.text ?? "";
              if (!text) continue;
              const addition = `[${chunk.startSeconds.toFixed(2)}s] ${text}`;
              if (!active || active.text.length + addition.length + 1 > 60000) {
                active = { source, text: addition };
                batches.push(active);
              } else {
                active.text += `\n${addition}`;
              }
            }
          }
          job.summaryWork = batches;
        }
        return manifest;
      });
      if (!claimed.job.lease || claimed.job.lease.token !== token) {
        if (
          [
            "needs_attention",
            "cancelled",
            "complete",
            "failed",
            "idle",
          ].includes(claimed.job.status)
        )
          await this.sessions
            .deleteSchedule(access, id, claimed?.job.runId ?? null)
            .catch(() => {});
        return;
      }
      const lease = claimed.job.lease;
      const config = await this.resolveConfiguration(
        access.ownerId,
        access.tenantId,
      );
      if (lease.phase === "transcribe") {
        const chunk = claimed.chunks.find(
          (candidate) =>
            chunkIdentity(candidate.source, candidate.sequence) ===
            lease.chunkKey,
        );
        if (!chunk)
          throw new CompanionError(
            "STORAGE_INVALID_RECORD",
            "Queued session chunk is missing.",
            503,
          );
        const audio = await this.sessions.getAudio(
          access,
          id,
          chunk.source,
          chunk.sequence,
        );
        const base64 = this.encodeBase64(audio.bytes);
        const started = await this.markProviderStarted(access, id, token);
        if (!started) return;
        const transcript =
          audio.format === "m4a"
            ? await this.service.transcribeRecording(config, {
                bytes: audio.bytes,
                format: "m4a",
                source: chunk.source,
                durationSeconds: chunk.durationSeconds,
                language:
                  claimed.job.language === "auto"
                    ? undefined
                    : (claimed.job.language ?? "es"),
              })
            : await this.service.transcribe(config, {
                source: chunk.source,
                audio: { data: base64, format: "ogg" },
                language:
                  claimed.job.language === "auto"
                    ? undefined
                    : (claimed.job.language ?? "es"),
                consent: true,
              });
        await this.sessions.writeJob(access, id, (manifest) => {
          if (
            manifest.job.lease?.token !== token ||
            manifest.job.status === "cancelled"
          )
            return manifest;
          manifest.job.transcripts[
            chunkIdentity(chunk.source, chunk.sequence)
          ] = transcript;
          manifest.job.completedChunks = Object.keys(
            manifest.job.transcripts,
          ).length;
          manifest.job.lease = null;
          manifest.job.error = undefined;
          manifest.job.status =
            manifest.job.completedChunks >= manifest.chunks.length
              ? "summarizing"
              : "queued";
          return manifest;
        });
      } else {
        const work = claimed.job.summaryWork;
        if (!work.length) {
          await this.sessions.writeJob(access, id, (manifest) => {
            if (manifest.job.lease?.token === token) {
              manifest.job.status = "failed";
              manifest.job.error = "NO_TRANSCRIPTS";
              manifest.job.lease = null;
            }
            return manifest;
          });
          return;
        }
        const final = work.length === 1;
        const inputs = final ? work : work.slice(0, 2);
        const started = await this.markProviderStarted(access, id, token);
        if (!started) return;
        const result = await this.service.summarize(config, {
          transcripts: inputs.map((transcript) => ({
            source: transcript.source,
            text: transcript.text,
          })),
          consent: true,
        });
        await this.sessions.writeJob(access, id, (manifest) => {
          if (
            manifest.job.lease?.token !== token ||
            manifest.job.status === "cancelled"
          )
            return manifest;
          manifest.job.lease = null;
          manifest.job.error = undefined;
          if (final) {
            manifest.job.summary = result;
            manifest.job.status = "complete";
            manifest.job.summaryWork = [];
          } else {
            manifest.job.summaryWork = [
              { source: inputs[0].source, text: JSON.stringify(result) },
              ...work.slice(2),
            ];
            manifest.job.status = "summarizing";
          }
          return manifest;
        });
      }
      const after = await this.sessions.readInternal(access, id);
      if (
        ["complete", "cancelled", "failed", "needs_attention"].includes(
          after.job.status,
        )
      )
        await this.sessions.deleteSchedule(
          access,
          id,
          claimed?.job.runId ?? null,
        );
    } catch (error) {
      await this.sessions
        .writeJob(access, id, (manifest) => {
          if (manifest.job.lease?.token !== token) return manifest;
          manifest.job.lease = null;
          if (manifest.job.status !== "cancelled") {
            manifest.job.status = "needs_attention";
            manifest.job.error =
              error instanceof CompanionError
                ? error.code.slice(0, 80)
                : "PROCESSING_FAILED";
          }
          return manifest;
        })
        .catch(() => {});
      const after = await this.sessions
        .readInternal(access, id)
        .catch(() => null);
      if (
        !after ||
        ["needs_attention", "cancelled", "complete", "failed"].includes(
          after.job.status,
        )
      )
        await this.sessions
          .deleteSchedule(access, id, claimed?.job.runId ?? null)
          .catch(() => {});
    }
  }

  private async markProviderStarted(
    access: RecordingAccess,
    id: string,
    token: string,
  ) {
    const result = await this.sessions.writeJob(access, id, (manifest) => {
      if (
        manifest.job.lease?.token !== token ||
        manifest.job.status === "cancelled"
      )
        return manifest;
      manifest.job.lease.providerStarted = true;
      manifest.job.lease.expiresAt = new Date(
        Date.now() + 150_000,
      ).toISOString();
      return manifest;
    });
    return (
      result.job.status !== "cancelled" &&
      result.job.lease?.token === token &&
      result.job.lease.providerStarted
    );
  }

  private encodeBase64(bytes: Uint8Array) {
    let binary = "";
    const step = 0x6000;
    for (let offset = 0; offset < bytes.length; offset += step)
      binary += String.fromCharCode(
        ...bytes.subarray(offset, Math.min(offset + step, bytes.length)),
      );
    return btoa(binary);
  }
}
