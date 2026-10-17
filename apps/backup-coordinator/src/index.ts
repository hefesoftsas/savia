import { BackupCoordinator } from "../../../packages/backup-gate/index.mjs";

export { BackupCoordinator };

const CONTROL_PREFIX = "/api/_internal/backup-gate/";
const CONTROL_ACTIONS = new Set(["acquire", "status", "renew", "release"]);

type AgenciesService = {
  fetch(request: Request): Promise<Response>;
};

type CoordinatorEnvironment = {
  AGENCIES?: AgenciesService;
};

export default {
  async fetch(
    request: Request,
    environment: CoordinatorEnvironment,
  ): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.startsWith(CONTROL_PREFIX)
      ? url.pathname.slice(CONTROL_PREFIX.length)
      : "";
    if (request.method !== "POST" || url.search || !CONTROL_ACTIONS.has(action))
      return new Response("Not Found", { status: 404 });

    const agencies = environment.AGENCIES;
    if (!agencies || typeof agencies.fetch !== "function")
      return new Response("Backup controller unavailable", {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });

    const upstream = new URL(url.pathname, "https://agencies.internal");
    try {
      return await agencies.fetch(new Request(upstream, request));
    } catch {
      return new Response("Backup controller unavailable", {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
  },
};
