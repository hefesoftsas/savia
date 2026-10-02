import { env } from "cloudflare:workers";
import { opusFixture } from "./fixtures/companion-tone";
import { describe, expect, it } from "vitest";
import { CompanionRecordings } from "../src/companion/recordings";
const bytes = opusFixture();
const data = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
const input = () => ({
  id: crypto.randomUUID(),
  source: "system" as const,
  audio: { data, format: "ogg" as const },
  consent: true as const,
});
function importedWav(seconds = 75) {
  const dataBytes = seconds * 16000 * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const put = (offset: number, value: string) =>
    Array.from(value).forEach((c, i) => (bytes[offset + i] = c.charCodeAt(0)));
  put(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  put(8, "WAVE");
  put(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  put(36, "data");
  view.setUint32(40, dataBytes, true);
  return bytes;
}
describe("private compressed Companion recordings", () => {
  it("stores imported long audio and round-trips its format, name, origin and unknown-capable duration", async () => {
    const repo = new CompanionRecordings(env.DOCUMENTS),
      owner = crypto.randomUUID(),
      id = crypto.randomUUID();
    const bytes = importedWav();
    try {
      const saved = await repo.saveImported(owner, {
        id,
        name: "Interview.wav",
        origin: "google_drive",
        bytes,
        format: "wav",
      });
      expect(saved).toMatchObject({
        source: "upload",
        format: "wav",
        bytes: bytes.length,
        durationSeconds: 75,
        name: "Interview.wav",
        origin: "google_drive",
      });
      const audio = await new CompanionRecordings(env.DOCUMENTS).getAudio(
        owner,
        id,
      );
      expect(audio).toMatchObject({
        source: "upload",
        format: "wav",
        durationSeconds: 75,
        name: "Interview.wav",
      });
      expect(audio.bytes.byteLength).toBe(bytes.byteLength);
      expect(audio.bytes[0]).toBe(bytes[0]);
      expect((await repo.list(owner)).recordings).toContainEqual(saved);
    } finally {
      await repo.remove(owner, id).catch(() => {});
    }
  }, 45000);
  it("hashes only the persisted bytes when importing a Uint8Array view", async () => {
    const repo = new CompanionRecordings(env.DOCUMENTS);
    const owner = crypto.randomUUID();
    const id = crypto.randomUUID();
    const fixture = opusFixture();
    const backing = new Uint8Array(fixture.length + 14).fill(0xa5);
    backing.set(fixture, 7);
    const view = backing.subarray(7, 7 + fixture.length);
    try {
      const saved = await repo.saveImported(owner, {
        id,
        name: "clip.ogg",
        origin: "local",
        bytes: view,
        format: "ogg",
      });
      const expected = new Uint8Array(
        await crypto.subtle.digest("SHA-256", fixture),
      );
      const sha256 = Array.from(expected, (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      expect(saved.sha256).toBe(sha256);
      expect((await repo.getAudio(owner, id)).bytes).toEqual(fixture);
    } finally {
      await repo.remove(owner, id).catch(() => {});
    }
  });
  it("stores compressed bytes, lists durable metadata, reads privately and deletes", async () => {
    const repo = new CompanionRecordings(env.DOCUMENTS),
      owner = crypto.randomUUID(),
      payload = input();
    try {
      const saved = await repo.save(owner, payload);
      expect(saved).toMatchObject({
        id: payload.id,
        source: "system",
        format: "ogg",
        bytes: bytes.length,
        durationSeconds: 0.1,
      });
      expect(
        (await new CompanionRecordings(env.DOCUMENTS).list(owner)).recordings,
      ).toEqual([saved]);
      const object = await repo.get(owner, payload.id);
      expect(new Uint8Array(await object.arrayBuffer())).toEqual(bytes);
      await expect(repo.get("different-owner", payload.id)).rejects.toThrow(
        "not found",
      );
      expect((await repo.list("different-owner")).recordings).toEqual([]);
      await expect(repo.remove("different-owner", payload.id)).rejects.toThrow(
        "not found",
      );
      await repo.remove(owner, payload.id);
      await expect(repo.get(owner, payload.id)).rejects.toThrow("not found");
    } finally {
      await repo.remove(owner, payload.id).catch(() => {});
    }
  });
  it("makes same-id retries idempotent and refuses conflicting contents", async () => {
    const repo = new CompanionRecordings(env.DOCUMENTS),
      owner = crypto.randomUUID(),
      payload = input();
    try {
      const first = await repo.save(owner, payload);
      expect(await repo.save(owner, payload)).toEqual(first);
      await expect(
        repo.save(owner, { ...payload, source: "microphone" }),
      ).rejects.toThrow("different sample");
      expect((await repo.list(owner)).recordings).toHaveLength(1);
    } finally {
      await repo.remove(owner, payload.id).catch(() => {});
    }
  });
  it("persists schema-checked notes beside an owner-private recording and removes them", async () => {
    const owner = crypto.randomUUID();
    const repo = new CompanionRecordings(env.DOCUMENTS);
    const payload = input();
    const notes = {
      transcript: {
        text: "Reviewed the launch date.",
        source: payload.source,
        model: "test/stt",
        durationSeconds: 0.1,
      },
      summary: {
        summary: "The team reviewed the launch date.",
        decisions: [],
        actions: [],
        openQuestions: [],
      },
    };
    try {
      await repo.save(owner, payload);
      await repo.storeNotes(owner, payload.id, notes);
      expect(
        await new CompanionRecordings(env.DOCUMENTS).getNotes(
          owner,
          payload.id,
        ),
      ).toEqual(notes);
      expect((await repo.list(owner)).recordings).toHaveLength(1);
      await expect(
        repo.getNotes("different-owner", payload.id),
      ).rejects.toThrow("not found");
      await repo.remove(owner, payload.id);
      await expect(repo.getNotes(owner, payload.id)).rejects.toThrow(
        "not found",
      );
      expect((await repo.list(owner)).recordings).toEqual([]);
    } finally {
      await repo.remove(owner, payload.id).catch(() => {});
    }
  });

  it("rejects malformed persisted notes instead of trusting cached provider output", async () => {
    const owner = crypto.randomUUID();
    const repo = new CompanionRecordings(env.DOCUMENTS);
    const payload = input();
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(owner),
    );
    const prefix = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const key = `companion/samples/${prefix}/${payload.id}.notes.json`;
    try {
      await repo.save(owner, payload);
      await env.DOCUMENTS.put(
        key,
        JSON.stringify({
          transcript: { text: "too long".repeat(10000) },
          summary: null,
        }),
      );
      await expect(repo.getNotes(owner, payload.id)).rejects.toThrow(
        "Stored recording notes are invalid",
      );
    } finally {
      await repo.remove(owner, payload.id).catch(() => {});
    }
  });

  it("rejects oversized notes sidecars before parsing them", async () => {
    const owner = crypto.randomUUID();
    const repo = new CompanionRecordings(env.DOCUMENTS);
    const payload = input();
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(owner),
    );
    const prefix = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const key = `companion/samples/${prefix}/${payload.id}.notes.json`;
    try {
      await repo.save(owner, payload);
      await env.DOCUMENTS.put(key, " ".repeat(128 * 1024 + 1));
      await expect(repo.getNotes(owner, payload.id)).rejects.toThrow(
        "Stored recording notes are invalid",
      );
    } finally {
      await repo.remove(owner, payload.id).catch(() => {});
    }
  });

  it("rejects oversized schema-valid notes without replacing a saved transcript", async () => {
    const owner = crypto.randomUUID();
    const repo = new CompanionRecordings(env.DOCUMENTS);
    const payload = input();
    const previous = {
      transcript: {
        text: "The group reviewed next steps.",
        source: payload.source,
        model: "test/stt",
        durationSeconds: 0.1,
      },
      summary: null,
    };
    const oversized = {
      transcript: previous.transcript,
      summary: {
        summary: "A summary",
        decisions: Array.from({ length: 50 }, () => "d".repeat(2000)),
        actions: [],
        openQuestions: Array.from({ length: 50 }, () => "q".repeat(2000)),
      },
    };
    try {
      await repo.save(owner, payload);
      await repo.storeNotes(owner, payload.id, previous);
      await expect(
        repo.storeNotes(owner, payload.id, oversized),
      ).rejects.toThrow(
        "Provider returned recording notes that exceed the storage limit",
      );
      await expect(repo.getNotes(owner, payload.id)).resolves.toEqual(previous);
    } finally {
      await repo.remove(owner, payload.id).catch(() => {});
    }
  });

  it("rejects unavailable storage, missing consent and invalid audio", async () => {
    await expect(
      new CompanionRecordings().save("owner", input()),
    ).rejects.toThrow("storage");
    const repo = new CompanionRecordings(env.DOCUMENTS);
    await expect(
      repo.save("owner", { ...input(), consent: false } as any),
    ).rejects.toThrow();
    await expect(
      repo.save("owner", {
        ...input(),
        audio: { data: "invalid", format: "ogg" },
      }),
    ).rejects.toThrow();
  });
});
