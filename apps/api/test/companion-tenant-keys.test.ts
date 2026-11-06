import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";
import { CompanionRecordings } from "../src/companion/recordings";
import { opusFixtureBase64 } from "./fixtures/companion-tone";
const sample = (id: string) => ({
  id,
  source: "system" as const,
  audio: { data: opusFixtureBase64, format: "ogg" as const },
  consent: true as const,
});
describe("recording tenant credential boundaries", () => {
  it("denies foreign tenants and legacy records while keeping owner session access", async () => {
    const repo = new CompanionRecordings(env.DOCUMENTS),
      ownerId = crypto.randomUUID();
    const a = { ownerId, tenantId: 1, requireTenant: true },
      b = { ownerId, tenantId: 2, requireTenant: true };
    const id = crypto.randomUUID(),
      legacy = crypto.randomUUID();
    await repo.save(a, sample(id));
    await repo.save(ownerId, sample(legacy));
    expect((await repo.list(a)).recordings.map((r) => r.id)).toEqual([id]);
    expect((await repo.list(b)).recordings).toEqual([]);
    expect((await repo.list(ownerId)).recordings).toHaveLength(2);
    for (const access of [b, { ...a, ownerId: crypto.randomUUID() }]) {
      await expect(repo.getAudio(access, id)).rejects.toThrow(
        "Recording not found",
      );
      await expect(repo.getNotes(access, id)).rejects.toThrow(
        "Recording not found",
      );
      await expect(repo.remove(access, id)).rejects.toThrow(
        "Recording not found",
      );
    }
    await expect(repo.getAudio(a, legacy)).rejects.toThrow(
      "Recording not found",
    );
    expect((await repo.getAudio(a, id)).bytes.length).toBeGreaterThan(0);
    await expect(repo.save(b, sample(id))).rejects.toThrow("different");
  });
  it("retains a continuation cursor when a bounded page has no tenant matches", async () => {
    const repo = new CompanionRecordings(env.DOCUMENTS),
      ownerId = crypto.randomUUID();
    for (let n = 0; n < 51; n++)
      await repo.save(
        { ownerId, tenantId: 2, requireTenant: true },
        sample(crypto.randomUUID()),
      );
    const page = await repo.list({ ownerId, tenantId: 1, requireTenant: true });
    expect(page.recordings).toEqual([]);
    expect(page.cursor).not.toBeNull();
  });
});
