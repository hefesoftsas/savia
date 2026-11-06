import { describe, expect, it, vi } from "vitest";
import { shellBootstrapJs, shellBootstrapPath } from "../src/plugin-store";

function installedPluginApi(
  panelId: string | null,
  requestHost = vi.fn().mockResolvedValue(null),
) {
  const bootstrap = shellBootstrapJs();
  const factory = bootstrap.slice(
    bootstrap.indexOf("function createSavia(panelId) {"),
    bootstrap.indexOf("const savia = createSavia(null);"),
  );
  const create = new Function(
    "requestHost",
    "PLUGIN_ID",
    "recordListeners",
    "routeListeners",
    `${factory}; return createSavia;`,
  )(requestHost, "custom.demo", new Set(), new Set());
  return { api: create(panelId), requestHost };
}

describe("installed plugin native assistant capability", () => {
  it.each([null, "active-panel-7"])(
    "exposes the assistant and preserves panel scope %s",
    async (panelId) => {
      const { api, requestHost } = installedPluginApi(panelId);
      expect(api.assistant?.open).toBeTypeOf("function");
      const launch = {
        title: "Tender",
        actionId: "assistant-chat",
        connectionId: "private",
        context: { dossierId: "CO1.REQ.1" },
        initialMessage: "List all requirements",
      };
      await expect(api.assistant.open(launch)).resolves.toBeUndefined();
      expect(requestHost).toHaveBeenCalledExactlyOnceWith(
        "/extensions/custom.demo/assistant/open",
        "POST",
        launch,
        panelId,
        undefined,
      );
    },
  );

  it("propagates host refusal instead of reporting the assistant as opened", async () => {
    const { api } = installedPluginApi(
      null,
      vi.fn().mockRejectedValue(new Error("Session ended")),
    );
    expect(api.assistant?.open).toBeTypeOf("function");
    await expect(
      api.assistant.open({ title: "Tender", actionId: "chat", context: {} }),
    ).rejects.toThrow("Session ended");
  });
});

it("exposes URL state through the owning screen bridge, including history subscriptions", async () => {
  const request = vi
    .fn()
    .mockResolvedValue({ tender: "CO1.REQ.1", tab: "chat" });
  const { api } = installedPluginApi(null, request);
  await expect(api.route.get()).resolves.toEqual({
    tender: "CO1.REQ.1",
    tab: "chat",
  });
  expect(request).toHaveBeenLastCalledWith(
    "/extensions/custom.demo/route",
    "GET",
    undefined,
    null,
    undefined,
  );
  await api.route.set(
    { tender: "CO1.REQ.1", tab: "documents" },
    { replace: true },
  );
  expect(request).toHaveBeenLastCalledWith(
    "/extensions/custom.demo/route",
    "PUT",
    { state: { tender: "CO1.REQ.1", tab: "documents" }, replace: true },
    null,
    undefined,
  );
  expect(api.route.subscribe(vi.fn())).toBeTypeOf("function");
});

it("versions the bootstrap URL independently of the installed plugin artifact", () => {
  const url = new URL(
    shellBootstrapPath("custom.demo", "/entry.js", { runtime: "stale" }),
    "https://savia.test",
  );
  expect(url.searchParams.get("runtime")).toMatch(/^[0-9a-z]+$/);
  expect(url.searchParams.get("runtime")).not.toBe("stale");
  expect(url.searchParams.get("runtime")).toBe(
    new URL(
      shellBootstrapPath("other", "/other.js"),
      "https://savia.test",
    ).searchParams.get("runtime"),
  );
});
