import { jwtVerify } from "jose";
import { describe, expect, it, vi } from "vitest";
import { callSaviaCollections } from "./collection-client";

const secret = "a-secure-local-flows-bridge-secret-that-is-long-enough";
const env = {
  SAVIA_FLOWS_BRIDGE_SECRET: secret,
  SAVIA_HOST: {
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : undefined;
      const token = new Headers(init?.headers ?? request?.headers)
        .get("authorization")
        ?.slice(7);
      const body = String(
        init?.body ?? (request ? await request.clone().text() : ""),
      );
      const { payload } = await jwtVerify(
        token!,
        new TextEncoder().encode(secret),
        {
          issuer: "savia-flows",
          audience: "savia-flows-collections-host",
        },
      );
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(body),
      );
      const actual = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      expect(payload.bodyDigest).toBe(actual);
      return Response.json({ data: { id: "record-1" } });
    }),
  },
};

describe("callSaviaCollections", () => {
  it("signs a body-bound call with backend runtime identity and execution", async () => {
    const response = await callSaviaCollections(
      env as never,
      { action: "create", collection: "Tasks", data: { title: "One" } },
      {
        principalId: "user-1",
        tenant: "tenant:one",
        workflowId: "flow-1",
        executionId: "exec-1",
        nodeId: "node-1",
      },
    );
    expect(response).toEqual({ data: { id: "record-1" } });
    expect(env.SAVIA_HOST.fetch).toHaveBeenCalledOnce();
  });

  it("fails closed when the private host binding is unavailable", async () => {
    await expect(
      callSaviaCollections(
        { SAVIA_FLOWS_BRIDGE_SECRET: secret } as never,
        { action: "catalog" },
        { principalId: "user-1", tenant: "tenant:one" },
      ),
    ).rejects.toThrow("Savia collections are unavailable");
  });
});
