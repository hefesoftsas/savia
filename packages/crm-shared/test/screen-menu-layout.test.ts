// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  addMenuSection,
  defaultMenuLayout,
  getMenuBlocks,
  moveScreenToSection,
  reconcileMenuLayout,
  removeMenuSection,
  reorderScreensListInLayout,
  renameMenuSection,
  screenNamesFromLayout,
} from "../src/screen-menu-layout";

describe("screen-menu-layout", () => {
  it("builds a default flat layout from screen names", () => {
    const layout = defaultMenuLayout(["a", "b"]);
    expect(screenNamesFromLayout(layout)).toEqual(["a", "b"]);
    expect(getMenuBlocks(layout)).toEqual([
      { kind: "ungrouped", screens: ["a", "b"] },
    ]);
  });

  it("reconciles missing and inactive screens", () => {
    const layout = reconcileMenuLayout(
      {
        version: 1,
        blocks: [
          { kind: "section", id: "sales", label: "Ventas", screens: ["a"] },
        ],
      },
      ["a", "b"],
    );
    expect(screenNamesFromLayout(layout)).toEqual(["a", "b"]);
    expect(getMenuBlocks(layout)).toEqual([
      { kind: "section", id: "sales", label: "Ventas", screens: ["a"] },
      { kind: "ungrouped", screens: ["b"] },
    ]);
  });

  it("adds, renames and removes sections", () => {
    let layout = defaultMenuLayout(["a", "b"]);
    layout = addMenuSection(layout, "Operación");
    const sectionId = layout.blocks.find((block) => block.kind === "section")?.id ?? "";
    layout = moveScreenToSection(layout, "a", sectionId);
    layout = renameMenuSection(layout, sectionId, "Cotización");
    layout = removeMenuSection(layout, sectionId);
    expect(getMenuBlocks(layout)).toEqual([
      { kind: "ungrouped", screens: ["b", "a"] },
    ]);
  });

  it("keeps empty sections during reconcile", () => {
    const layout = reconcileMenuLayout(
      {
        version: 1,
        blocks: [
          { kind: "section", id: "sales", label: "Ventas", screens: [] },
          { kind: "ungrouped", screens: ["a"] },
        ],
      },
      ["a"],
    );
    expect(getMenuBlocks(layout)).toEqual([
      { kind: "section", id: "sales", label: "Ventas", screens: [] },
      { kind: "ungrouped", screens: ["a"] },
    ]);
  });

  it("reorders screens while preserving section membership", () => {
    const layout = reconcileMenuLayout(
      {
        version: 1,
        blocks: [
          { kind: "section", id: "ops", label: "Operación", screens: ["a", "b"] },
          { kind: "section", id: "tools", label: "Herramientas", screens: ["c"] },
        ],
      },
      ["a", "b", "c"],
    );
    const next = reorderScreensListInLayout(layout, "b", "a");
    expect(screenNamesFromLayout(next)).toEqual(["b", "a", "c"]);
    expect(getMenuBlocks(next)).toEqual([
      { kind: "section", id: "ops", label: "Operación", screens: ["b", "a"] },
      { kind: "section", id: "tools", label: "Herramientas", screens: ["c"] },
    ]);
  });
});
