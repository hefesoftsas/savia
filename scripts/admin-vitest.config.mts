import { mergeConfig } from "vitest/config";
import adminConfig from "../apps/admin/vite.config";
import AdminTestSequencer from "./admin-test-sequencer.mjs";

export default mergeConfig(adminConfig, {
  test: {
    sequence: { sequencer: AdminTestSequencer },
  },
});
