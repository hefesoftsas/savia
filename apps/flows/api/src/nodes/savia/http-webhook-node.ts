import type { NodeType } from "@savia/flows-types";
import { HttpWebhookNode } from "@savia/flows-runtime/nodes/http/http-webhook-node";
import { HttpRequestNode } from "@savia/flows-runtime/nodes/http/http-request-node";

/**
 * Local-host adapter for HTTP webhooks. It preserves the upstream trigger's
 * identity and metadata outputs, and reuses HttpRequestNode's byte-safe body
 * normalization so the webhook payload can feed blob-aware nodes.
 */
export class SaviaHttpWebhookNode extends HttpRequestNode {
  public static readonly nodeType: NodeType = {
    ...HttpWebhookNode.nodeType,
    outputs: [
      ...HttpWebhookNode.nodeType.outputs,
      {
        name: "body",
        type: "blob",
        description: "The raw request body with MIME type",
      },
    ],
  };
}
