import {
  sidebarNavigationSectionIds,
  type SidebarNavigationItemId,
  type SidebarNavigationSection,
} from "@/api/user-preferences-client";

export type SidebarNavigationBuiltinBlock = {
  kind: "builtin";
  id: SidebarNavigationSection;
  items: SidebarNavigationItemId[];
  collapsed: boolean;
};

export type SidebarNavigationCustomBlock = {
  kind: "custom";
  id: `custom:${string}`;
  label: string;
  items: SidebarNavigationItemId[];
  collapsed: boolean;
};

type SidebarNavigationBlockInput =
  | (Omit<SidebarNavigationBuiltinBlock, "collapsed"> & {
      collapsed?: boolean;
    })
  | (Omit<SidebarNavigationCustomBlock, "collapsed"> & {
      collapsed?: boolean;
    });

type SidebarNavigationLayoutInput = {
  version: 2;
  presetVersion?: 2;
  blocks: SidebarNavigationBlockInput[];
  hiddenItems?: SidebarNavigationItemId[];
};

export type SidebarNavigationBlock =
  SidebarNavigationBuiltinBlock | SidebarNavigationCustomBlock;

export type SidebarNavigationLayoutV1 = {
  version: 1;
  sections: Record<SidebarNavigationSection, SidebarNavigationItemId[]>;
};

export type SidebarNavigationLayout = {
  version: 2;
  presetVersion?: 2;
  blocks: SidebarNavigationBlock[];
  hiddenItems?: SidebarNavigationItemId[];
};

export function defaultSidebarNavigationLayout(): SidebarNavigationLayout {
  return {
    ...normalizeSidebarNavigationLayout({
      version: 1,
      sections: {
        operation: ["my-day", "dashboard", "dynamic-crm", "domain-reports"],
        productivity: [
          "page-administrator",
          "domain-sources",
          "domain-workflows",
          "domain-api",
          "provider-credentials",
          "virtual-employees",
          "integrations",
          "domain-packages",
        ],
        administration: [
          "users",
          "access-control",
          "service-credentials",
          "tenant-branding",
          "domain-history",
        ],
        management: ["tenants"],
      },
    }),
    presetVersion: 2,
  };
}

export function normalizeSidebarNavigationLayout(
  value:
    | SidebarNavigationLayout
    | SidebarNavigationLayoutV1
    | SidebarNavigationLayoutInput,
): SidebarNavigationLayout {
  const hiddenItems =
    "hiddenItems" in value && Array.isArray(value.hiddenItems)
      ? [...value.hiddenItems]
      : undefined;
  if (value.version === 2) {
    return {
      version: 2,
      ...("presetVersion" in value && value.presetVersion === 2
        ? { presetVersion: 2 as const }
        : {}),
      blocks: value.blocks.map((block) =>
        block.kind === "builtin"
          ? {
              kind: "builtin",
              id: block.id,
              items: [...block.items],
              collapsed: block.collapsed === true,
            }
          : {
              kind: "custom",
              id: block.id,
              label: block.label,
              items: [...block.items],
              collapsed: block.collapsed === true,
            },
      ),
      ...(hiddenItems ? { hiddenItems } : {}),
    };
  }
  return {
    version: 2,
    blocks: sidebarNavigationSectionIds.map((id) => ({
      kind: "builtin",
      id,
      items: [...value.sections[id]],
      collapsed: false,
    })),
    ...(hiddenItems ? { hiddenItems } : {}),
  };
}

export function blockKey(block: SidebarNavigationBlock): string {
  return block.kind === "builtin" ? block.id : block.id;
}

export function sidebarBlockSortableId(blockId: string): string {
  return `sidebar-block:${blockId}`;
}

export function parseSidebarBlockSortableId(id: string): string | null {
  return id.startsWith("sidebar-block:")
    ? id.slice("sidebar-block:".length)
    : null;
}

export function sidebarSectionEndDropId(): string {
  return "sidebar-section-end";
}

export function blockItems(
  block: SidebarNavigationBlock,
): SidebarNavigationItemId[] {
  return block.items;
}

