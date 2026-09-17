import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
} from "react";
import { lookupIconLabel, type LookupIcon } from "@savia/crm-shared/request-page";
import { LookupIconPreview } from "./lookup-icon-preview";

const ROW_HEIGHT = 84;
const OVERSCAN_ROWS = 2;
const DEFAULT_VIEWPORT_HEIGHT = 420;

function resolveColumnCount() {
  if (typeof window === "undefined") return 6;
  if (window.matchMedia("(max-width: 480px)").matches) return 3;
  if (window.matchMedia("(max-width: 720px)").matches) return 4;
  return 6;
}

function useGridColumnCount(active: boolean) {
  const [columnCount, setColumnCount] = useState(resolveColumnCount);

  useEffect(() => {
    if (!active) return;
    const update = () => setColumnCount(resolveColumnCount());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [active]);

  return columnCount;
}

export function LookupIconVirtualGrid({
  icons,
  value,
  brand,
  active,
  ariaLabel,
  onSelect,
}: {
  icons: LookupIcon[];
  value: LookupIcon;
  brand: boolean;
  active: boolean;
  ariaLabel: string;
  onSelect: (icon: LookupIcon) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(DEFAULT_VIEWPORT_HEIGHT);
  const columnCount = useGridColumnCount(active);
  const rowCount = Math.max(1, Math.ceil(icons.length / columnCount));

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !active) return;

    const updateViewportHeight = () => {
      setViewportHeight(element.clientHeight || DEFAULT_VIEWPORT_HEIGHT);
    };

    updateViewportHeight();
    if (typeof element.scrollTo === "function") {
      element.scrollTo({ top: 0 });
    } else {
      element.scrollTop = 0;
    }
    setScrollTop(0);

    const observer = new ResizeObserver(updateViewportHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [active, icons, columnCount]);

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  const { startRow, endRow } = useMemo(() => {
    const visibleStart = Math.floor(scrollTop / ROW_HEIGHT);
    const visibleEnd = Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT);
    return {
      startRow: Math.max(0, visibleStart - OVERSCAN_ROWS),
      endRow: Math.min(rowCount, visibleEnd + OVERSCAN_ROWS),
    };
  }, [rowCount, scrollTop, viewportHeight]);

  const rows = useMemo(() => {
    const rendered = [];
    for (let row = startRow; row < endRow; row += 1) {
      const start = row * columnCount;
      const rowIcons = icons.slice(start, start + columnCount);
      rendered.push(
        <div
          key={row}
          className="lookup-icon-picker-grid-row"
          style={{
            top: row * ROW_HEIGHT,
            gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
          }}
        >
          {rowIcons.map((icon) => {
            const label = lookupIconLabel(icon);
            return (
              <button
                key={icon}
                type="button"
                role="option"
                aria-selected={icon === value}
                aria-label={label}
                title={label}
                className={[
                  "lookup-icon-picker-option",
                  icon === value ? "lookup-icon-picker-option--selected" : "",
                  brand ? "lookup-icon-picker-option--brand" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => onSelect(icon)}
              >
                <span
                  className="lookup-icon-picker-option-icon"
                  aria-hidden="true"
                >
                  <LookupIconPreview icon={icon} className="size-5" />
                </span>
                <span className="lookup-icon-picker-option-label">{label}</span>
              </button>
            );
          })}
        </div>,
      );
    }
    return rendered;
  }, [brand, columnCount, endRow, icons, onSelect, startRow, value]);

  return (
    <div
      ref={scrollRef}
      className="lookup-icon-picker-grid"
      role="listbox"
      aria-label={ariaLabel}
      onScroll={handleScroll}
    >
      <div
        className="lookup-icon-picker-grid-track"
        style={{ height: rowCount * ROW_HEIGHT }}
      >
        {rows}
      </div>
    </div>
  );
}
