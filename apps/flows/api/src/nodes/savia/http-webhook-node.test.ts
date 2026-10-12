import type { Node, NodeExecution } from "@savia/flows-types";
import { describe, expect, it } from "vitest";
import { HttpWebhookNode } from "@savia/flows-runtime/nodes/http/http-webhook-node";
import type { NodeContext } from "@savia/flows-runtime";
import { SaviaHttpWebhookNode } from "./http-webhook-node";

describe("SaviaHttpWebhookNode", () => {
  it("preserves webhook outputs and adds a normalized raw body blob", async () => {
    const baseOutputs = HttpWebhookNode.nodeType.outputs.map(
      (output) => output.name,
    );
    expect(
      SaviaHttpWebhookNode.nodeType.outputs.map((output) => output.name),
    ).toEqual([...baseOutputs, "body"]);

    const node = new SaviaHttpWebhookNode({
      id: "http-webhook",
      type: "http-webhook",
    } as Node);
    const result = (await node.execute({
      nodeId: "http-webhook",
      workflowId: "workflow-1",
      organizationId: "tenant-1",
      userId: "principal-1",
      executionId: "execution-1",
      inputs: {},
      httpRequest: {
        method: "POST",
        url: "https://example.test/hooks/one",
        path: "/hooks/one",
        headers: { "content-type": "application/json" },
        queryParams: { source: "test" },
        body: { data: { 0: 123, 1: 125 }, mimeType: "application/json" },
      },
    } as unknown as NodeContext)) as NodeExecution;

    expect(result.status).toBe("completed");
    expect(result.outputs).toMatchObject({
      method: "POST",
      url: "https://example.test/hooks/one",
      path: "/hooks/one",
      headers: { "content-type": "application/json" },
      queryParams: { source: "test" },
      body: { data: new Uint8Array([123, 125]), mimeType: "application/json" },
    });
  });
});
