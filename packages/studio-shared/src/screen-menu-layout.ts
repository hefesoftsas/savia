import { z } from "zod";

export const menuBlockSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ungrouped"),
    screens: z.array(z.string().min(1).max(300)),
  }),
  z.object({
    kind: z.literal("section"),
    id: z.string().min(1).max(48),
    label: z.string().trim().min(1).max(80),
    screens: z.array(z.string().min(1).max(300)),
  }),
]);

export const screenMenuLayoutSchema = z.object({
  version: z.literal(1),
  blocks: z.array(menuBlockSchema),
});

const legacyScreenMenuLayoutSchema = z.object({
  version: z.literal(1),
  entries: z.array(
    z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("section"),
        id: z.string(),
        label: z.string(),
      }),
      z.object({ kind: z.literal("screen"), name: z.string() }),
    ]),
  ),
});

export type MenuBlock = z.infer<typeof menuBlockSchema>;
export type ScreenMenuLayout = z.infer<typeof screenMenuLayoutSchema>;

export function createMenuSectionId(): string {
  return `menu_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeMenuLayout(
  layout: ScreenMenuLayout | z.infer<typeof legacyScreenMenuLayoutSchema> | null | undefined,
): ScreenMenuLayout | null {
  if (!layout) return null;
  const current = screenMenuLayoutSchema.safeParse(layout);
  if (current.success) return current.data;
  const legacy = legacyScreenMenuLayoutSchema.safeParse(layout);
  if (!legacy.success) return null;
  return {
    version: 1,
    blocks: parseLegacyEntries(legacy.data.entries),
  };
}

function parseLegacyEntries(
  entries: z.infer<typeof legacyScreenMenuLayoutSchema>["entries"],
): MenuBlock[] {
  const blocks: MenuBlock[] = [];
  let current: MenuBlock | null = null;

  const pushCurrent = () => {
    if (!current) return;
    if (current.kind === "section" || current.screens.length) blocks.push(current);
    current = null;
  };

  for (const entry of entries) {
    if (entry.kind === "section") {
      pushCurrent();
      current = {
        kind: "section",
        id: entry.id,
        label: entry.label,
        screens: [],
      };
      continue;
    }
    if (!current) current = { kind: "ungrouped", screens: [] };
    current.screens.push(entry.name);
  }
  pushCurrent();
  return blocks;
}

export function defaultMenuLayout(screenNames: readonly string[]): ScreenMenuLayout {
  if (!screenNames.length) return { version: 1, blocks: [] };
  return {
    version: 1,
    blocks: [{ kind: "ungrouped", screens: [...screenNames] }],
  };
}

export function getMenuBlocks(layout: ScreenMenuLayout): MenuBlock[] {
  return layout.blocks;
}

export function screenNamesFromLayout(layout: ScreenMenuLayout): string[] {
  return layout.blocks.flatMap((block) => block.screens);
}

export function reconcileMenuLayout(
  layout: ScreenMenuLayout | null | undefined,
  activeScreenNames: readonly string[],
): ScreenMenuLayout {
  const active = new Set(activeScreenNames);
  const seen = new Set<string>();
  const blocks: MenuBlock[] = [];

  for (const block of layout?.blocks ?? []) {
    const screens = block.screens.filter((name) => {
      if (!active.has(name) || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
    if (block.kind === "section") {
      blocks.push({ ...block, screens });
      continue;
    }
    if (screens.length) blocks.push({ kind: "ungrouped", screens });
  }

  const missing = activeScreenNames.filter((name) => !seen.has(name));
  if (missing.length) {
    const last = blocks[blocks.length - 1];
    if (last?.kind === "ungrouped") {
      blocks[blocks.length - 1] = {
        kind: "ungrouped",
        screens: [...last.screens, ...missing],
      };
    } else {
      blocks.push({ kind: "ungrouped", screens: [...missing] });
    }
  }

  return { version: 1, blocks: mergeUngroupedBlocks(blocks) };
}

export function addMenuSection(
  layout: ScreenMenuLayout,
  label = "Nueva sección",
): ScreenMenuLayout {
  return {
    version: 1,
    blocks: [
      ...layout.blocks,
      { kind: "section", id: createMenuSectionId(), label, screens: [] },
    ],
  };
}

export function renameMenuSection(
  layout: ScreenMenuLayout,
  sectionId: string,
  label: string,
): ScreenMenuLayout {
  const trimmed = label.trim();
  if (!trimmed) return layout;
  return {
    version: 1,
    blocks: layout.blocks.map((block) =>
      block.kind === "section" && block.id === sectionId
        ? { ...block, label: trimmed }
        : block,
    ),
  };
}

export function removeMenuSection(
  layout: ScreenMenuLayout,
  sectionId: string,
): ScreenMenuLayout {
  const nextBlocks: MenuBlock[] = [];
  for (const block of layout.blocks) {
    if (block.kind === "section" && block.id === sectionId) {
      if (!block.screens.length) continue;
      const previous = nextBlocks[nextBlocks.length - 1];
      if (previous?.kind === "ungrouped") {
        nextBlocks[nextBlocks.length - 1] = {
          kind: "ungrouped",
          screens: [...previous.screens, ...block.screens],
        };
      } else {
        nextBlocks.push({ kind: "ungrouped", screens: [...block.screens] });
      }
      continue;
    }
    nextBlocks.push(block);
  }
  return { version: 1, blocks: mergeUngroupedBlocks(nextBlocks) };
}

export function reorderScreensListInLayout(
  layout: ScreenMenuLayout,
  sourceName: string,
  beforeName?: string,
): ScreenMenuLayout {
  const names = screenNamesFromLayout(layout);
  if (!names.includes(sourceName)) return layout;
  const nextNames = [...names.filter((name) => name !== sourceName)];
  let insertAt = nextNames.length;
  if (beforeName) {
    const targetIndex = nextNames.indexOf(beforeName);
    insertAt = targetIndex < 0 ? nextNames.length : targetIndex;
  }
  nextNames.splice(insertAt, 0, sourceName);
  return rebuildLayoutPreservingSections(layout, nextNames);
}

function rebuildLayoutPreservingSections(
  layout: ScreenMenuLayout,
  orderedNames: readonly string[],
): ScreenMenuLayout {
  const sectionsByScreen = new Map<string, string | undefined>();
  for (const block of layout.blocks) {
    if (block.kind === "section") {
      for (const name of block.screens) sectionsByScreen.set(name, block.id);
    } else {
      for (const name of block.screens) sectionsByScreen.set(name, undefined);
    }
  }

  const sectionMeta = new Map<string, MenuBlock & { kind: "section" }>();
  for (const block of layout.blocks) {
    if (block.kind === "section") {
      sectionMeta.set(block.id, { ...block, screens: [] });
    }
  }

  const ungrouped: string[] = [];
  for (const name of orderedNames) {
    const sectionId = sectionsByScreen.get(name);
    if (sectionId && sectionMeta.has(sectionId)) {
      sectionMeta.get(sectionId)!.screens.push(name);
    } else {
      ungrouped.push(name);
    }
  }

  const nextBlocks: MenuBlock[] = [];
  if (ungrouped.length) nextBlocks.push({ kind: "ungrouped", screens: ungrouped });
  for (const block of layout.blocks) {
    if (block.kind !== "section") continue;
    const section = sectionMeta.get(block.id);
    if (!section || !section.screens.length) continue;
    nextBlocks.push(section);
  }
  return { version: 1, blocks: nextBlocks };
}

export function moveScreenToSection(
  layout: ScreenMenuLayout,
  screenName: string,
  sectionId: string | null,
  beforeName?: string,
): ScreenMenuLayout {
  let moving: string | undefined;
  const stripped = layout.blocks
    .map((block) => ({
      ...block,
      screens: block.screens.filter((name) => {
        if (name !== screenName) return true;
        moving = name;
        return false;
      }),
    }))
    .filter((block) => block.kind === "section" || block.screens.length > 0);
  if (!moving) return layout;

  const targetBlockIndex =
    sectionId == null
      ? stripped.findIndex((block) => block.kind === "ungrouped")
      : stripped.findIndex(
          (block) => block.kind === "section" && block.id === sectionId,
        );

  let nextBlocks: MenuBlock[];
  if (targetBlockIndex < 0) {
    const sectionBlock = layout.blocks.find(
      (block): block is Extract<MenuBlock, { kind: "section" }> =>
        block.kind === "section" && block.id === sectionId,
    );
    if (!sectionId || !sectionBlock) {
      nextBlocks = [...stripped, { kind: "ungrouped", screens: [moving] }];
    } else {
      nextBlocks = [
        ...stripped,
        { kind: "section", id: sectionBlock.id, label: sectionBlock.label, screens: [moving] },
      ];
    }
  } else {
    nextBlocks = stripped.map((block, index) => {
      if (index !== targetBlockIndex) return block;
      const screens = [...block.screens];
      let insertAt = screens.length;
      if (beforeName) {
        const targetIndex = screens.indexOf(beforeName);
        insertAt = targetIndex < 0 ? screens.length : targetIndex;
      }
      screens.splice(insertAt, 0, moving!);
      return { ...block, screens };
    });
  }

  return { version: 1, blocks: mergeUngroupedBlocks(nextBlocks) };
}

export function moveMenuSectionBlock(
  layout: ScreenMenuLayout,
  sectionId: string,
  beforeSectionId?: string,
): ScreenMenuLayout {
  const moving = layout.blocks.find(
    (block): block is Extract<MenuBlock, { kind: "section" }> =>
      block.kind === "section" && block.id === sectionId,
  );
  if (!moving) return layout;
  const rest = layout.blocks.filter(
    (block) => block.kind !== "section" || block.id !== sectionId,
  );
  const sectionOnly = rest.filter(
    (block): block is Extract<MenuBlock, { kind: "section" }> =>
      block.kind === "section",
  );
  let insertAt = sectionOnly.length;
  if (beforeSectionId) {
    const targetIndex = sectionOnly.findIndex((block) => block.id === beforeSectionId);
    insertAt = targetIndex < 0 ? sectionOnly.length : targetIndex;
  }
  const nextSections = [...sectionOnly];
  nextSections.splice(insertAt, 0, moving);

  const ungrouped = rest.find(
    (block): block is Extract<MenuBlock, { kind: "ungrouped" }> =>
      block.kind === "ungrouped",
  );
  const nextBlocks: MenuBlock[] = [];
  if (ungrouped?.screens.length) nextBlocks.push(ungrouped);
  nextBlocks.push(...nextSections);
  return { version: 1, blocks: nextBlocks };
}

function mergeUngroupedBlocks(blocks: MenuBlock[]): MenuBlock[] {
  const merged: MenuBlock[] = [];
  for (const block of blocks) {
    if (block.kind !== "ungrouped") {
      merged.push(block);
      continue;
    }
    const previous = merged[merged.length - 1];
    if (previous?.kind === "ungrouped") {
      merged[merged.length - 1] = {
        kind: "ungrouped",
        screens: [...previous.screens, ...block.screens],
      };
    } else {
      merged.push(block);
    }
  }
  return merged;
}

export function hasMenuSections(layout: ScreenMenuLayout | null | undefined): boolean {
  return Boolean(layout?.blocks.some((block) => block.kind === "section"));
}

/** @deprecated Use getMenuBlocks instead */
export function parseMenuBlocks(entries: readonly { kind: string }[]): MenuBlock[] {
  return parseLegacyEntries(
    entries as z.infer<typeof legacyScreenMenuLayoutSchema>["entries"],
  );
}
