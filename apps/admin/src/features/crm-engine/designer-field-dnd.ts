export const designerFieldDragType = "application/x-savia-designer-field";
export const designerPaletteDragType = "application/x-designer-field-type";
export const landDurationMs = 420;
export const flipDurationMs = 280;

const paletteFieldIdPattern = /^[a-z][a-z0-9_]{0,47}$/;

export function normalizePaletteFieldIdInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

export type PaletteFieldIdResolution = {
  id: string;
  error?: string;
  abort?: boolean;
};

export function resolvePaletteFieldId(
  raw: string,
  existingFields: Record<string, unknown>,
  nextAutoId: () => string,
  options?: { strictCustom?: boolean },
): PaletteFieldIdResolution {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { id: nextAutoId() };
  }

  const normalized = normalizePaletteFieldIdInput(raw);
  if (!paletteFieldIdPattern.test(normalized)) {
    const error =
      "El identificador debe empezar con letra y usar solo minúsculas, números y _.";
    if (options?.strictCustom) {
      return { id: nextAutoId(), error, abort: true };
    }
    return { id: nextAutoId(), error };
  }

  if (Object.hasOwn(existingFields, normalized)) {
    const error = "Ese identificador ya existe.";
    if (options?.strictCustom) {
      return { id: nextAutoId(), error, abort: true };
    }
    return { id: nextAutoId(), error };
  }

  return { id: normalized };
}

export function readPaletteFieldType(dataTransfer: DataTransfer) {
  return dataTransfer.getData(designerPaletteDragType) || null;
}

export function isPaletteFieldDrag(dataTransfer: DataTransfer) {
  return dataTransfer.types.includes(designerPaletteDragType);
}

export function isDesignerFieldDrag(dataTransfer: DataTransfer) {
  return dataTransfer.types.includes(designerFieldDragType);
}

export type DropInsert = {
  sectionId: string;
  beforeFieldId: string | null;
};

export function resolveDropInsert(
  list: HTMLElement,
  clientY: number,
  fieldIds: string[],
  excludeFieldId?: string | null,
): { beforeFieldId: string | null } {
  const ids = fieldIds.filter((id) => id !== excludeFieldId);
  if (!ids.length) return { beforeFieldId: null };

  for (const id of ids) {
    const node = list.querySelector(`[data-field-id="${id}"]`);
    if (!(node instanceof HTMLElement)) continue;
    const rect = node.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      return { beforeFieldId: id };
    }
  }
  return { beforeFieldId: null };
}

export function playFlip(
  list: HTMLUListElement,
  before: Map<string, DOMRect>,
  reducedMotion: boolean,
) {
  if (reducedMotion) return;

  list.querySelectorAll("[data-field-id]").forEach((node) => {
    const id = node.getAttribute("data-field-id");
    if (!id || !before.has(id)) return;

    const first = before.get(id)!;
    const last = node.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

    const element = node as HTMLElement;
    element.style.transition = "none";
    element.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => {
      element.style.transition = `transform ${flipDurationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      element.style.transform = "";
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        element.style.transition = "";
        element.style.transform = "";
        element.removeEventListener("transitionend", finish);
      };
      element.addEventListener("transitionend", finish);
      window.setTimeout(finish, flipDurationMs + 60);
    });
  });
}

export function captureZonePositions(list: HTMLUListElement | null) {
  const positions = new Map<string, DOMRect>();
  if (!list) return positions;
  list.querySelectorAll("[data-field-id]").forEach((node) => {
    const id = node.getAttribute("data-field-id");
    if (id) positions.set(id, node.getBoundingClientRect());
  });
  return positions;
}

export function resolvedSectionId(
  fields: Record<string, { config?: { section?: string } }>,
  fieldId: string,
  sectionIds: Set<string>,
): string {
  const section = fields[fieldId]?.config?.section;
  return section && sectionIds.has(section) ? section : "";
}

const groupedDesignerDragGripSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>`;

export function mountGroupedDesignerDragGhost({
  label,
  meta,
  typeIconHtml,
  dataTransfer,
}: {
  label: string;
  meta: string;
  typeIconHtml: string;
  dataTransfer: DataTransfer;
}): HTMLElement {
  const root = document.createElement("div");
  root.className = "savia-crm grouped-designer-drag-ghost-root";

  const chip = document.createElement("div");
  chip.className = "grouped-designer-drag-chip";

  const grip = document.createElement("span");
  grip.className = "grouped-designer-drag-chip-grip";
  grip.innerHTML = groupedDesignerDragGripSvg;

  const icon = document.createElement("span");
  icon.className = "grouped-designer-drag-chip-icon";
  icon.innerHTML = typeIconHtml;

  const labelEl = document.createElement("span");
  labelEl.className = "grouped-designer-drag-chip-label";
  labelEl.textContent = label;
  labelEl.title = label;

  const metaEl = document.createElement("span");
  metaEl.className = "grouped-designer-drag-chip-meta";
  metaEl.textContent = meta;

  chip.append(grip, icon, labelEl, metaEl);
  root.append(chip);
  document.body.appendChild(root);

  dataTransfer.setDragImage(root, 18, 19);
  return root;
}

export function buildGroupedFieldOrder(
  fieldOrder: string[],
  fields: Record<string, { config?: { section?: string } }>,
  sourceId: string,
  targetSectionId: string,
  sectionIds: Set<string>,
  beforeId?: string,
): string[] {
  const order = fieldOrder.filter((id) => id !== sourceId);
  let insertAt = order.length;

  if (beforeId) {
    const targetIndex = order.indexOf(beforeId);
    insertAt = targetIndex < 0 ? order.length : targetIndex;
  } else {
    let lastInSection = -1;
    order.forEach((id, index) => {
      if (resolvedSectionId(fields, id, sectionIds) === targetSectionId) {
        lastInSection = index;
      }
    });
    if (lastInSection >= 0) insertAt = lastInSection + 1;
  }

  order.splice(insertAt, 0, sourceId);
  return order;
}
