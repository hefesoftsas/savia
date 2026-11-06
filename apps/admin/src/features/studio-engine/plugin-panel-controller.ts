import {
  parsePanelRequest,
  type PluginPanelRequest,
  type PluginPanelState,
} from "@savia/studio-shared/plugin-panels";
export type ActivePluginPanel = {
  id: string;
  requestId: string;
  request: PluginPanelRequest;
  state: PluginPanelState;
  phase: "loading" | "active";
};
export function createPluginPanelController() {
  let current: ActivePluginPanel | null = null;
  return {
    get current() {
      return current;
    },
    open(requestId: string, value: unknown) {
      const request = parsePanelRequest(value);
      if (current || !request || !requestId || requestId.length > 128)
        return null;
      current = {
        id: crypto.randomUUID(),
        requestId,
        request,
        phase: "loading",
        state: { dirty: false, busy: true },
      };
      return current;
    },
    update(value: unknown) {
      if (!current || !value || typeof value !== "object") return;
      const state = value as PluginPanelState;
      if (typeof state.dirty !== "boolean" || typeof state.busy !== "boolean")
        return;
      current.phase = "active";
      current.state = { dirty: state.dirty, busy: state.busy };
    },
    close(discard = false): "blocked" | "confirm" | "closed" {
      if (current?.phase === "active" && current.state.busy) return "blocked";
      if (current?.state.dirty && !discard) return "confirm";
      current = null;
      return "closed";
    },
    dispose() {
      current = null;
    },
  };
}
