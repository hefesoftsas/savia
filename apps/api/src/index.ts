import runtime from "./runtime";
export * from "./runtime";
export { WhatsappDispatcher } from "./whatsapp/dispatcher";
export { RealtimeHub } from "./realtime/hub";
export default {
  fetch(
    request: Request,
    environment: import("./runtime").RuntimeEnvironment,
    context?: ExecutionContext,
  ) {
    return runtime.fetch(request, environment, undefined, context);
  },
  scheduled: runtime.scheduled,
};
