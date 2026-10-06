import { requireOAuthScope } from "../src/auth/oauth-resource";
import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { registerCompanionRoutes } from "../src/companion/routes";
import { CompanionSessions } from "../src/companion/sessions";
import { CompanionSessionJobs } from "../src/companion/session-jobs";
import { CompanionService } from "../src/companion/service";
import {
  authenticationErrorResponse,
  authenticationMiddleware,
} from "../src/auth/middleware";
import type { Authenticator } from "../src/auth/types";
import { AuthenticationError } from "../src/auth/types";
import { opusFixture } from "./fixtures/companion-tone";
import { nativeOpusFixtureBase64 } from "./fixtures/companion-native-tone";
import { m4aSegmentBase64 } from "./fixtures/companion-m4a";

function workspaceAuthenticator(
  scopes = ["recordings:read", "recordings:upload", "recordings:process"],
): Authenticator {
  return {
    async authenticate(request) {
      requireOAuthScope(
        { scopes: new Set(scopes) } as Parameters<typeof requireOAuthScope>[0],
        request,
      );
      return {
        principal: {
          id: "session-audio-member",
          issuer: "savia:better-auth",
          subject: "session-audio-member",
          email: "member@savia.test",
          displayName: "Session Audio Member",
          isActive: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        credential: { kind: "oauth", scopes },
        globalRoles: [],
        memberships: [101].map((tenantId) => ({
          id: `membership-${tenantId}`,
          principalId: "session-audio-member",
          tenantId,
          agencyId: tenantId,
          tenantName: `Workspace ${tenantId}`,
          tenantSlug: `workspace-${tenantId}`,
          role: "viewer",
          isActive: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        })),
      };
    },
  };
}

function app(service: CompanionService, scopes?: string[]) {
  const result = new OpenAPIHono();
  result.onError((error) =>
    error instanceof AuthenticationError
      ? authenticationErrorResponse(error)
      : Response.json({ error: { code: "ERROR" } }, { status: 500 }),
  );
  result.use(
    "/v1/companion/*",
    authenticationMiddleware({} as D1Database, workspaceAuthenticator(scopes)),
  );
  registerCompanionRoutes(result, {
    enabled: true,
    storage: env.DOCUMENTS,
    service,
    configuration: {
      effectiveConfigurationFor: async () => ({
        apiKey: "test-key",
        model: "test/summary",
      }),
      effectiveConfigurationForTenant: async (_ownerId, tenantId) => ({
        apiKey: `tenant-${tenantId}-key`,
        model: "test/summary",
        transcriptionModel: "test/transcription",
      }),
      activeTenantFor: async () => 101,
    },
  });
  return result;
}

const tenantHeaders = (tenantId: number) => ({
  "x-savia-tenant-id": String(tenantId),
  "x-savia-tenant-slug": `workspace-${tenantId}`,
});

const oggData = () =>
  btoa(Array.from(opusFixture(), (byte) => String.fromCharCode(byte)).join(""));
const nativeOggData = () =>
  btoa(
    Array.from(
      Uint8Array.from(atob(nativeOpusFixtureBase64), (c) => c.charCodeAt(0)),
      (byte) => String.fromCharCode(byte),
    ).join(""),
  );

function oggPages(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pages: { serial: number; sequence: number; flags: number }[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (
      offset + 27 > bytes.length ||
      String.fromCharCode(...bytes.subarray(offset, offset + 4)) !== "OggS"
    )
      throw new Error("Invalid Ogg page in full audio response");
    const segmentCount = bytes[offset + 26];
    const headerEnd = offset + 27 + segmentCount;
    if (headerEnd > bytes.length) throw new Error("Truncated Ogg page header");
    const bodyBytes = bytes
      .subarray(offset + 27, headerEnd)
      .reduce((total, size) => total + size, 0);
    if (headerEnd + bodyBytes > bytes.length)
      throw new Error("Truncated Ogg page body");
    pages.push({
      serial: view.getUint32(offset + 14, true),
      sequence: view.getUint32(offset + 18, true),
      flags: bytes[offset + 5],
    });
    offset = headerEnd + bodyBytes;
  }
  return pages;
}

async function uploadSession(
  instance: OpenAPIHono,
  id: string,
  chunks: {
    source: string;
    sequence: number;
    startSeconds: number;
    data: string;
    format: string;
  }[],
) {
  const headers = {
    ...tenantHeaders(101),
    "content-type": "application/json",
  };
  const create = await instance.request("/v1/companion/sessions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      id,
      name: "Session",
      sources: ["microphone"],
      consent: true,
    }),
  });
  expect(create.status).toBe(200);
  for (const chunk of chunks) {
    const upload = await instance.request(
      `/v1/companion/sessions/${id}/chunks`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          source: chunk.source,
          sequence: chunk.sequence,
          startSeconds: chunk.startSeconds,
          audio: { data: chunk.data, format: chunk.format },
        }),
      },
    );
    expect(upload.status).toBe(200);
  }
  const finalize = await instance.request(
    `/v1/companion/sessions/${id}/finalize`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        expectedChunks: chunks.length,
        durationSeconds: 60,
      }),
    },
  );
  expect(finalize.status).toBe(200);
}

