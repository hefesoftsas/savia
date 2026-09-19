import runtime from "./runtime";
export * from "./runtime";
export { RealtimeHub } from "./realtime/hub";
export default {
  fetch(
    request: Request,
    environment: import("./runtime").RuntimeEnvironment,
    _context?: ExecutionContext,
  ) {
    return runtime.fetch(request, environment);
  },
  scheduled: runtime.scheduled,
};