export function setBlockItems(
  layout: SidebarNavigationLayout,
  blockId: string,
  items: SidebarNavigationItemId[],
): SidebarNavigationLayout {
  return {
    ...layout,
    version: 2,
    blocks: layout.blocks.map((block) =>
      blockKey(block) === blockId ? { ...block, items: [...items] } : block,
    ),
  };
}

export function navigationBlockForItem(
  layout: SidebarNavigationLayout,
  itemId: SidebarNavigationItemId,
): SidebarNavigationBlock | undefined {
  return layout.blocks.find((block) => block.items.includes(itemId));
}

export function resolveSidebarDropTarget(
  layout: SidebarNavigationLayout,
  activeId: SidebarNavigationItemId,
  overId: string,
): { blockId: string; index: number } | null {
  const sourceBlock = navigationBlockForItem(layout, activeId);
  if (!sourceBlock) return null;
  const sourceKey = blockKey(sourceBlock);

  if (overId.startsWith("sidebar-section:")) {
    const targetBlockId = overId.slice("sidebar-section:".length);
    const targetItems =
      layout.blocks.find((block) => blockKey(block) === targetBlockId)?.items ??
      [];
    return { blockId: targetBlockId, index: targetItems.length };
  }

  const overItemId = overId as SidebarNavigationItemId;
  const targetBlock = navigationBlockForItem(layout, overItemId);
  if (!targetBlock) return null;
  const targetBlockId = blockKey(targetBlock);
  const targetIndex = targetBlock.items.indexOf(overItemId);
  if (targetIndex < 0) return null;

  const sourceIndex = sourceBlock.items.indexOf(activeId);
  const adjustedIndex =
    sourceKey === targetBlockId && sourceIndex < targetIndex
      ? targetIndex - 1
      : targetIndex;
  return { blockId: targetBlockId, index: adjustedIndex };
}

export function resolveSectionDropTarget(
  layout: SidebarNavigationLayout,
  activeSectionBlockId: string,
  overId: string,
): { beforeBlockId: string | null } | null {
  if (overId === sidebarSectionEndDropId()) {
    return { beforeBlockId: null };
  }

  const overBlockId = parseSidebarBlockSortableId(overId);
  if (overBlockId) {
    if (overBlockId === activeSectionBlockId) return null;
    return { beforeBlockId: overBlockId };
  }

  if (overId.startsWith("sidebar-section:")) {
    const blockId = overId.slice("sidebar-section:".length);
    if (blockId === activeSectionBlockId) return null;
    return { beforeBlockId: blockId };
  }

  const itemBlock = navigationBlockForItem(
    layout,
    overId as SidebarNavigationItemId,
  );
  if (!itemBlock) return null;
  const blockId = blockKey(itemBlock);
  if (blockId === activeSectionBlockId) return null;
  return { beforeBlockId: blockId };
}

export function moveSidebarSection(
  layout: SidebarNavigationLayout,
  sectionBlockId: string,
  beforeBlockId?: string,
): SidebarNavigationLayout {
  const sourceIndex = layout.blocks.findIndex(
    (block) => blockKey(block) === sectionBlockId,
  );
  if (sourceIndex < 0) return layout;
  const moving = layout.blocks[sourceIndex];
  const rest = layout.blocks.filter((_, index) => index !== sourceIndex);
  let insertAt = rest.length;
  if (beforeBlockId) {
    const targetIndex = rest.findIndex(
      (block) => blockKey(block) === beforeBlockId,
    );
    insertAt = targetIndex < 0 ? rest.length : targetIndex;
  }
  const blocks = [...rest];
  blocks.splice(insertAt, 0, moving);
  return { ...layout, version: 2, blocks };
}

