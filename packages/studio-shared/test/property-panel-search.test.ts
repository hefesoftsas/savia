// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  applyPropertyPanelFilter,
  matchesPropertyPanelSearch,
  normalizePropertyPanelSearch,
} from "../src/property-panel-search";

describe("property panel search", () => {
  it("normalizes accents and case", () => {
    expect(normalizePropertyPanelSearch("  Etiqueta  ")).toBe("etiqueta");
    expect(normalizePropertyPanelSearch("Condición")).toBe("condicion");
  });

  it("matches partial property labels", () => {
    expect(
      matchesPropertyPanelSearch("consulta", "Eventos y acciones consulta lookup"),
    ).toBe(true);
    expect(matchesPropertyPanelSearch("xyz", "Etiqueta")).toBe(false);
  });

  it("filters searchable blocks in the panel", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <label data-property-search="Etiqueta label">Etiqueta</label>
      <label data-property-search="Obligatorio required">Obligatorio</label>
      <fieldset data-property-search="Eventos acciones consulta">
        <legend>Eventos</legend>
      </fieldset>
    `;
    expect(applyPropertyPanelFilter(root, "etiq")).toBe(1);
    expect(
      root.querySelector('[data-property-search="Etiqueta label"]')?.hidden,
    ).toBe(false);
    expect(
      root.querySelector('[data-property-search="Obligatorio required"]')?.hidden,
    ).toBe(true);
    applyPropertyPanelFilter(root, "");
    expect(
      root.querySelector('[data-property-search="Obligatorio required"]')?.hidden,
    ).toBe(false);
  });
});
