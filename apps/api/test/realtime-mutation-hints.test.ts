import { describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { vi } from "vitest";
import { classifyRealtimeMutation } from "../src/realtime/mutation-hints";
import { registerRealtimeMutationHints } from "../src/realtime/mutation-hints";

describe("realtime mutation hint classification", () => {
  it("maps Studio metadata mutations to narrow tenant collections", () => {
    expect(
      classifyRealtimeMutation(
        "PUT",
        "/v1/studio/42/api/objects/insurance_quotes",
      ),
    ).toEqual({
      room: "tenant",
      tenantId: 42,
      topic: "studio",
      collection: "objects",
      alsoAudit: true,
    });
    expect(
      classifyRealtimeMutation(
        "POST",
        "/v1/tenants/42/crm/api/fields/insurance_quotes",
      ),
    ).toMatchObject({ topic: "studio", collection: "fields", tenantId: 42 });
    expect(
      classifyRealtimeMutation(
        "POST",
        "/v1/studio/42/api/extensions/savia.insurance/install",
      ),
    ).toMatchObject({ topic: "studio", collection: "objects", tenantId: 42 });
    expect(
      classifyRealtimeMutation("DELETE", "/v1/studio/42/api/audit/event-1"),
    ).toMatchObject({ topic: "studio", collection: "audit", tenantId: 42 });
  });

  it("maps workflow mutations to definitions, executions and inbox", () => {
    expect(
      classifyRealtimeMutation(
        "POST",
        "/v1/studio/0/api/workflows/abc/publish",
      ),
    ).toMatchObject({
      room: "tenant",
      tenantId: 0,
      topic: "workflows",
      collection: "definitions",
    });
    expect(
      classifyRealtimeMutation(
        "POST",
        "/v1/studio/42/api/workflow-executions/run-1/cancel",
      ),
    ).toMatchObject({ topic: "workflows", collection: "executions" });
    expect(
      classifyRealtimeMutation(
        "POST",
        "/v1/studio/42/api/workflow-inbox/task-1/resolve",
      ),
    ).toMatchObject({ topic: "workflows", collection: "inbox" });
  });

  it("scopes account, personal integrations, notification, settings and platform hints", () => {
    expect(
      classifyRealtimeMutation(
        "POST",
        "/v1/personal-integrations/connections/google/complete",
      ),
    ).toMatchObject({
      room: "principal",
      topic: "personal-integrations",
      collection: "connections",
    });
    expect(
      classifyRealtimeMutation("POST", "/api/notifications/notice/read"),
    ).toMatchObject({ room: "principal", topic: "notifications" });
    expect(
      classifyRealtimeMutation("PUT", "/v1/tenants/42/branding"),
    ).toMatchObject({ room: "tenant", tenantId: 42, topic: "settings" });
    expect(
      classifyRealtimeMutation("PUT", "/v1/assistant/configuration/global"),
    ).toMatchObject({ room: "tenant", tenantId: 0, topic: "settings" });
    expect(
      classifyRealtimeMutation(
        "POST",
        "/v1/savia-request/api/flows/flow-1/runs",
        "?tenant=tenant%3A42",
      ),
    ).toMatchObject({
      room: "tenant",
      tenantId: 42,
      topic: "integrations",
      collection: "savia-request",
    });
  });

  it("does not emit for reads or unrelated mutations", () => {
    expect(
      classifyRealtimeMutation("GET", "/v1/studio/42/api/objects"),
    ).toBeUndefined();
    expect(
      classifyRealtimeMutation("POST", "/v1/studio/42/api/records/foo"),
    ).toBeUndefined();
    expect(
      classifyRealtimeMutation("POST", "/v1/identity/users"),
    ).toBeUndefined();
  });

  it("publishes only after a matching mutation succeeds", async () => {
    const app = new OpenAPIHono();
    const publish = vi.fn();
    const actor = {
      principal: { id: "member-1" },
      globalRoles: [],
      memberships: [],
    };
    app.use("*", async (context, next) => {
      (context as unknown as { set(key: string, value: unknown): void }).set(
        "actor",
        actor,
      );
      await next();
    });
    registerRealtimeMutationHints(app, { publish } as never);
    app.post("/v1/studio/:tenantId/api/objects/:name", (context) =>
      context.json({ ok: true }, 200),
    );
    app.post("/v1/studio/:tenantId/api/fields/:name", (context) =>
      context.json({ ok: false }, 409),
    );

    expect(
      (
        await app.request("/v1/studio/42/api/objects/quotes", {
          method: "POST",
        })
      ).status,
    ).toBe(200);
    expect(
      (await app.request("/v1/studio/42/api/fields/quotes", { method: "POST" }))
        .status,
    ).toBe(409);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledWith(
      "tenant:42",
      expect.objectContaining({
        topic: "studio",
        collection: "objects",
        type: "created",
        actor: "member-1",
      }),
    );
    expect(publish).toHaveBeenCalledWith(
      "tenant:42",
      expect.objectContaining({
        topic: "studio",
        collection: "audit",
        type: "created",
      }),
    );
  });
});
