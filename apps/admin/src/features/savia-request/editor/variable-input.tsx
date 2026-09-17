import { useContext, useId, useMemo, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { VariableNames, templateAt, templateEnd } from "./variable-completion";

type VariableInputProps = Omit<
  ComponentProps<typeof Input>,
  "onChange" | "value"
> & {
  value: string;
  onChange(value: string): void;
  variables?: string[];
};

export function VariableInput({
  value,
  onChange,
  variables: suppliedVariables,
  onKeyDown,
  onSelect,
  onBlur,
  ...props
}: VariableInputProps) {
  const contextVariables = useContext(VariableNames);
  const variables = suppliedVariables ?? contextVariables;
  const ref = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const [cursor, setCursor] = useState(value.length);
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState(0);
  const match = useMemo(() => templateAt(value, cursor), [cursor, value]);
  const options = match
    ? variables.filter((name) =>
        name.toLocaleLowerCase().includes(match.query.toLocaleLowerCase()),
      )
    : [];
  const visible = open && options.length > 0;

  const choose = (name: string) => {
    if (!match) return;
    const insertion = `{{${name}}}`;
    const next =
      value.slice(0, match.from) +
      insertion +
      value.slice(templateEnd(value, cursor));
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => {
      const input = ref.current;
      if (!input) return;
      input.focus();
      const nextCursor = match.from + insertion.length;
      input.setSelectionRange(nextCursor, nextCursor);
      setCursor(nextCursor);
    });
  };

  return (
    <div className="relative">
      <Input
        {...props}
        aria-activedescendant={visible ? `${listboxId}-${selected}` : undefined}
        aria-autocomplete="list"
        aria-controls={visible ? listboxId : undefined}
        aria-expanded={visible}
        onBlur={(event) => {
          setOpen(false);
          onBlur?.(event);
        }}
        onChange={(event) => {
          onChange(event.target.value);
          setCursor(event.target.selectionStart ?? event.target.value.length);
          setSelected(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (
            visible &&
            ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(
              event.key,
            )
          ) {
            event.preventDefault();
            if (event.key === "Escape") setOpen(false);
            else if (event.key === "ArrowDown") {
              setSelected((current) => (current + 1) % options.length);
            } else if (event.key === "ArrowUp") {
              setSelected(
                (current) => (current + options.length - 1) % options.length,
              );
            } else {
              choose(options[Math.min(selected, options.length - 1)] ?? "");
            }
            return;
          }
          onKeyDown?.(event);
        }}
        onSelect={(event) => {
          setCursor(event.currentTarget.selectionStart ?? value.length);
          onSelect?.(event);
        }}
        ref={ref}
        role="combobox"
        value={value}
      />
      {visible ? (
        <div
          aria-label="Variables disponibles"
          className="absolute z-30 mt-1 max-h-44 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
          id={listboxId}
          role="listbox"
        >
          {options.map((name, index) => (
            <button
              aria-selected={index === selected}
              className="w-full rounded px-2 py-1.5 text-left font-mono text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              id={`${listboxId}-${index}`}
              key={name}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(name)}
              role="option"
              type="button"
            >
              {`{{${name}}}`}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
