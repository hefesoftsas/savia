import { expect, it } from "vitest";
import { createPluginPanelController } from "../plugin-panel-controller";
it("blocks concurrent/nested opens and protects dirty or busy panels", () => {
  const c = createPluginPanelController();
  const r = { view: "record-editor", title: "Account", params: {} };
  expect(c.open("first", r)).not.toBeNull();
  expect(c.open("second", r)).toBeNull();
  c.update({ dirty: true, busy: false });
  expect(c.close()).toBe("confirm");
  c.update({ dirty: true, busy: true });
  expect(c.close(true)).toBe("blocked");
  c.update({ dirty: true, busy: false });
  expect(c.close(true)).toBe("closed");
  expect(c.current).toBeNull();
});
it("rejects scope overrides and invalid state", () => {
  const c = createPluginPanelController();
  expect(
    c.open("1", {
      view: "record-editor",
      title: "Account",
      params: { tenantId: 5 },
    }),
  ).toBeNull();
  c.open("1", { view: "record-editor", title: "Account", params: {} });
  c.update({ dirty: false, busy: "false" });
  expect(c.current?.state.busy).toBe(true);
  c.dispose();
  expect(c.current).toBeNull();
});
