import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { Check, X } from "lucide-react";
import "./filter-autocomplete.css";

type FilterAutocompleteProps = {
  id: string;
  label: string;
  options: string[];
  placeholder?: string;
  noOptionsLabel?: string;
  toggleLabel?: string;
  removeLabel?: string;
  limitLabel?: string;
} & (
  | { multiple?: false; value: string; onChange: (value: string) => void }
  | { multiple: true; value: string[]; onChange: (value: string[]) => void }
);

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

export function FilterAutocomplete(props: FilterAutocompleteProps) {
  const {
    id,
    label,
    options,
    placeholder,
    noOptionsLabel = "No options found",
    toggleLabel = "Show options",
    removeLabel = "Remove",
    limitLabel = "Maximum 20 values per filter",
  } = props;
  const [query, setQuery] = useState("");
  const value = props.multiple ? query : props.value;
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
    if (props.multiple) {
      if (props.value.length >= 20 && !props.value.includes(option)) return;
      props.onChange(
        props.value.includes(option)
          ? props.value.filter((value) => value !== option)
          : [...props.value, option].slice(0, 20),
      );
      setQuery("");
      setHasTypedSinceOpen(false);
      inputRef.current?.focus();
    } else {
      props.onChange(option);
      setIsOpen(false);
    }
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

    if (
      event.key === "Enter" &&
      props.multiple &&
      isOpen &&
      !activeOption &&
      query.trim()
    ) {
      event.preventDefault();
      event.stopPropagation();
      choose(query.trim());
      return;
    }
    if (
      event.key === "Backspace" &&
      props.multiple &&
      !query &&
      props.value.length
    ) {
      props.onChange(props.value.slice(0, -1));
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
      {props.multiple && props.value.length > 0 && (
        <div className="secop-filter-selections">
          {props.value.map((selected) => (
            <span className="secop-filter-chip" key={selected}>
              <span title={selected}>{selected}</span>
              <button
                type="button"
                aria-label={`${removeLabel}: ${selected}`}
                title={`${removeLabel}: ${selected}`}
                onClick={() =>
                  props.onChange(
                    props.value.filter((value) => value !== selected),
                  )
                }
              >
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
      {props.multiple && props.value.length >= 20 && (
        <span className="secop-filter-limit" role="status">
          {limitLabel}
        </span>
      )}
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
            if (props.multiple) setQuery(event.currentTarget.value);
            else props.onChange(event.currentTarget.value);
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
          aria-multiselectable={props.multiple || undefined}
        >
          {suggestions.length > 0 ? (
            suggestions.map((option, index) => (
              <li
                id={`${id}-option-${index}`}
                key={`${option}-${index}`}
                className="secop-autocomplete-option"
                role="option"
                aria-selected={
                  props.multiple
                    ? props.value.includes(option)
                    : activeIndex === index
                }
                data-active={activeIndex === index || undefined}
                aria-disabled={
                  (props.multiple &&
                    props.value.length >= 20 &&
                    !props.value.includes(option)) ||
                  undefined
                }
                aria-setsize={matchingOptions.length}
                aria-posinset={index + 1}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                {props.multiple && (
                  <Check
                    size={14}
                    aria-hidden="true"
                    className={
                      props.value.includes(option)
                        ? "secop-option-check"
                        : "secop-option-check secop-option-unchecked"
                    }
                  />
                )}
                <span>{option}</span>
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
