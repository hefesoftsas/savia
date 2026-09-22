import { describe, expect, it } from "vitest";
import {
  actionBucketLabel,
  autoDetectWidgetConfig,
  bucketActionItems,
  formatWidgetAmount,
  formatWidgetCount,
  recordDateLabel,
  recordStatus,
  recordTitle,
} from "./summarize";
import type { WidgetCollectionSchema } from "./types";

const schema: WidgetCollectionSchema = {
  apiBasePath: "/v1/data-domains/platform",
  name: "polizas",
  label: "Pólizas",
  fields: [
    { name: "name", label: "Póliza", type: "Textbox" },
    { name: "estado", label: "Estado", type: "Dropdown" },
    { name: "prima", label: "Prima", type: "Currency" },
    { name: "fin", label: "Vence", type: "DateControl" },
  ],
};

describe("autoDetectWidgetConfig", () => {
  it("picks estado, prima and fin", () => {
    expect(autoDetectWidgetConfig(schema)).toEqual({
      statusField: "estado",
      amountField: "prima",
      dateField: "fin",
    });
  });

  it("falls back to the first dropdown when names do not match", () => {
    const custom: WidgetCollectionSchema = {
      ...schema,
      fields: [
        { name: "phase", label: "Phase", type: "Dropdown" },
        { name: "total", label: "Total", type: "Number" },
      ],
    };
    expect(autoDetectWidgetConfig(custom)).toEqual({
      statusField: "phase",
      amountField: "total",
    });
  });

  it("returns empty when there is nothing to detect", () => {
    expect(autoDetectWidgetConfig({ ...schema, fields: [] })).toEqual({});
  });
});

describe("record presentation", () => {
  it("resolves titles from priority fields", () => {
    expect(recordTitle({ id: "abc123", name: "  POL-001 " }, schema)).toBe(
      "POL-001",
    );
    expect(recordTitle({ id: "abc123456" }, undefined)).toBe(
      "Registro abc12345",
    );
  });

  it("resolves status and dates", () => {
    expect(recordStatus({ id: "1", estado: "Vigente" }, "estado")).toBe(
      "Vigente",
    );
    expect(recordStatus({ id: "1" }, "estado")).toBeUndefined();
    expect(recordStatus({ id: "1", estado: "x" }, undefined)).toBeUndefined();
    expect(recordDateLabel({ id: "1", fin: "2026-03-10" }, "fin")).toContain(
      "2026",
    );
    expect(
      recordDateLabel({ id: "1", fin: "not-a-date" }, "fin"),
    ).toBeUndefined();
  });

  it("formats numbers in es-CO", () => {
    expect(formatWidgetCount(1234)).toBe(
      new Intl.NumberFormat("es-CO").format(1234),
    );
    expect(formatWidgetAmount(1234.5)).toBe(
      new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(
        1234.5,
      ),
    );
  });
});

describe("bucketActionItems", () => {
  const today = "2026-09-21";
  const records = [
    { id: "overdue", fin: "2026-09-10" },
    { id: "today", fin: "2026-09-21" },
    { id: "week", fin: "2026-09-28" },
    { id: "far", fin: "2026-12-01" },
    { id: "datetime", fin: "2026-09-20T15:30:00.000Z" },
    { id: "invalid", fin: "not-a-date" },
    { id: "missing" },
  ];

  it("buckets overdue, today and coming week by calendar day", () => {
    const items = bucketActionItems(records, "fin", today);
    expect(items.map((item) => [item.record.id, item.bucket])).toEqual([
      ["overdue", "overdue"],
      ["datetime", "overdue"],
      ["today", "today"],
      ["week", "week"],
    ]);
  });

  it("sorts oldest first", () => {
    const items = bucketActionItems(records, "fin", today);
    const days = items.map((item) => item.day);
    expect([...days].sort()).toEqual(days);
  });

  it("labels every bucket", () => {
    expect(actionBucketLabel("overdue")).toBe("Vencido");
    expect(actionBucketLabel("today")).toBe("Hoy");
    expect(actionBucketLabel("week")).toBe("Esta semana");
  });
});
