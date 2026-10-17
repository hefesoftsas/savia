import { BackupCoordinator } from "../../../packages/backup-gate/index.mjs";

export { BackupCoordinator };

export default {
  fetch() {
    return new Response("Not Found", { status: 404 });
  },
};
