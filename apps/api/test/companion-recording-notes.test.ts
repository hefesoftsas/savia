import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticationMiddleware } from "../src/auth/middleware";
import { registerCompanionRoutes } from "../src/companion/routes";
import { CompanionService } from "../src/companion/service";
import { CompanionRecordings } from "../src/companion/recordings";
import { opusFixtureBase64 } from "./fixtures/companion-tone";
import { platformAdministratorAuthenticator } from "./auth-fixtures";

const owner = crypto.randomUUID();
function makeService(options?: { failSummary?: boolean }) {
  const transcribe = vi.fn(async (_configuration: unknown, input: any) => ({
    text: "Discuss the launch date.",
    source: input.source,
    model: "test/stt",
    durationSeconds: 0.1,
  }));
  const summarize = vi.fn(async () => {
    if (options?.failSummary) throw new Error("simulated summary failure");
    return {
      summary: "The team discussed the launch date.",
      decisions: ["Review the launch date"],
      actions: [],
      openQuestions: [],
    };
  });
  return {
    service: {
      sttModel: "test/stt",
      transcribe,
      summarize,
    } as unknown as CompanionService,
    transcribe,
    summarize,
  };
}
function app(
  principalId = owner,
  service: CompanionService = makeService().service,
) {
  const result = new OpenAPIHono();
  const baseAuthenticator = platformAdministratorAuthenticator();
  result.use(
    "/v1/companion/*",
    authenticationMiddleware({} as D1Database, {
      authenticate: async (request, database) => {
        const actor = await baseAuthenticator.authenticate(request, database);
        return { ...actor, principal: { ...actor.principal, id: principalId } };
      },
    }),
  );
  registerCompanionRoutes(result, {
    enabled: true,
    storage: env.DOCUMENTS,
    configuration: {
      effectiveConfigurationFor: async () => ({
        apiKey: "mock-server-key",
        model: "test/summary",
      }),
    },
    service,
  });
  return result;
}
async function saveSample(instance: OpenAPIHono, id: string) {
  const response = await instance.request("/v1/companion/recordings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id,
      source: "system",
      audio: { data: opusFixtureBase64, format: "ogg" },
      consent: true,
    }),
  });
  expect(response.status).toBe(200);
}
const consent = { consent: true };
afterEach(() => vi.restoreAllMocks());

