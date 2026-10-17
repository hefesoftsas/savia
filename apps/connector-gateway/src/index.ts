import { createConnectorApp } from "./app";
import { runtimeReleaseCatalog } from "@savia/release-catalog/runtime";
import { guardStorageEnvironment } from "../../../packages/backup-gate/index.mjs";
import {
  backupCapability,
  handleBackupControl,
} from "../../../packages/backup-gate/control.mjs";

type SaviaRequestService = Parameters<
  typeof runtimeReleaseCatalog.createConnectorActions
>[0];

type ConnectorEnvironment = {
  DB: D1Database;
  EXTENSION_CONNECTIONS_ENCRYPTION_KEY?: string;
  SAVIA_REQUEST?: SaviaRequestService;
  EXTENSION_GATEWAY_ALLOWED_ORIGINS?: string;
};

export function createRuntimeConnectorApp(environment: ConnectorEnvironment) {
  return createConnectorApp({
    database: environment.DB,
    encryptionKey: environment.EXTENSION_CONNECTIONS_ENCRYPTION_KEY,
    actions: runtimeReleaseCatalog.createConnectorActions(
      environment.SAVIA_REQUEST,
      {
        allowedOrigins: (environment.EXTENSION_GATEWAY_ALLOWED_ORIGINS ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      },
    ),
  });
}

export default {
  async fetch(
    request: Request,
    environment: ConnectorEnvironment,
  ): Promise<Response> {
    const control = await handleBackupControl(request, environment);
    if (control) return control;
    const capability = backupCapability(request, environment);
    if (capability) return capability;
    return createRuntimeConnectorApp(
      guardStorageEnvironment(environment),
    ).fetch(request);
  },
};
