import runtime from "./runtime";
import {
  BackupCoordinator,
  guardStorageEnvironment,
  runWithBackupGateRequest,
} from "../../../packages/backup-gate/index.mjs";
import {
  backupCapability,
  handleBackupControl,
} from "../../../packages/backup-gate/control.mjs";
export * from "./runtime";
export { WhatsappDispatcher } from "./whatsapp/dispatcher";
export { RealtimeHub } from "./realtime/hub";
export { BackupCoordinator };
export default {
  async fetch(
    request: Request,
    environment: import("./runtime").RuntimeEnvironment,
    context?: ExecutionContext,
  ) {
    return runWithBackupGateRequest(
      { writer: "api.fetch", executionContext: context },
      async () => {
        const control = await handleBackupControl(request, environment);
        if (control) return control;
        const capability = backupCapability(request, environment);
        if (capability) return capability;
        return runtime.fetch(
          request,
          guardStorageEnvironment(environment),
          undefined,
          context,
        );
      },
    );
  },
  async scheduled(
    event: ScheduledController,
    environment: import("./runtime").RuntimeEnvironment,
    context?: ExecutionContext,
  ) {
    return runWithBackupGateRequest(
      { writer: "api.scheduled", executionContext: context },
      () => runtime.scheduled(event, guardStorageEnvironment(environment)),
    );
  },
};
