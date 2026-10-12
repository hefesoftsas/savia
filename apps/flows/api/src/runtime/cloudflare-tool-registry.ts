import type { NodeContext } from "@savia/flows-runtime";
import {
  BaseNodeRegistry,
  BaseToolRegistry,
  NodeToolProvider,
} from "@savia/flows-runtime";

/**
 * Cloudflare-specific tool registry implementation
 */
export class CloudflareToolRegistry extends BaseToolRegistry {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private nodeRegistry: BaseNodeRegistry<any>,
    private createNodeContextFn: (
      nodeId: string,
      inputs: Record<string, any>
    ) => NodeContext
  ) {
    super();
    this.initializeProviders();
  }

  protected initializeProviders(): void {
    // Register the node tool provider for "node" type tools
    const nodeToolProvider = new NodeToolProvider(
      this.nodeRegistry,
      this.createNodeContextFn
    );

    this.registerProvider("node", nodeToolProvider);
  }
}
