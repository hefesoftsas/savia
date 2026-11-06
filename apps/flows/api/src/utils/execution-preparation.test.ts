import type { Edge, Node, WorkflowTrigger } from "@savia/flows-types";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { prepareWorkflowExecution } from "./execution-preparation";

describe("prepareWorkflowExecution", () => {
  it("keeps request headers plain and removes credentials from execution inputs", async () => {
    let prepared:
      Awaited<ReturnType<typeof prepareWorkflowExecution>> | undefined;
    const app = new Hono();
    app.post("/", async (c) => {
      prepared = await prepareWorkflowExecution(c, {
        trigger: "http_webhook" as WorkflowTrigger,
        nodes: [{} as Node],
        edges: [] as Edge[],
      });
      return c.json({ ok: true });
    });

    const response = await app.request("http://localhost/?source=test", {
      method: "POST",
      headers: {
        authorization: "Bearer host-token",
        cookie: "session=host-cookie",
        "x-savia-flows-context": "signed-bridge-token",
        "content-type": "application/json",
        "x-request-id": "request-123",
      },
      body: JSON.stringify({ value: "preserved" }),
    });

    expect(response.status).toBe(200);
    expect(prepared).toBeDefined();
    if (!prepared || "status" in prepared) {
      throw new Error("Workflow execution preparation failed");
    }

    const parameters = prepared.parameters as {
      headers: Record<string, string>;
      query: Record<string, string>;
      body?: { mimeType: string };
    };
    expect(Object.getPrototypeOf(parameters.headers)).toBe(Object.prototype);
    expect(parameters.headers).toEqual({
      "content-type": "application/json",
      "x-request-id": "request-123",
    });
    expect(parameters.query).toEqual({ source: "test" });
    expect(parameters.body?.mimeType).toBe("application/json");
  });
});