describe("saved Companion recording notes", () => {
  it("transcribes and summarizes only after explicit consent, then returns persisted notes", async () => {
    const id = crypto.randomUUID();
    const { service, transcribe, summarize } = makeService();
    const instance = app(owner, service);
    await saveSample(instance, id);
    try {
      const empty = await instance.request(
        `/v1/companion/recordings/${id}/notes`,
      );
      expect(empty.status).toBe(200);
      expect(await empty.json()).toEqual({
        transcript: null,
        summary: null,
        language: "auto",
      });

      const response = await instance.request(
        `/v1/companion/recordings/${id}/notes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(consent),
        },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        transcript: { text: "Discuss the launch date.", source: "system" },
        summary: { summary: "The team discussed the launch date." },
      });
      expect(transcribe).toHaveBeenCalledTimes(1);
      expect(transcribe.mock.calls[0][1].language).toBeUndefined();
      expect(summarize).toHaveBeenCalledTimes(1);
    } finally {
      await new CompanionRecordings(env.DOCUMENTS)
        .remove(owner, id)
        .catch(() => {});
    }
  });

  it("transcribes in the requested language and redoes notes only with retranscribe consent", async () => {
    const id = crypto.randomUUID();
    const { service, transcribe, summarize } = makeService();
    const instance = app(owner, service);
    await saveSample(instance, id);
    try {
      const first = await instance.request(
        `/v1/companion/recordings/${id}/notes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ consent: true, language: "pt" }),
        },
      );
      expect(first.status).toBe(200);
      expect(transcribe).toHaveBeenCalledTimes(1);
      expect(transcribe.mock.calls[0][1]).toMatchObject({ language: "pt" });
      const cached = await instance.request(
        `/v1/companion/recordings/${id}/notes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ consent: true, language: "pt" }),
        },
      );
      expect(cached.status).toBe(200);
      expect(transcribe).toHaveBeenCalledTimes(1);
      expect(summarize).toHaveBeenCalledTimes(1);

      const redone = await instance.request(
        `/v1/companion/recordings/${id}/notes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            consent: true,
            language: "en",
            retranscribe: true,
          }),
        },
      );
      expect(redone.status).toBe(200);
      expect(transcribe).toHaveBeenCalledTimes(2);
      expect(transcribe.mock.calls[1][1]).toMatchObject({ language: "en" });
      expect(summarize).toHaveBeenCalledTimes(2);
    } finally {
      await new CompanionRecordings(env.DOCUMENTS)
        .remove(owner, id)
        .catch(() => {});
    }
  });

  it("persists the selected language and requires consent before replacing cached notes", async () => {
    const id = crypto.randomUUID();
    const { service, transcribe, summarize } = makeService();
    const instance = app(owner, service);
    await saveSample(instance, id);
    try {
      const first = await instance.request(
        `/v1/companion/recordings/${id}/notes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ consent: true, language: "pt" }),
        },
      );
      expect(first.status).toBe(200);

      const changedWithoutConsent = await instance.request(
        `/v1/companion/recordings/${id}/notes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ consent: true, language: "en" }),
        },
      );
      expect(changedWithoutConsent.status).toBe(409);
      expect(await first.json()).toMatchObject({ language: "pt" });
      expect(await changedWithoutConsent.json()).toMatchObject({
        error: { code: "LANGUAGE_CHANGE_REQUIRES_CONSENT" },
      });
      expect(transcribe).toHaveBeenCalledTimes(1);
      expect(summarize).toHaveBeenCalledTimes(1);

      const unchanged = await (
        await instance.request(`/v1/companion/recordings/${id}/notes`)
      ).json();
      expect(unchanged.language).toBe("pt");
      expect(unchanged.transcript.text).toBe("Discuss the launch date.");
    } finally {
      await new CompanionRecordings(env.DOCUMENTS)
        .remove(owner, id)
        .catch(() => {});
    }
  });

  it("keeps the saved language when a legacy retry omits the language field", async () => {
    const id = crypto.randomUUID();
    const { service, transcribe, summarize } = makeService();
    const instance = app(owner, service);
    await saveSample(instance, id);
    try {
      const first = await instance.request(
        `/v1/companion/recordings/${id}/notes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ consent: true, language: "pt" }),
        },
      );
      expect(first.status).toBe(200);

      const retry = await instance.request(
        `/v1/companion/recordings/${id}/notes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ consent: true }),
        },
      );
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({ language: "pt" });
      expect(transcribe).toHaveBeenCalledTimes(1);
      expect(summarize).toHaveBeenCalledTimes(1);
    } finally {
      await new CompanionRecordings(env.DOCUMENTS)
        .remove(owner, id)
        .catch(() => {});
    }
  });

  it("reuses durable cached transcript and summary after constructing a new repository", async () => {
    const id = crypto.randomUUID();
    const first = makeService();
    const instance = app(owner, first.service);
    await saveSample(instance, id);
    try {
      const firstResponse = await instance.request(
        `/v1/companion/recordings/${id}/notes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(consent),
        },
      );
      const cached = await firstResponse.json();
      const second = makeService();
      const response = await app(owner, second.service).request(
        `/v1/companion/recordings/${id}/notes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(consent),
        },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(cached);
      expect(second.transcribe).not.toHaveBeenCalled();
      expect(second.summarize).not.toHaveBeenCalled();
    } finally {
      await new CompanionRecordings(env.DOCUMENTS)
        .remove(owner, id)
        .catch(() => {});
    }
  });

  it("treats legacy notes without language metadata as automatic and keeps their cache", async () => {
    const id = crypto.randomUUID();
    const { service, transcribe, summarize } = makeService();
    const instance = app(owner, service);
    await saveSample(instance, id);
    const ownerDigest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(owner),
    );
    const ownerPrefix = Array.from(new Uint8Array(ownerDigest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const key = `companion/samples/${ownerPrefix}/${id}.notes.json`;
    const legacyNotes = {
      transcript: {
        text: "A transcript from an earlier release.",
        source: "system",
        model: "test/stt",
        durationSeconds: 0.1,
      },
      summary: {
        summary: "Earlier saved notes.",
        decisions: [],
        actions: [],
        openQuestions: [],
      },
    };
    try {
      await env.DOCUMENTS.put(key, JSON.stringify(legacyNotes));
      const response = await instance.request(
        `/v1/companion/recordings/${id}/notes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ consent: true, language: "auto" }),
        },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        language: "auto",
        transcript: { text: legacyNotes.transcript.text },
        summary: { summary: legacyNotes.summary.summary },
      });
      expect(transcribe).not.toHaveBeenCalled();
      expect(summarize).not.toHaveBeenCalled();
    } finally {
      await new CompanionRecordings(env.DOCUMENTS)
        .remove(owner, id)
        .catch(() => {});
    }
  });

  it("persists a transcript when summary fails and retries only summarization", async () => {
    const id = crypto.randomUUID();
    const first = makeService({ failSummary: true });
    const instance = app(owner, first.service);
    await saveSample(instance, id);
    try {
      const failed = await instance.request(
        `/v1/companion/recordings/${id}/notes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ consent: true, language: "fr" }),
        },
      );
      expect(failed.status).toBe(500);
      expect(
        await (
          await instance.request(`/v1/companion/recordings/${id}/notes`)
        ).json(),
      ).toMatchObject({
        language: "fr",
        transcript: { text: "Discuss the launch date." },
        summary: null,
      });
      expect(first.transcribe).toHaveBeenCalledTimes(1);

      const second = makeService();
      const retried = await app(owner, second.service).request(
        `/v1/companion/recordings/${id}/notes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ consent: true, language: "fr" }),
        },
      );
      expect(retried.status).toBe(200);
      expect(second.transcribe).not.toHaveBeenCalled();
      expect(second.summarize).toHaveBeenCalledTimes(1);
    } finally {
      await new CompanionRecordings(env.DOCUMENTS)
        .remove(owner, id)
        .catch(() => {});
    }
  });

  it("returns only safe provider status diagnostics when transcription is rejected", async () => {
    const id = crypto.randomUUID();
    const providerSecret = "sk-or-provider-secret";
    const service = new CompanionService({
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: { code: providerSecret, message: "private provider detail" },
          }),
          { status: 413 },
        ),
    });
    const instance = app(owner, service);
    await saveSample(instance, id);
    try {
      const response = await instance.request(
        `/v1/companion/recordings/${id}/notes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(consent),
        },
      );
      const body = await response.json();
      expect(response.status).toBe(502);
      expect(body).toMatchObject({
        error: {
          code: "PROVIDER_REQUEST_FAILED",
          providerOperation: "transcription",
          upstreamStatus: 413,
        },
      });
      expect(JSON.stringify(body)).not.toContain(providerSecret);
      expect(JSON.stringify(body)).not.toContain("private provider detail");
      expect(JSON.stringify(body)).not.toContain("mock-server-key");
    } finally {
      await new CompanionRecordings(env.DOCUMENTS)
        .remove(owner, id)
        .catch(() => {});
    }
  });

  it("returns safe summary rejection diagnostics while preserving the transcript without retrying", async () => {
    const id = crypto.randomUUID();
    const providerSecret = "provider-response-private-detail";
    let providerCalls = 0;
    const service = new CompanionService({
      fetch: async (input, init) => {
        providerCalls++;
        const body = JSON.parse(init!.body as string);
        if (
          Array.isArray(body.messages?.[0]?.content) &&
          body.messages[0].content.some(
            (part: { type?: string }) => part.type === "input_audio",
          )
        )
          return Response.json({
            choices: [{ message: { content: "Persist this transcript." } }],
          });
        return new Response(
          JSON.stringify({
            error: { code: "private_provider_code", message: providerSecret },
          }),
          { status: 429 },
        );
      },
    });
    const instance = app(owner, service);
    await saveSample(instance, id);
    try {
      const failed = await instance.request(
        `/v1/companion/recordings/${id}/notes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(consent),
        },
      );
      const body = await failed.json();
      expect(failed.status).toBe(502);
      expect(body).toMatchObject({
        error: {
          code: "PROVIDER_REQUEST_FAILED",
          providerOperation: "summary",
          upstreamStatus: 429,
        },
      });
      expect(JSON.stringify(body)).not.toContain(providerSecret);
      expect(JSON.stringify(body)).not.toContain("private_provider_code");
      expect(providerCalls).toBe(2);
      expect(
        await (
          await instance.request(`/v1/companion/recordings/${id}/notes`)
        ).json(),
      ).toMatchObject({
        transcript: { text: "Persist this transcript." },
        summary: null,
      });
      expect(providerCalls).toBe(2);
    } finally {
      await new CompanionRecordings(env.DOCUMENTS)
        .remove(owner, id)
        .catch(() => {});
    }
  });

  it("requires consent and hides another owner's saved notes", async () => {
    const id = crypto.randomUUID();
    const { service, transcribe, summarize } = makeService();
    const instance = app(owner, service);
    await saveSample(instance, id);
    try {
      const denied = await instance.request(
        `/v1/companion/recordings/${id}/notes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ consent: false }),
        },
      );
      expect(denied.status).toBe(400);
      expect(transcribe).not.toHaveBeenCalled();
      expect(summarize).not.toHaveBeenCalled();
      expect(
        (
          await app(crypto.randomUUID(), service).request(
            `/v1/companion/recordings/${id}/notes`,
          )
        ).status,
      ).toBe(404);
    } finally {
      await new CompanionRecordings(env.DOCUMENTS)
        .remove(owner, id)
        .catch(() => {});
    }
  });

  it("serializes same-owner processing so concurrent requests share provider work", async () => {
    const id = crypto.randomUUID();
    let finishTranscription!: (value: {
      text: string;
      source: "system";
      model: string;
      durationSeconds: number;
    }) => void;
    let announceStart!: () => void;
    const started = new Promise<void>((resolve) => {
      announceStart = resolve;
    });
    const service = makeService().service as any;
    service.transcribe = vi.fn(() => {
      announceStart();
      return new Promise((resolve) => {
        finishTranscription = resolve;
      });
    });
    const instance = app(owner, service);
    await saveSample(instance, id);
    try {
      const post = () =>
        instance.request(`/v1/companion/recordings/${id}/notes`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(consent),
        });
      const first = post();
      await started;
      const second = post();
      finishTranscription({
        text: "Discuss the launch date.",
        source: "system",
        model: "test/stt",
        durationSeconds: 0.1,
      });
      const [a, b] = await Promise.all([first, second]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(service.transcribe).toHaveBeenCalledTimes(1);
      expect(service.summarize).toHaveBeenCalledTimes(1);
    } finally {
      await new CompanionRecordings(env.DOCUMENTS)
        .remove(owner, id)
        .catch(() => {});
    }
  });

  it("serializes processing across separate apps sharing one R2 bucket", async () => {
    const id = crypto.randomUUID();
    const finishTranscriptions: ((value: {
      text: string;
      source: "system";
      model: string;
      durationSeconds: number;
    }) => void)[] = [];
    const service = makeService().service as any;
    service.transcribe = vi.fn(
      () =>
        new Promise((resolve) => {
          finishTranscriptions.push(resolve);
        }),
    );
    const firstApp = app(owner, service);
    const secondApp = app(owner, service);
    await saveSample(firstApp, id);
    try {
      const post = (instance: OpenAPIHono) =>
        instance.request(`/v1/companion/recordings/${id}/notes`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(consent),
        });
      const first = post(firstApp);
      const second = post(secondApp);
      await new Promise((resolve) => setTimeout(resolve, 25));
      for (const finish of finishTranscriptions) {
        finish({
          text: "Discuss the launch date.",
          source: "system",
          model: "test/stt",
          durationSeconds: 0.1,
        });
      }
      const [a, b] = await Promise.all([first, second]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(service.transcribe).toHaveBeenCalledTimes(1);
      expect(service.summarize).toHaveBeenCalledTimes(1);
    } finally {
      await new CompanionRecordings(env.DOCUMENTS)
        .remove(owner, id)
        .catch(() => {});
    }
  });

  it("waits for active processing before deleting audio and notes", async () => {
    const id = crypto.randomUUID();
    let finishSummary!: (value: {
      summary: string;
      decisions: string[];
      actions: never[];
      openQuestions: never[];
    }) => void;
    let announceStart!: () => void;
    const started = new Promise<void>((resolve) => {
      announceStart = resolve;
    });
    const service = makeService().service as any;
    service.summarize = vi.fn(() => {
      announceStart();
      return new Promise((resolve) => {
        finishSummary = resolve;
      });
    });
    const instance = app(owner, service);
    await saveSample(instance, id);
    try {
      const processing = instance.request(
        `/v1/companion/recordings/${id}/notes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(consent),
        },
      );
      await started;
      const deleting = instance.request(`/v1/companion/recordings/${id}`, {
        method: "DELETE",
      });
      finishSummary({
        summary: "The team discussed the launch date.",
        decisions: [],
        actions: [],
        openQuestions: [],
      });
      expect((await processing).status).toBe(200);
      expect((await deleting).status).toBe(204);
      expect(
        (await instance.request(`/v1/companion/recordings/${id}/notes`)).status,
      ).toBe(404);
    } finally {
      await new CompanionRecordings(env.DOCUMENTS)
        .remove(owner, id)
        .catch(() => {});
    }
  });
});
