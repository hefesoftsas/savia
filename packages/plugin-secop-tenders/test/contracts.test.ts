import { describe, expect, it } from "vitest";
import manifest from "../savia-extension.json";
import store from "../store.json";
import { extensionManifestSchema } from "../../studio-shared/src/extension-package";
import { storeJsonSchema } from "../../studio-shared/src/plugin-store";

describe("SECOP plugin package contracts", () => {
  it("accepts the localized extension manifest and store declarations", () => {
    expect(extensionManifestSchema.safeParse(manifest).success).toBe(true);
    const parsed = storeJsonSchema.safeParse(store);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.actions).toContainEqual(
      expect.objectContaining({
        id: "detail",
        kind: "mcp",
        tool: "detalle_licitacion",
        inputArguments: ["id_del_proceso"],
        mapping: expect.objectContaining({ itemsPointer: "/filas" }),
      }),
    );
    expect(parsed.data.monitors).toHaveLength(1);
    expect(parsed.data.monitors[0]).toMatchObject({
      id: "tracking",
      collection: "procurement_opportunities",
      actionId: "detail",
      lookup: { field: "process_id", argument: "id_del_proceso" },
      matchField: "source_id",
      reminderHours: [168, 72, 24],
      pauseWhen: { field: "status", values: ["awarded", "discarded"] },
    });
  });
});