function mockService(languages: unknown[]) {
  return {
    sttModel: "test/transcription",
    async transcribe(
      _config: unknown,
      input: { source: string; language?: string },
    ) {
      languages.push(input.language);
      return {
        text: "Transcript text.",
        source: input.source,
        model: "test/transcription",
        durationSeconds: 0.1,
      };
    },
    async summarize() {
      return {
        summary: "Summary.",
        decisions: [],
        actions: [],
        openQuestions: [],
      };
    },
    async answer() {
      return { answer: "Answer.", insufficientEvidence: false };
    },
  } as unknown as CompanionService;
}

async function processUntilComplete(
  sessions: CompanionSessions,
  service: CompanionService,
  ownerId: string,
  id: string,
) {
  const engine = new CompanionSessionJobs(
    sessions,
    service,
    async (_ownerId, tenantId) => ({
      apiKey: `tenant-${tenantId}-key`,
      model: "test/summary",
    }),
  );
  for (let attempt = 0; attempt < 10; attempt++) {
    const state = await sessions.get(
      { ownerId, tenantId: 101, requireTenant: true },
      id,
    );
    if (state.job.status === "complete") return state;
    await engine.processOne();
  }
  throw new Error("Session processing did not complete");
}

describe("Companion session full audio", () => {
  it("chains each Ogg chunk as a valid independent logical stream", async () => {
    const service = mockService([]);
    const instance = app(service);
    const id = crypto.randomUUID();
    const data = oggData();
    const nativeData = nativeOggData();
    await uploadSession(instance, id, [
      {
        source: "microphone",
        sequence: 0,
        startSeconds: 0,
        data: nativeData,
        format: "ogg",
      },
      {
        source: "microphone",
        sequence: 1,
        startSeconds: 30,
        data,
        format: "ogg",
      },
    ]);
    const response = await instance.request(
      `/v1/companion/sessions/${id}/audio?source=microphone`,
      { headers: tenantHeaders(101) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/ogg");
    const pages = oggPages(new Uint8Array(await response.arrayBuffer()));
    const streams = new Map<number, typeof pages>();
    for (const page of pages) {
      const stream = streams.get(page.serial) ?? [];
      stream.push(page);
      streams.set(page.serial, stream);
    }
    expect(streams.size).toBe(2);
    const firstSerial = pages[0].serial;
    const secondStreamStart = pages.findIndex(
      (page) => page.serial !== firstSerial,
    );
    expect(secondStreamStart).toBe(streams.get(firstSerial)!.length);
    expect(pages[secondStreamStart - 1].flags & 4).toBe(4);
    expect(pages[secondStreamStart].flags & 2).toBe(2);
    for (const stream of streams.values()) {
      expect(stream[0].flags & 2).toBe(2);
      expect(stream[0].sequence).toBe(0);
      expect(stream.at(-1)!.flags & 4).toBe(4);
      expect(stream.map((page) => page.sequence)).toEqual(
        stream.map((_, sequence) => sequence),
      );
    }
  });

  it("rejects full audio before finalize, for unknown sources, and for mixed formats", async () => {
    const service = mockService([]);
    const instance = app(service);
    const pending = crypto.randomUUID();
    const headers = {
      ...tenantHeaders(101),
      "content-type": "application/json",
    };
    const create = await instance.request("/v1/companion/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: pending,
        name: "Pending",
        sources: ["microphone"],
        consent: true,
      }),
    });
    expect(create.status).toBe(200);
    const beforeFinalize = await instance.request(
      `/v1/companion/sessions/${pending}/audio?source=microphone`,
      { headers: tenantHeaders(101) },
    );
    expect(beforeFinalize.status).toBe(409);

    const mixed = crypto.randomUUID();
    await uploadSession(instance, mixed, [
      {
        source: "microphone",
        sequence: 0,
        startSeconds: 0,
        data: oggData(),
        format: "ogg",
      },
      {
        source: "microphone",
        sequence: 1,
        startSeconds: 30,
        data: m4aSegmentBase64,
        format: "m4a",
      },
    ]);
    const mixedAudio = await instance.request(
      `/v1/companion/sessions/${mixed}/audio?source=microphone`,
      { headers: tenantHeaders(101) },
    );
    expect(mixedAudio.status).toBe(409);
    await expect(mixedAudio.json()).resolves.toMatchObject({
      error: { code: "FULL_AUDIO_UNAVAILABLE" },
    });

    const missing = await instance.request(
      `/v1/companion/sessions/${mixed}/audio?source=system`,
      { headers: tenantHeaders(101) },
    );
    expect(missing.status).toBe(404);
  });

  it("requires the read scope for full audio", async () => {
    const service = mockService([]);
    const instance = app(service);
    const uploadOnly = app(service, ["recordings:upload"]);
    const id = crypto.randomUUID();
    await uploadSession(uploadOnly, id, [
      {
        source: "microphone",
        sequence: 0,
        startSeconds: 0,
        data: oggData(),
        format: "ogg",
      },
    ]);
    const response = await uploadOnly.request(
      `/v1/companion/sessions/${id}/audio?source=microphone`,
      { headers: tenantHeaders(101) },
    );
    expect(response.status).toBe(403);
  });
});

