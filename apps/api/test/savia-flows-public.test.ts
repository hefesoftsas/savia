import { describe, expect, it, vi } from "vitest";
import { createTestApp } from "./test-app";

describe("Savia Flows public capability gateway", () => {
  it("forwards only public form capabilities without session or Savia context", async () => {
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.url).toBe(
        "https://savia-flows.internal/forms/signed.token?locale=es",
      );
      expect(request.method).toBe("POST");
      expect(request.headers.get("content-type")).toContain(
        "multipart/form-data",
      );
      expect(request.headers.get("cookie")).toBeNull();
      expect(request.headers.get("authorization")).toBeNull();
      expect(request.headers.get("x-savia-flows-context")).toBeNull();
      expect(new TextDecoder().decode(await request.arrayBuffer())).toBe(
        "opaque form submission",
      );
      return new Response("accepted", { status: 202 });
    });
    const app = createTestApp({ saviaFlows: { service: { fetch: fetcher } } });

    const response = await app.request(
      "/api/public/savia-flows/forms/signed.token?locale=es",
      {
        method: "POST",
        headers: {
          "content-type": "multipart/form-data; boundary=demo",
          cookie: "savia_session=secret",
          authorization: "Bearer browser-session",
          "x-savia-flows-context": "forged",
        },
        body: "opaque form submission",
      },
    );

    expect(response.status).toBe(202);
    expect(await response.text()).toBe("accepted");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["http", "/api/public/savia-flows/http/workflow-1?source=public", "GET"],
    ["queues", "/api/public/savia-flows/queues/queue-1", "POST"],
  ])(
    "preserves API-key authorization for %s triggers only",
    async (_cap, path, method) => {
      const fetcher = vi.fn(async (request: Request) => {
        expect(request.headers.get("authorization")).toBe(
          "Bearer upstream-key",
        );
        expect(request.headers.get("cookie")).toBeNull();
        expect(request.headers.get("x-savia-flows-context")).toBeNull();
        expect(request.url).toContain("savia-flows.internal/");
        return Response.json({ ok: true });
      });
      const app = createTestApp({
        saviaFlows: { service: { fetch: fetcher } },
      });

      const response = await app.request(path, {
        method,
        headers: {
          authorization: "Bearer upstream-key",
          cookie: "savia_session=secret",
          "x-savia-flows-context": "forged",
        },
        ...(method === "POST" ? { body: "{}" } : {}),
      });

      expect(response.status).toBe(200);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("rewrites the public queue path and preserves upstream authorization failures", async () => {
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.url).toBe(
        "https://savia-flows.internal/queues/queue-1/publish",
      );
      return new Response("unauthorized", { status: 401 });
    });
    const app = createTestApp({ saviaFlows: { service: { fetch: fetcher } } });

    const response = await app.request(
      "/api/public/savia-flows/queues/queue-1",
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("unauthorized");
  });

  it("forwards repeated form-trigger submissions through the public route", async () => {
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.url).toBe(
        "https://savia-flows.internal/form-triggers/workflow-1",
      );
      expect(request.method).toBe("POST");
      expect(request.headers.get("authorization")).toBeNull();
      return Response.json({ submitted: true }, { status: 201 });
    });
    const app = createTestApp({ saviaFlows: { service: { fetch: fetcher } } });

    const response = await app.request(
      "/api/public/savia-flows/form-triggers/workflow-1",
      {
        method: "POST",
        headers: { authorization: "Bearer savia-session" },
        body: JSON.stringify({ name: "Public visitor" }),
      },
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ submitted: true });
  });

  it("rejects unsupported methods, traversal, suffixes, and private gateway paths", async () => {
    const fetcher = vi.fn(() => Response.json({ ok: true }));
    const app = createTestApp({ saviaFlows: { service: { fetch: fetcher } } });

    expect(
      (
        await app.request("/api/public/savia-flows/forms/token", {
          method: "DELETE",
        })
      ).status,
    ).toBe(405);
    expect(
      (await app.request("/api/public/savia-flows/forms/%2e%2e%2Fadmin"))
        .status,
    ).toBe(400);
    expect(
      (await app.request("/api/public/savia-flows/forms/token/private")).status,
    ).toBe(404);
    expect(
      (await app.request("/api/public/savia-flows/tenant:101/workflows"))
        .status,
    ).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves upstream invalid signed-token responses and returns unavailable without a local service", async () => {
    const fetcher = vi.fn(() => new Response("invalid token", { status: 400 }));
    const app = createTestApp({ saviaFlows: { service: { fetch: fetcher } } });
    const invalid = await app.request(
      "/api/public/savia-flows/feedback-forms/bad-token",
    );
    const unavailable = await createTestApp().request(
      "/api/public/savia-flows/forms/token",
    );

    expect(invalid.status).toBe(400);
    expect(await invalid.text()).toBe("invalid token");
    expect(unavailable.status).toBe(503);
  });
});
