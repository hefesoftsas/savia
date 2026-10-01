export type PluginPanelRequest = {
  view: "record-editor";
  title: string;
  params: { recordId?: string; mode?: "details" | "payment" };
};
export type PluginPanelResult = { status: "saved" | "cancelled" };
export type PluginPanelState = { dirty: boolean; busy: boolean };
export type PluginPanelContext = {
  panelId: string;
  request: PluginPanelRequest;
};
export type PluginPanelApi = {
  panel: PluginPanelContext | null;
  openPanel(request: PluginPanelRequest): Promise<PluginPanelResult>;
  setPanelState(state: PluginPanelState): void;
  requestClose(): void;
  completePanel(result: PluginPanelResult): void;
};
export function parsePanelRequest(value: unknown): PluginPanelRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some((k) => !["view", "title", "params"].includes(k)) ||
    v.view !== "record-editor" ||
    typeof v.title !== "string" ||
    !v.title.trim() ||
    v.title.length > 160
  )
    return null;
  if (!v.params || typeof v.params !== "object" || Array.isArray(v.params))
    return null;
  const p = v.params as Record<string, unknown>;
  if (Object.keys(p).some((k) => !["recordId", "mode"].includes(k)))
    return null;
  if (
    p.recordId !== undefined &&
    (typeof p.recordId !== "string" ||
      !p.recordId.trim() ||
      p.recordId.length > 256)
  )
    return null;
  if (p.mode !== undefined && p.mode !== "details" && p.mode !== "payment")
    return null;
  if (JSON.stringify(v).length > 4096) return null;
  return {
    view: "record-editor",
    title: v.title,
    params: { ...p },
  } as PluginPanelRequest;
}

/** Self-contained: serialized into the isolated shell, without runtime imports. */
export function connectPluginPanelHost(
  win: Window,
  panelExpected: boolean,
): Promise<PluginPanelApi | undefined> {
  return new Promise((resolve, reject) => {
    const nonce = win.crypto.randomUUID();
    let session = "";
    let initialized = false;
    let disposed = false;
    let context: PluginPanelContext | null = null;
    let pending:
      | {
          id: string;
          resolve: (value: PluginPanelResult) => void;
          reject: (error: Error) => void;
        }
      | undefined;
    const send = (type: string, data: Record<string, unknown> = {}) =>
      win.parent.postMessage(
        { ns: "savia-plugin-ui", version: 1, session, type, ...data },
        "*",
      );
    const focusables = () =>
      Array.from(
        win.document.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
        ),
      ).filter((el) => el.getClientRects().length > 0);
    const onKey = (event: KeyboardEvent) => {
      if (!context) return;
      if (event.key === "Escape") {
        event.preventDefault();
        send("close", { panelId: context.panelId });
      }
      if (event.key === "Tab") {
        const items = focusables();
        if (
          !items.length ||
          (event.shiftKey
            ? win.document.activeElement === items[0]
            : win.document.activeElement === items.at(-1))
        ) {
          event.preventDefault();
          send("focus-host", {
            panelId: context.panelId,
            backwards: event.shiftKey,
          });
        }
      }
    };
    const api: PluginPanelApi = {
      get panel() {
        return context;
      },
      openPanel(request) {
        if (disposed || context || pending)
          return Promise.reject(
            new Error("A panel is already open or unavailable."),
          );
        return new Promise((done, fail) => {
          const id = win.crypto.randomUUID();
          pending = { id, resolve: done, reject: fail };
          send("open", { id, request });
        });
      },
      setPanelState(state) {
        if (context) send("state", { panelId: context.panelId, state });
      },
      requestClose() {
        if (context) send("close", { panelId: context.panelId });
      },
      completePanel(result) {
        if (context) send("complete", { panelId: context.panelId, result });
      },
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== win.parent) return;
      const m = event.data;
      if (!m || m.ns !== "savia-plugin-ui" || m.version !== 1) return;
      if (
        !initialized &&
        m.type === "init" &&
        m.nonce === nonce &&
        typeof m.session === "string" &&
        m.session
      ) {
        if (panelExpected && !m.panel) return;
        initialized = true;
        session = m.session;
        context = m.panel ?? null;
        win.clearTimeout(timer);
        resolve(api);
        return;
      }
      if (!initialized || m.session !== session) return;
      if (m.type === "result" && pending && m.id === pending.id) {
        const slot = pending;
        pending = undefined;
        if (m.result?.status === "saved" || m.result?.status === "cancelled")
          slot.resolve(m.result);
        else slot.reject(new Error("Panel unavailable."));
      }
      if (m.type === "focus-editor" && context) {
        const items = focusables();
        (m.backwards ? items.at(-1) : items[0])?.focus();
      }
      if (m.type === "dispose") dispose();
    };
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      win.clearTimeout(timer);
      win.removeEventListener("message", onMessage);
      win.document.removeEventListener("keydown", onKey, true);
      pending?.reject(new Error("The plugin session ended."));
      pending = undefined;
      win.removeEventListener("pagehide", dispose);
      if (!initialized) {
        if (panelExpected)
          reject(new Error("The editor could not connect to its host."));
        else resolve(undefined);
      }
    };
    const timer = win.setTimeout(() => {
      dispose();
      if (panelExpected)
        reject(new Error("The editor could not connect to its host."));
      else resolve(undefined);
    }, 2000);
    win.addEventListener("message", onMessage);
    win.document.addEventListener("keydown", onKey, true);
    win.addEventListener("pagehide", dispose, { once: true });
    win.parent.postMessage(
      { ns: "savia-plugin-ui", version: 1, type: "hello", nonce },
      "*",
    );
  });
}
