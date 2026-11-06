import {
  createGatewayActions,
  payloadSchemas,
  type GatewayOptions,
} from "@savia/insurance-communications/gateway";
import { manifest } from "./manifest";
export const createConnectorActions = (options: GatewayOptions = {}) =>
  createGatewayActions(manifest.id, ["request-signature", "signature-status"], {
    ...options,
    payloadSchemas: options.payloadSchemas ?? payloadSchemas(manifest.id),
  });
