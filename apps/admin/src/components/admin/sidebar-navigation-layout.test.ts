import { describe, expect, it } from "vitest";
import {
  addCustomSidebarSection,
  blockKey,
  defaultSidebarNavigationLayout,
  normalizeSidebarNavigationLayout,
  reconcileSidebarNavigation,
  removeCustomSidebarSection,
  renameCustomSidebarSection,
  resolveSectionDropTarget,
  resolveSidebarDropTarget,
  moveSidebarSection,
  sidebarBlockSortableId,
  sidebarSectionEndDropId,
  isNavigationItemHidden,
  toggleNavigationItemVisibility,
} from "./sidebar-navigation-layout";

describe("sidebar navigation layout", () => {
  it("defaults section collapse state while preserving saved values", () => {
    const result = normalizeSidebarNavigationLayout({
      version: 2,
      blocks: [
        {
          kind: "builtin",
          id: "operation",
          items: ["dashboard"],
          collapsed: true,
        },
        {
          kind: "custom",
          id: "custom:reports",
          label: "Reportes",
          items: [],
        },
      ],
    });

    expect(result.blocks).toEqual([
      {
        kind: "builtin",
        id: "operation",
        items: ["dashboard"],
        collapsed: true,
      },
      {
        kind: "custom",
        id: "custom:reports",
        label: "Reportes",
        items: [],
        collapsed: false,
      },
    ]);
  });

  it("migrates version 1 layouts to version 2 blocks", () => {
    const layout = normalizeSidebarNavigationLayout({
      version: 1,
      sections: {
        operation: ["dashboard"],
        productivity: ["integrations", "my-day"],
        administration: [],
        management: ["tenants"],
      },
    });
    expect(layout.version).toBe(2);
    expect(
      layout.blocks.find(
        (block) => block.kind === "builtin" && block.id === "operation",
      )?.items,
    ).toEqual(["dashboard"]);
    expect(
      layout.blocks.find(
        (block) => block.kind === "builtin" && block.id === "productivity",
      )?.items,
    ).toEqual(["integrations", "my-day"]);
  });

  it("appends a newly visible resource to its default section", () => {
    const saved = normalizeSidebarNavigationLayout({
      version: 1,
      sections: {
        operation: ["dashboard"],
        productivity: ["integrations", "my-day"],
        administration: [],
        management: ["tenants"],
      },
    });
    expect(
      reconcileSidebarNavigation(saved, [
        "dashboard",
        "my-day",
        "integrations",
        "tenants",
      ]).blocks.find(
        (block) => block.kind === "builtin" && block.id === "management",
      )?.items,
    ).toEqual(["tenants"]);
  });

  it("places a newly visible CRM page in its configured section", () => {
    const reconciled = reconcileSidebarNavigation(
      defaultSidebarNavigationLayout(),
      ["dashboard", "studio", "page:platform:administrar_seguros"],
      { "page:platform:administrar_seguros": "administration" },
    );

    expect(
      reconciled.blocks.find(
        (block) => block.kind === "builtin" && block.id === "administration",
      )?.items,
    ).toContain("page:platform:administrar_seguros");
    expect(
      reconciled.blocks.find(
        (block) => block.kind === "builtin" && block.id === "operation",
      )?.items,
    ).not.toContain("page:platform:administrar_seguros");
  });

  it("creates and removes custom sections", () => {
    const withSection = addCustomSidebarSection(
      defaultSidebarNavigationLayout(),
      "Ventas",
    );
    const custom = withSection.blocks.find((block) => block.kind === "custom");
    expect(custom).toMatchObject({ label: "Ventas", items: [] });
    if (!custom || custom.kind !== "custom") throw new Error("missing custom");
    const removed = removeCustomSidebarSection(withSection, custom.id);
    expect(
      removed.blocks.some(
        (block) => block.kind === "custom" && block.id === custom.id,
      ),
    ).toBe(false);
  });

  it("renames custom sections", () => {
    const withSection = addCustomSidebarSection(
      defaultSidebarNavigationLayout(),
      "Nueva sección",
    );
    const custom = withSection.blocks.find((block) => block.kind === "custom");
    if (!custom || custom.kind !== "custom") throw new Error("missing custom");
    const renamed = renameCustomSidebarSection(
      withSection,
      custom.id,
      "Ventas",
    );
    expect(
      renamed.blocks.find(
        (block) => block.kind === "custom" && block.id === custom.id,
      ),
    ).toMatchObject({ label: "Ventas" });
  });

  it("resolves drop targets for cross-section and same-section moves", () => {
    const layout = normalizeSidebarNavigationLayout({
      version: 1,
      sections: {
        operation: ["dashboard", "studio"],
        productivity: ["my-day", "integrations"],
        administration: [],
        management: [],
      },
    });

    expect(resolveSidebarDropTarget(layout, "dashboard", "my-day")).toEqual({
      blockId: "productivity",
      index: 0,
    });
    expect(
      resolveSidebarDropTarget(
        layout,
        "dashboard",
        "sidebar-section:management",
      ),
    ).toEqual({
      blockId: "management",
      index: 0,
    });
    expect(
      resolveSidebarDropTarget(layout, "dashboard", "integrations"),
    ).toEqual({
      blockId: "productivity",
      index: 1,
    });
  });

  it("reorders sidebar sections", () => {
    const layout = addCustomSidebarSection(
      addCustomSidebarSection(defaultSidebarNavigationLayout(), "Ventas"),
      "Reportes",
    );
    const ventas = layout.blocks.find(
      (block) => block.kind === "custom" && block.label === "Ventas",
    );
    const reportes = layout.blocks.find(
      (block) => block.kind === "custom" && block.label === "Reportes",
    );
    if (
      !ventas ||
      ventas.kind !== "custom" ||
      !reportes ||
      reportes.kind !== "custom"
    ) {
      throw new Error("missing custom sections");
    }

    const movedUp = moveSidebarSection(
      layout,
      blockKey(reportes),
      blockKey(ventas),
    );
    expect(movedUp.blocks.map((block) => blockKey(block))).toEqual([
      "operation",
      "productivity",
      "administration",
      "management",
      blockKey(reportes),
      blockKey(ventas),
    ]);

    const movedEnd = moveSidebarSection(movedUp, "operation");
    expect(movedEnd.blocks.at(-1)).toMatchObject({
      kind: "builtin",
      id: "operation",
    });
  });

  it("resolves section drop targets", () => {
    const layout = addCustomSidebarSection(
      defaultSidebarNavigationLayout(),
      "Ventas",
    );
    const ventas = layout.blocks.find((block) => block.kind === "custom");
    if (!ventas) throw new Error("missing custom section");

    expect(
      resolveSectionDropTarget(
        layout,
        blockKey(ventas),
        sidebarBlockSortableId("productivity"),
      ),
    ).toEqual({ beforeBlockId: "productivity" });
    expect(
      resolveSectionDropTarget(
        layout,
        blockKey(ventas),
        sidebarSectionEndDropId(),
      ),
    ).toEqual({ beforeBlockId: null });
  });

  it("keeps empty custom sections after reconcile", () => {
    const withSection = addCustomSidebarSection(
      defaultSidebarNavigationLayout(),
      "Ventas",
    );
    const reconciled = reconcileSidebarNavigation(withSection, [
      "dashboard",
      "studio",
    ]);
    expect(
      reconciled.blocks.some(
        (block) => block.kind === "custom" && block.label === "Ventas",
      ),
    ).toBe(true);
  });

  it("toggles navigation item visibility and preserves hiddenItems across reconciliation", () => {
    const layout = defaultSidebarNavigationLayout();
    expect(isNavigationItemHidden(layout, "dashboard")).toBe(false);

    const hidden = toggleNavigationItemVisibility(layout, "dashboard");
    expect(isNavigationItemHidden(hidden, "dashboard")).toBe(true);
    expect(hidden.hiddenItems).toEqual(["dashboard"]);

    const unhidden = toggleNavigationItemVisibility(hidden, "dashboard");
    expect(isNavigationItemHidden(unhidden, "dashboard")).toBe(false);
    expect(unhidden.hiddenItems).toEqual([]);

    const reconciled = reconcileSidebarNavigation(hidden, [
      "dashboard",
      "studio",
    ]);
    expect(isNavigationItemHidden(reconciled, "dashboard")).toBe(true);
  });
});

describe("legacy dynamic-crm item migration", () => {
  it("maps the legacy item id to studio when normalizing stored layouts", () => {
    const normalized = normalizeSidebarNavigationLayout({
      version: 2,
      blocks: [
        {
          kind: "builtin",
          id: "operation",
          items: ["my-day", "dynamic-crm"],
          collapsed: false,
        },
      ],
      hiddenItems: ["dynamic-crm"],
    } as unknown as Parameters<typeof normalizeSidebarNavigationLayout>[0]);
    expect(normalized.blocks[0].items).toEqual(["my-day", "studio"]);
    expect(normalized.hiddenItems).toEqual(["studio"]);
  });
});
