export function normalizePropertyPanelSearch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

export function matchesPropertyPanelSearch(
  query: string,
  haystack: string,
): boolean {
  const needle = normalizePropertyPanelSearch(query);
  if (!needle) return true;
  return normalizePropertyPanelSearch(haystack).includes(needle);
}

export function propertySearchTerms(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function applyPropertyPanelFilter(
  root: HTMLElement,
  query: string,
): number {
  const blocks = root.querySelectorAll<HTMLElement>("[data-property-search]");
  const normalized = normalizePropertyPanelSearch(query);
  if (!normalized) {
    blocks.forEach((block) => {
      block.hidden = false;
    });
    root.querySelectorAll<HTMLElement>("details, fieldset").forEach((el) => {
      el.hidden = false;
    });
    root.querySelectorAll<HTMLElement>(".studio-property-section").forEach((el) => {
      delete el.dataset.propertyFilterMatch;
    });
    root.dataset.filterEmpty = "false";
    root.dataset.filtering = "false";
    blocks.forEach((block) => {
      delete block.dataset.propertyFilterMatch;
    });
    return blocks.length;
  }

  let visibleCount = 0;
  blocks.forEach((block) => {
    const haystack = block.dataset.propertySearch ?? "";
    const visible = matchesPropertyPanelSearch(query, haystack);
    block.hidden = !visible;
    if (normalized) {
      block.dataset.propertyFilterMatch = visible ? "true" : "false";
    } else {
      delete block.dataset.propertyFilterMatch;
    }
    if (visible) visibleCount += 1;
  });

  root.dataset.filtering = normalized ? "true" : "false";

  root.querySelectorAll<HTMLDetailsElement>("details").forEach((details) => {
    const searchable = details.querySelectorAll<HTMLElement>(
      "[data-property-search]",
    );
    const hasVisible = Array.from(searchable).some((el) => !el.hidden);
    details.hidden = !hasVisible;
    if (hasVisible) details.open = true;
  });

  root
    .querySelectorAll<HTMLDetailsElement>(".studio-property-section")
    .forEach((section) => {
      const sectionHaystack = section.dataset.propertySearch ?? "";
      const sectionMatches = matchesPropertyPanelSearch(query, sectionHaystack);
      const searchable = section.querySelectorAll<HTMLElement>(
        "[data-property-search]",
      );
      const hasVisibleChild = Array.from(searchable).some((el) => !el.hidden);
      section.dataset.propertyFilterMatch =
        sectionMatches || hasVisibleChild ? "true" : "false";
    });

  root.querySelectorAll<HTMLFieldSetElement>("fieldset").forEach((fieldset) => {
    if (fieldset.dataset.propertySearch) return;
    const searchable = fieldset.querySelectorAll<HTMLElement>(
      "[data-property-search]",
    );
    if (!searchable.length) return;
    const hasVisible = Array.from(searchable).some((el) => !el.hidden);
    fieldset.hidden = !hasVisible;
  });

  root.dataset.filterEmpty = visibleCount === 0 ? "true" : "false";
  return visibleCount;
}