export function moveNavigationItem(
  layout: SidebarNavigationLayout,
  itemId: SidebarNavigationItemId,
  destinationBlockId: string,
  destinationIndex: number,
): SidebarNavigationLayout {
  const sourceBlock = navigationBlockForItem(layout, itemId);
  if (!sourceBlock) return layout;
  const sourceKey = blockKey(sourceBlock);
  if (sourceKey === destinationBlockId) {
    const items = [...sourceBlock.items];
    const sourceIndex = items.indexOf(itemId);
    items.splice(sourceIndex, 1);
    const insertionIndex = Math.max(
      0,
      Math.min(destinationIndex, items.length),
    );
    items.splice(insertionIndex, 0, itemId);
    return setBlockItems(layout, sourceKey, items);
  }
  const next = setBlockItems(
    layout,
    sourceKey,
    sourceBlock.items.filter((id) => id !== itemId),
  );
  const destination = next.blocks.find(
    (block) => blockKey(block) === destinationBlockId,
  );
  if (!destination) return next;
  const items = [...destination.items];
  items.splice(
    Math.max(0, Math.min(destinationIndex, items.length)),
    0,
    itemId,
  );
  return setBlockItems(next, destinationBlockId, items);
}

export function addCustomSidebarSection(
  layout: SidebarNavigationLayout,
  label: string,
  afterBlockId?: string,
): SidebarNavigationLayout {
  const block: SidebarNavigationCustomBlock = {
    kind: "custom",
    id: `custom:${Date.now().toString(36)}`,
    label: label.trim() || "Nueva sección",
    items: [],
    collapsed: false,
  };
  if (!afterBlockId) {
    return { ...layout, version: 2, blocks: [...layout.blocks, block] };
  }
  const blocks: SidebarNavigationBlock[] = [];
  let inserted = false;
  for (const current of layout.blocks) {
    blocks.push(current);
    if (blockKey(current) === afterBlockId) {
      blocks.push(block);
      inserted = true;
    }
  }
  if (!inserted) blocks.push(block);
  return { ...layout, version: 2, blocks };
}

export function renameCustomSidebarSection(
  layout: SidebarNavigationLayout,
  blockId: `custom:${string}`,
  label: string,
): SidebarNavigationLayout {
  const trimmed = label.trim();
  if (!trimmed) return layout;
  return {
    ...layout,
    version: 2,
    blocks: layout.blocks.map((block) =>
      block.kind === "custom" && block.id === blockId
        ? { ...block, label: trimmed }
        : block,
    ),
  };
}

export function removeCustomSidebarSection(
  layout: SidebarNavigationLayout,
  blockId: `custom:${string}`,
  label?: string,
): SidebarNavigationLayout {
  const target = layout.blocks.find(
    (block): block is SidebarNavigationCustomBlock =>
      block.kind === "custom" && block.id === blockId,
  );
  if (!target) return layout;
  const operationIndex = layout.blocks.findIndex(
    (block) => block.kind === "builtin" && block.id === "operation",
  );
  const fallbackIndex = operationIndex >= 0 ? operationIndex : 0;
  const blocks = layout.blocks
    .filter((block) => block.kind !== "custom" || block.id !== blockId)
    .map((block, index) =>
      index === fallbackIndex
        ? { ...block, items: [...block.items, ...target.items] }
        : block,
    );
  return { ...layout, version: 2, blocks };
}

export function defaultSectionForItem(
  itemId: SidebarNavigationItemId,
  configuredSections: Readonly<
    Partial<Record<SidebarNavigationItemId, SidebarNavigationSection>>
  > = {},
): SidebarNavigationSection {
  const configured = configuredSections[itemId];
  if (configured) return configured;
  if (itemId === "page-administrator") return "productivity";
  if (itemId.startsWith("page:")) return "operation";
  const defaults: Partial<
    Record<SidebarNavigationItemId, SidebarNavigationSection>
  > = {
    "domain-sources": "productivity",
    "domain-workflows": "productivity",
    "domain-api": "productivity",
    "domain-packages": "productivity",
    "virtual-employees": "productivity",
    "domain-reports": "operation",
    "domain-history": "administration",
    "tenant-branding": "administration",
    dashboard: "operation",
    "dynamic-crm": "operation",
    "my-day": "operation",
    integrations: "productivity",
    "provider-credentials": "productivity",
    "service-credentials": "administration",
    "access-control": "administration",
    tenants: "management",
    users: "administration",
  };
  return defaults[itemId as SidebarNavigationItemId] ?? "operation";
}

export function isNavigationItemHidden(
  layout: SidebarNavigationLayout,
  itemId: SidebarNavigationItemId,
): boolean {
  return layout.hiddenItems?.includes(itemId) ?? false;
}

