import { describe, expect, it } from "vitest";
import manifest from "../savia-extension.json";
import store from "../store.json";
import {
  validateRecord,
  type StudioObject,
} from "../../studio-shared/src/metadata";
import { extensionManifestSchema } from "../../studio-shared/src/extension-package";
import {
  storeJsonSchema,
  sanitizeStoreCollection,
} from "../../studio-shared/src/plugin-store";

describe("SECOP plugin package contracts", () => {
  it("declares a native collection for tender preparation tasks", () => {
    const parsed = storeJsonSchema.parse(store);
    const { object } = parsed.collections
      .map(sanitizeStoreCollection)
      .find((item) => item.object.name === "secop_application_tasks")!;
    expect(object.config.fields).toMatchObject({
      name: { type: "Textbox", required: true },
      description: { type: "Textarea" },
      assignee: { type: "Textbox", required: true },
      due_date: { type: "DateControl", required: true },
      status: { type: "Dropdown", required: true },
      source_key: { type: "Textbox", required: true, config: { unique: true } },
      source_context: { type: "Textarea" },
      source_reference: { type: "Textarea" },
      source_url: { type: "Textbox" },
    });
    expect(
      parsed.screens.some(
        (screen) => screen.object === "secop_application_tasks",
      ),
    ).toBe(false);
    expect(manifest.version).toBe("1.8.10");
  });

  it("hides stored PDF-analysis records while retaining task navigation", () => {
    const parsed = storeJsonSchema.parse(store);
    const objects = parsed.collections.map(sanitizeStoreCollection);
    const analysis = objects.find(
      (item) => item.object.name === "procurement_documents",
    )!.object;
    const tasks = objects.find(
      (item) => item.object.name === "secop_application_tasks",
    )!.object;

    expect(analysis.config.studio?.screen?.hidden).toBe(true);
    expect(tasks.config.studio?.screen?.hidden).not.toBe(true);
    expect(parsed.screens.map((screen) => screen.object)).toEqual([
      "procurement_opportunities",
    ]);
    expect(objects.map((item) => item.object.name)).toEqual(
      expect.arrayContaining([
        "procurement_opportunities",
        "procurement_documents",
        "secop_application_tasks",
      ]),
    );
  });

  it("persists detailed PDF reports beyond the default text field limit", () => {
    const parsed = storeJsonSchema.parse(store);
    const { object } = parsed.collections
      .map(sanitizeStoreCollection)
      .find((item) => item.object.name === "procurement_documents")!;
    const report = "Document requirements and page references. ".repeat(500);
    const result = validateRecord(object as unknown as StudioObject, {
      name: "Invitation.pdf",
      analysis: report,
    });
    expect(result.errors).toEqual({});
    expect(result.data.analysis).toBe(report);
  });
  it("accepts the localized extension manifest and store declarations", () => {
    expect(extensionManifestSchema.safeParse(manifest).success).toBe(true);
    const parsed = storeJsonSchema.safeParse(store);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    for (const collection of parsed.data.collections)
      expect(() => sanitizeStoreCollection(collection)).not.toThrow();
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

it("accepts the assistant task evidence bounds without truncating sources", () => {
  const collection = store.collections.find(
    (entry) => entry.object.name === "secop_application_tasks",
  )!;
  expect(collection.object.config.fields.description?.config.maxLength).toBe(
    20000,
  );
  expect(
    collection.object.config.fields.source_reference?.config.maxLength,
  ).toBe(20000);
});
