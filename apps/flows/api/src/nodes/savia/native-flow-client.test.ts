import { describe, expect, it, vi } from "vitest";
import { jwtVerify } from "jose";
import { isNativeFlowsCall } from "@savia/studio-shared/native-flows";
import { callNativeFlows, requestNativeFlows } from "./native-flow-client";

const secret = "native-flow-test-bridge-secret-at-least-32";
describe("native flow host client", () => {
  it("binds current identity and operation to a ten-second private token", async () => {
    const fetcher = vi.fn(async (request: Request) => {
      const body = await request.text();
      const { payload } = await jwtVerify(
        request.headers.get("authorization")!.slice(7),
        new TextEncoder().encode(secret),
        {
          algorithms: ["HS256"],
          issuer: "savia-flows",
          audience: "savia-flows-native-host",
        },
      );
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(body),
      );
      expect(payload.bodyDigest).toBe(
        [...new Uint8Array(hash)]
          .map((v) => v.toString(16).padStart(2, "0"))
          .join(""),
      );
      expect(payload.sub).toBe("manager");
      expect(payload.tenant).toBe("tenant:101");
      expect(payload.exp! - payload.iat!).toBe(10);
      expect(request.url).toBe(
        "https://savia.local/api/public/savia-flows/native",
      );
      expect(JSON.parse(body)).toEqual({ method: "GET", path: "/workflows" });
      return Response.json({
        data: [{ id: "existing", published_version: "version_1" }],
      });
    });
    const data = await callNativeFlows(
      { SAVIA_HOST: { fetch: fetcher }, SAVIA_FLOWS_BRIDGE_SECRET: secret },
      { method: "GET", path: "/workflows" },
      { principalId: "manager", tenant: "tenant:101" },
    );
    expect(data).toEqual([{ id: "existing", published_version: "version_1" }]);
  });
  it("rejects unknown, public, cross-tenant, encoded and forged operations before contacting the host", async () => {
    const fetcher = vi.fn();
    for (const call of [
      { method: "GET", path: "/objects?tenant=tenant:202" },
      { method: "GET", path: "/../workflows" },
      { method: "POST", path: "/workflow-inbox/a%2fresolve" },
      { method: "GET", path: "/api/public/workflow-webhooks/a" },
      { method: "GET", path: "/workflows", principalId: "other" },
      { method: "DELETE", path: "/workflows/existing" },
    ]) {
      expect(isNativeFlowsCall(call)).toBe(false);
      await expect(
        requestNativeFlows(
          { SAVIA_HOST: { fetch: fetcher }, SAVIA_FLOWS_BRIDGE_SECRET: secret },
          call as never,
          { principalId: "manager", tenant: "tenant:101" },
        ),
      ).rejects.toThrow("Invalid native flow operation");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("preserves backend admission statuses and refuses unavailable identity", async () => {
    const env = {
      SAVIA_HOST: {
        fetch: vi.fn(async () =>
          Response.json(
            { error: "Workflow permission required" },
            { status: 403 },
          ),
        ),
      },
      SAVIA_FLOWS_BRIDGE_SECRET: secret,
    };
    const call = {
      method: "POST" as const,
      path: "/workflow-executions/run_1/retry",
    };
    const identity = { principalId: "manager", tenant: "tenant:101" };
    const response = await requestNativeFlows(env, call, identity);
    expect(response.status).toBe(403);
    await expect(callNativeFlows(env, call, identity)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      requestNativeFlows(env, call, { ...identity, principalId: "" }),
    ).rejects.toThrow("identity is incomplete");
  });
});