export function toggleNavigationItemVisibility(
  layout: SidebarNavigationLayout,
  itemId: SidebarNavigationItemId,
): SidebarNavigationLayout {
  const current = layout.hiddenItems ?? [];
  const isHidden = current.includes(itemId);
  const nextHidden = isHidden
    ? current.filter((id) => id !== itemId)
    : [...current, itemId];
  return {
    ...layout,
    hiddenItems: nextHidden,
  };
}

export function reconcileSidebarNavigation(
  layout: SidebarNavigationLayout | SidebarNavigationLayoutV1,
  visibleItemIds: readonly SidebarNavigationItemId[],
  configuredSections: Readonly<
    Partial<Record<SidebarNavigationItemId, SidebarNavigationSection>>
  > = {},
): SidebarNavigationLayout {
  const normalized = normalizeSidebarNavigationLayout(layout);
  const visible = new Set(visibleItemIds);
  const included = new Set<SidebarNavigationItemId>();
  const explicitlyPlaced = new Set(
    normalized.blocks.flatMap((block) => block.items),
  );
  const blocks = normalized.blocks.map((block) => ({
    ...block,
    items: [] as SidebarNavigationItemId[],
  }));

  for (const [index, block] of normalized.blocks.entries()) {
    for (const itemId of block.items) {
      if (itemId === "dynamic-crm") {
        for (const page of visibleItemIds.filter(
          (id) =>
            id.startsWith("page:") &&
            !explicitlyPlaced.has(id) &&
            defaultSectionForItem(id, configuredSections) === "operation",
        )) {
          if (!included.has(page)) {
            blocks[index].items.push(page);
            included.add(page);
          }
        }
      }
      if (visible.has(itemId) && !included.has(itemId)) {
        blocks[index].items.push(itemId);
        included.add(itemId);
      }
    }
  }

  for (const itemId of visibleItemIds) {
    if (!visible.has(itemId) || included.has(itemId)) continue;
    const destination =
      blocks.find(
        (block) =>
          block.kind === "builtin" &&
          block.id === defaultSectionForItem(itemId, configuredSections),
      ) ?? blocks[0];
    if (!destination) continue;
    destination.items.push(itemId);
    included.add(itemId);
  }

  return {
    version: 2,
    ...(normalized.presetVersion === 2 ? { presetVersion: 2 as const } : {}),
    blocks,
    ...(normalized.hiddenItems
      ? { hiddenItems: [...normalized.hiddenItems] }
      : {}),
  };
}

/** Upgrade recognized legacy defaults only; preserve customized built-in and custom groups. */
export function upgradeSidebarNavigationPreset(
  layout: SidebarNavigationLayout,
): SidebarNavigationLayout {
  if (layout.presetVersion === 2) return layout;
  let next = normalizeSidebarNavigationLayout(layout);
  const relocations: Array<
    [
      SidebarNavigationItemId,
      SidebarNavigationSection,
      SidebarNavigationSection,
    ]
  > = [
    ["my-day", "productivity", "operation"],
    ["provider-credentials", "administration", "productivity"],
    ["users", "management", "administration"],
    ["page-administrator", "management", "productivity"],
  ];
  const legacyDefaults: Partial<
    Record<SidebarNavigationSection, SidebarNavigationItemId[]>
  > = {
    productivity: ["my-day", "integrations"],
    administration: [
      "provider-credentials",
      "service-credentials",
      "access-control",
    ],
    management: ["tenants", "users", "page-administrator"],
  };
  const untouchedSections = new Set(
    layout.blocks
      .filter(
        (block) =>
          block.kind === "builtin" &&
          JSON.stringify(
            block.items.filter((id) => !id.startsWith("page:")),
          ) === JSON.stringify(legacyDefaults[block.id]),
      )
      .map((block) => block.id),
  );
  for (const [item, from, to] of relocations) {
    if (!untouchedSections.has(from)) continue;
    const block = navigationBlockForItem(next, item);
    if (block?.kind === "builtin" && block.id === from) {
      next = moveNavigationItem(next, item, to, Number.MAX_SAFE_INTEGER);
    }
  }
  return { ...next, presetVersion: 2 };
}
