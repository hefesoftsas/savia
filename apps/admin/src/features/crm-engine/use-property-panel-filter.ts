import { useLayoutEffect, useState, type RefObject } from "react";
import { applyPropertyPanelFilter } from "@savia/crm-shared/property-panel-search";

export function usePropertyPanelFilter(
  query: string,
  containerRef: RefObject<HTMLElement | null>,
  resetKey: string,
) {
  const [empty, setEmpty] = useState(false);
  const [matchCount, setMatchCount] = useState(0);

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const visibleCount = applyPropertyPanelFilter(root, query);
    const filtering = query.trim().length > 0;
    setMatchCount(visibleCount);
    setEmpty(filtering && visibleCount === 0);
  }, [containerRef, query, resetKey]);

  return {
    empty,
    matchCount,
    filtering: query.trim().length > 0,
  };
}
