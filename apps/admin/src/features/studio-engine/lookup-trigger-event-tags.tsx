import { useMessages } from "@/i18n/core";
import { recordsMessages } from "@/i18n/locales/records";
import { useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  LOOKUP_TRIGGER_EVENTS,
  lookupTriggerEventSchema,
  type LookupTriggerEvent,
} from "@savia/studio-shared/request-page";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { StudioHelpTooltip } from "./studio-help-tooltip";

function normalize(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

export function LookupTriggerEventTags({
  events,
  onChange,
}: {
  events?: LookupTriggerEvent[];
  onChange: (events: LookupTriggerEvent[] | undefined) => void;
}) {
  const t = useMessages(recordsMessages);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = events ?? [];

  const available = useMemo(
    () => LOOKUP_TRIGGER_EVENTS.filter((event) => !selected.includes(event)),
    [selected],
  );

  const filtered = useMemo(() => {
    const needle = normalize(query);
    if (!needle) return available;
    return available.filter((event) => normalize(event).includes(needle));
  }, [available, query]);

  const add = (event: LookupTriggerEvent) => {
    if (selected.includes(event)) return;
    const next = [...selected, lookupTriggerEventSchema.parse(event)];
    onChange(next);
    setQuery("");
    setOpen(next.length < LOOKUP_TRIGGER_EVENTS.length);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const remove = (event: LookupTriggerEvent) => {
    const next = selected.filter((item) => item !== event);
    onChange(next.length ? next : undefined);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <fieldset
      className="studio-fieldset lookup-trigger-events"
      data-property-search="eventos del campo blur change input focus enter"
    >
      <legend className="studio-fieldset-legend-with-help">
        {t("Eventos del campo")}
        <StudioHelpTooltip label={t("Eventos HTML disponibles")}>
          {LOOKUP_TRIGGER_EVENTS.join(", ")}
        </StudioHelpTooltip>
      </legend>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div
            className={cn(
              "lookup-trigger-combobox",
              open && "lookup-trigger-combobox--open",
            )}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                event.preventDefault();
                inputRef.current?.focus();
              }
            }}
          >
            <div className="lookup-trigger-combobox-inner">
              {selected.map((event) => (
                <span key={event} className="lookup-trigger-pill">
                  <span className="lookup-trigger-pill-label">
                    <code>{event}</code>
                  </span>
                  <button
                    type="button"
                    className="lookup-trigger-pill-remove"
                    aria-label={t("Quitar %{p0}", { p0: event })}
                    onClick={(clickEvent) => {
                      clickEvent.stopPropagation();
                      remove(event);
                    }}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              ))}
              <input
                ref={inputRef}
                type="text"
                className="lookup-trigger-combobox-input"
                role="combobox"
                aria-expanded={open}
                aria-autocomplete="list"
                aria-controls="lookup-trigger-event-list"
                aria-label={t("Buscar eventos del campo")}
                placeholder={
                  available.length
                    ? selected.length
                      ? t("Añadir…")
                      : t("Buscar evento…")
                    : t("Completo")
                }
                value={query}
                disabled={!available.length}
                onFocus={() => setOpen(true)}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setOpen(true);
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Backspace" &&
                    !query &&
                    selected.length > 0
                  ) {
                    event.preventDefault();
                    remove(selected[selected.length - 1]!);
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setOpen(false);
                    return;
                  }
                  if (event.key === "Enter" && filtered[0]) {
                    event.preventDefault();
                    add(filtered[0]);
                  }
                }}
              />
            </div>
          </div>
        </PopoverAnchor>
        <PopoverContent
          id="lookup-trigger-event-list"
          className="lookup-trigger-combobox-popover w-[var(--radix-popover-trigger-width)] p-0"
          align="start"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <Command shouldFilter={false}>
            <CommandList>
              {filtered.length === 0 ? (
                <CommandEmpty>
                  {available.length === 0
                    ? t("Sin eventos disponibles.")
                    : t("Sin coincidencias.")}
                </CommandEmpty>
              ) : (
                <CommandGroup>
                  {filtered.map((event) => (
                    <CommandItem
                      key={event}
                      value={event}
                      onSelect={() => add(event)}
                    >
                      <code>{event}</code>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </fieldset>
  );
}
