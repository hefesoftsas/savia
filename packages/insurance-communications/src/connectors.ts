import {
  createGatewayActions,
  payloadSchemas,
  type GatewayOptions,
} from "./gateway";
import { manifest, extension } from "./manifest";
export function createConnectorActions(options: GatewayOptions = {}) {
  return createGatewayActions(
    manifest.id,
    extension.runtime.actions.map((action) => action.actionId),
    {
      ...options,
      payloadSchemas: options.payloadSchemas ?? payloadSchemas(manifest.id),
    },
  );
}
