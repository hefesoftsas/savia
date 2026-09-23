import { useAppLocale } from "@/i18n/core";
import { useLayoutEffect, useState, type RefObject } from "react";
import { applyPropertyPanelFilter } from "@savia/studio-shared/property-panel-search";

export function usePropertyPanelFilter(
  query: string,
  containerRef: RefObject<HTMLElement | null>,
  resetKey: string,
) {
  const locale = useAppLocale();
  const [empty, setEmpty] = useState(false);
  const [matchCount, setMatchCount] = useState(0);

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const visibleCount = applyPropertyPanelFilter(root, query);
    const filtering = query.trim().length > 0;
    setMatchCount(visibleCount);
    setEmpty(filtering && visibleCount === 0);
  }, [containerRef, query, resetKey, locale]);

  return {
    empty,
    matchCount,
    filtering: query.trim().length > 0,
  };
}
