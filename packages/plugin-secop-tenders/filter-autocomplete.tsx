import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import "./filter-autocomplete.css";

type FilterAutocompleteProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  noOptionsLabel?: string;
  toggleLabel?: string;
};

const MAX_SUGGESTIONS = 50;

function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();
}

export function filterAutocompleteOptions(
  options: string[],
  query: string,
): string[] {
  const normalizedQuery = normalizeForSearch(query);
  const seen = new Set<string>();

  return options.filter((option) => {
    const normalizedOption = normalizeForSearch(option);
    if (seen.has(option)) return false;
    seen.add(option);
    return normalizedOption.includes(normalizedQuery);
  });
}

export function FilterAutocomplete({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  noOptionsLabel = "No options found",
  toggleLabel = "Show options",
}: FilterAutocompleteProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(MAX_SUGGESTIONS);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [hasTypedSinceOpen, setHasTypedSinceOpen] = useState(false);
  const listboxId = `${id}-listbox`;
  const allOptions = useMemo(
    () => filterAutocompleteOptions(options, ""),
    [options],
  );
  const matchingOptions = useMemo(
    () =>
      hasTypedSinceOpen
        ? filterAutocompleteOptions(options, value)
        : allOptions,
    [allOptions, hasTypedSinceOpen, options, value],
  );
  const suggestions = matchingOptions.slice(0, visibleCount);
  const activeOption = isOpen ? suggestions[activeIndex] : undefined;

  useEffect(() => {
    if (!isOpen || !activeOption) return;
    const option = document.getElementById(`${id}-option-${activeIndex}`);
    if (typeof option?.scrollIntoView === "function") {
      option.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, activeOption, id, isOpen]);

  function openOptions() {
    setVisibleCount(MAX_SUGGESTIONS);
    setIsOpen(true);
    setHasTypedSinceOpen(false);
    setActiveIndex(-1);
  }

  function choose(option: string) {
    onChange(option);
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
      setIsOpen(false);
      setActiveIndex(-1);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setHasTypedSinceOpen(false);
        setActiveIndex(allOptions.length > 0 ? 0 : -1);
      } else if (suggestions.length > 0) {
        const next = activeIndex + 1;
        if (
          next >= suggestions.length &&
          suggestions.length < matchingOptions.length
        ) {
          setVisibleCount((count) => count + MAX_SUGGESTIONS);
          setActiveIndex(next);
        } else setActiveIndex(next % suggestions.length);
      }
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setHasTypedSinceOpen(false);
        setActiveIndex(Math.min(allOptions.length, MAX_SUGGESTIONS) - 1);
      } else if (suggestions.length > 0) {
        setActiveIndex((current) =>
          current <= 0 ? suggestions.length - 1 : current - 1,
        );
      }
      return;
    }

    if (event.key === "Enter" && isOpen && activeOption) {
      event.preventDefault();
      event.stopPropagation();
      choose(activeOption);
      return;
    }

    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <div ref={rootRef} className="secop-autocomplete" onBlur={handleBlur}>
      <label htmlFor={id}>{label}</label>
      <div className="secop-autocomplete-control">
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={
            activeOption ? `${id}-option-${activeIndex}` : undefined
          }
          value={value}
          placeholder={placeholder}
          onFocus={openOptions}
          onChange={(event) => {
            onChange(event.currentTarget.value);
            setIsOpen(true);
            setVisibleCount(MAX_SUGGESTIONS);
            setHasTypedSinceOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={handleKeyDown}
        />
        <button
          className="secop-autocomplete-toggle"
          type="button"
          aria-label={toggleLabel}
          aria-expanded={isOpen}
          aria-controls={listboxId}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const shouldOpen = !isOpen;
            setIsOpen(shouldOpen);
            setHasTypedSinceOpen(false);
            setActiveIndex(-1);
            if (shouldOpen) inputRef.current?.focus();
          }}
        >
          <span aria-hidden="true" className="secop-autocomplete-chevron">
            ▾
          </span>
        </button>
      </div>
      {isOpen && (
        <ul
          id={listboxId}
          className="secop-autocomplete-listbox"
          role="listbox"
          onScroll={(event) => {
            const list = event.currentTarget;
            if (list.scrollTop + list.clientHeight >= list.scrollHeight - 40) {
              setVisibleCount((count) =>
                Math.min(count + MAX_SUGGESTIONS, matchingOptions.length),
              );
            }
          }}
          aria-label={label}
        >
          {suggestions.length > 0 ? (
            suggestions.map((option, index) => (
              <li
                id={`${id}-option-${index}`}
                key={`${option}-${index}`}
                className="secop-autocomplete-option"
                role="option"
                aria-selected={activeIndex === index}
                aria-setsize={matchingOptions.length}
                aria-posinset={index + 1}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                {option}
              </li>
            ))
          ) : (
            <li className="secop-autocomplete-empty" role="presentation">
              {noOptionsLabel}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