describe("Companion session transcription language", () => {
  it("transcribes in the requested language and detects it by default", async () => {
    const languages: unknown[] = [];
    const service = mockService(languages);
    const instance = app(service);
    const sessions = new CompanionSessions(env.DOCUMENTS);
    const id = crypto.randomUUID();
    await uploadSession(instance, id, [
      {
        source: "microphone",
        sequence: 0,
        startSeconds: 0,
        data: oggData(),
        format: "ogg",
      },
    ]);
    const headers = {
      ...tenantHeaders(101),
      "content-type": "application/json",
    };
    const queued = await instance.request(
      `/v1/companion/sessions/${id}/notes`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ consent: true, language: "en" }),
      },
    );
    expect(queued.status).toBe(200);
    await expect(queued.json()).resolves.toMatchObject({
      job: { status: "queued", language: "en" },
    });
    await processUntilComplete(sessions, service, "session-audio-member", id);
    expect(languages).toEqual(["en"]);

    const other = crypto.randomUUID();
    await uploadSession(instance, other, [
      {
        source: "microphone",
        sequence: 0,
        startSeconds: 0,
        data: oggData(),
        format: "ogg",
      },
    ]);
    const defaulted = await instance.request(
      `/v1/companion/sessions/${other}/notes`,
      { method: "POST", headers, body: JSON.stringify({ consent: true }) },
    );
    expect(defaulted.status).toBe(200);
    await expect(defaulted.json()).resolves.toMatchObject({
      job: { language: "auto" },
    });
    await processUntilComplete(
      sessions,
      service,
      "session-audio-member",
      other,
    );
    expect(languages).toEqual(["en", undefined]);
  });

  it("replaces saved results only with explicit retranscription consent", async () => {
    const languages: unknown[] = [];
    const service = mockService(languages);
    const instance = app(service);
    const sessions = new CompanionSessions(env.DOCUMENTS);
    const id = crypto.randomUUID();
    await uploadSession(instance, id, [
      {
        source: "microphone",
        sequence: 0,
        startSeconds: 0,
        data: oggData(),
        format: "ogg",
      },
    ]);
    const headers = {
      ...tenantHeaders(101),
      "content-type": "application/json",
    };
    const first = await instance.request(`/v1/companion/sessions/${id}/notes`, {
      method: "POST",
      headers,
      body: JSON.stringify({ consent: true }),
    });
    expect(first.status).toBe(200);
    await processUntilComplete(sessions, service, "session-audio-member", id);
    expect(languages).toEqual([undefined]);

    const conflict = await instance.request(
      `/v1/companion/sessions/${id}/notes`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ consent: true, language: "fr" }),
      },
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "RETRANSCRIBE_REQUIRED" },
    });

    const restarted = await instance.request(
      `/v1/companion/sessions/${id}/notes`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          consent: true,
          language: "fr",
          retranscribe: true,
        }),
      },
    );
    expect(restarted.status).toBe(200);
    await expect(restarted.json()).resolves.toMatchObject({
      job: { status: "queued", language: "fr", transcripts: {} },
    });
    await processUntilComplete(sessions, service, "session-audio-member", id);
    expect(languages).toEqual([undefined, "fr"]);
    const session = await sessions.get(
      { ownerId: "session-audio-member", tenantId: 101, requireTenant: true },
      id,
    );
    expect(session.job.language).toBe("fr");
    expect(Object.keys(session.job.transcripts)).toEqual(["microphone:0"]);
  });
});
