// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  normalizePaletteFieldIdInput,
  resolveDropInsert,
  resolvePaletteFieldId,
} from "../designer-field-dnd";
import {
  filterPaletteFieldTypes,
  normalizePaletteTypeSearch,
} from "../field-type-icons";

describe("palette field id", () => {
  it("normalizes spaces, case and invalid characters", () => {
    expect(normalizePaletteFieldIdInput("  Mi Campo  ")).toBe("mi_campo");
    expect(normalizePaletteFieldIdInput("presupuesto-1")).toBe("presupuesto_1");
    expect(normalizePaletteFieldIdInput("campo@2")).toBe("campo2");
  });

  it("uses a custom id when valid", () => {
    expect(
      resolvePaletteFieldId("presupuesto", {}, () => "text_1").id,
    ).toBe("presupuesto");
  });

  it("normalizes before validating on click", () => {
    expect(
      resolvePaletteFieldId("Presupuesto", {}, () => "text_1").id,
    ).toBe("presupuesto");
  });

  it("aborts strict adds when the custom id is invalid", () => {
    const result = resolvePaletteFieldId(
      "1invalido",
      {},
      () => "text_1",
      { strictCustom: true },
    );
    expect(result.abort).toBe(true);
    expect(result.error).toMatch(/minúsculas/);
  });

  it("falls back to auto id on drag when the custom id already exists", () => {
    const result = resolvePaletteFieldId(
      "presupuesto",
      { presupuesto: {} },
      () => "text_2",
    );
    expect(result.id).toBe("text_2");
    expect(result.error).toMatch(/ya existe/);
  });
});

describe("palette type search", () => {
  const items = [
    { type: "Textbox", label: "Texto", icon: null },
    { type: "Number", label: "Número", icon: null },
    { type: "Autocomplete", label: "Autocompletar", icon: null },
  ];

  it("filters available palette types by label or type", () => {
    expect(filterPaletteFieldTypes(items, "num")).toEqual([items[1]]);
    expect(filterPaletteFieldTypes(items, "auto")).toEqual([items[2]]);
    expect(filterPaletteFieldTypes(items, "textbox")).toEqual([items[0]]);
    expect(filterPaletteFieldTypes(items, "asdas")).toEqual([]);
  });

  it("normalizes accents in palette search", () => {
    expect(normalizePaletteTypeSearch("  Número  ")).toBe("numero");
  });
});

describe("resolveDropInsert", () => {
  it("inserts before the first field when the pointer is above its midpoint", () => {
    const list = document.createElement("ul");
    list.innerHTML = `
      <li><div data-field-id="a" style="height:40px"></div></li>
      <li><div data-field-id="b" style="height:40px"></div></li>
    `;
    const a = list.querySelector('[data-field-id="a"]') as HTMLElement;
    const b = list.querySelector('[data-field-id="b"]') as HTMLElement;
    a.getBoundingClientRect = () =>
      ({ top: 100, height: 40, bottom: 140 }) as DOMRect;
    b.getBoundingClientRect = () =>
      ({ top: 150, height: 40, bottom: 190 }) as DOMRect;

    expect(
      resolveDropInsert(list, 110, ["a", "b"]).beforeFieldId,
    ).toBe("a");
    expect(
      resolveDropInsert(list, 155, ["a", "b"]).beforeFieldId,
    ).toBe("b");
    expect(
      resolveDropInsert(list, 185, ["a", "b"]).beforeFieldId,
    ).toBeNull();
  });
});
