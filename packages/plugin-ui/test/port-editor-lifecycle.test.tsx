// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { PluginApi } from "@savia/studio-shared/plugin-api";
const ports = [
  () => import("../../../store-ports/activities/entry"),
  () => import("../../../store-ports/collections/entry"),
  () => import("../../../store-ports/commissions/entry"),
  () => import("../../../store-ports/claims/entry"),
  () => import("../../../store-ports/compliance/entry"),
  () => import("../../../store-ports/issuance/entry"),
  () => import("../../../store-ports/endorsements/entry"),
  () => import("../../../store-ports/documents/entry"),
  () => import("../../../store-ports/opportunities/entry"),
  () => import("../../../store-ports/service/entry"),
  () => import("../../../store-ports/renewals/entry"),
];
it.each(ports)(
  "mounts and cleans a fresh editor without list effects (%#)",
  async (load) => {
    const port = await load();
    const list = vi.fn();
    const api = {
      collections: {
        collection: () => ({
          list,
          describe: async () => ({ config: { fields: {} } }),
        }),
      },
      ui: {
        panel: {
          panelId: "a",
          request: { view: "record-editor", title: "Editor", params: {} },
        },
        setPanelState() {},
      },
    } as unknown as PluginApi;
    const root = document.createElement("div");
    document.body.append(root);
    let cleanup!: () => void;
    try {
      await act(async () => {
        cleanup = port.renderPanel(root, api);
      });
      await waitFor(() => expect(root.querySelector("form")).not.toBeNull());
      expect(list).not.toHaveBeenCalled();
      await act(async () => cleanup());
      expect(root.children).toHaveLength(0);
      await act(async () => {
        cleanup = port.renderPanel(root, api);
      });
      expect(root.querySelector("form")).not.toBeNull();
      expect(list).not.toHaveBeenCalled();
    } finally {
      await act(async () => cleanup?.());
      root.remove();
    }
  },
);
