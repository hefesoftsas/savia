import api from "../../apps/api/src/index";
import type { RuntimeEnvironment } from "../../apps/api/src/runtime";
import { handlePluginDevelopment } from "./handler";
export { RealtimeHub } from "../../apps/api/src/index";

// Generated local runtime only. Production continues to use apps/api/src/index.ts.
export default {
  ...api,
  fetch(
    request: Request,
    env: RuntimeEnvironment & { SAVIA_PLUGIN_DEV_KEY?: string },
    context: ExecutionContext,
  ) {
    if (new URL(request.url).pathname.startsWith("/__dev/plugins/"))
      return handlePluginDevelopment(request, env);
    return api.fetch(request, env, context);
  },
};
