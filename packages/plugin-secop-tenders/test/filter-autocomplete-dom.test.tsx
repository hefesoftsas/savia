/** @vitest-environment jsdom */

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilterAutocomplete } from "../filter-autocomplete";

let root: Root;
let host: HTMLDivElement;
let submitted = 0;
let bubbledKeys: string[] = [];

function mountAutocomplete(initialValue = "Publicado") {
  submitted = 0;
  bubbledKeys = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);

  function Harness() {
    const [value, setValue] = useState(initialValue);
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted += 1;
        }}
        onKeyDown={(event) => bubbledKeys.push(event.key)}
      >
        <FilterAutocomplete
          id="status"
          label="Status"
          value={value}
          onChange={setValue}
          options={["Publicado", "Adjudicado", "En evaluación"]}
          toggleLabel="Show status options"
          noOptionsLabel="No statuses"
        />
      </form>
    );
  }

  act(() => root.render(<Harness />));
}

function getInput() {
  return host.querySelector<HTMLInputElement>("[role=combobox]")!;
}

function options() {
  return Array.from(host.querySelectorAll<HTMLElement>("[role=option]"));
}

function key(input: HTMLInputElement, keyName: string) {
  const event = new KeyboardEvent("keydown", {
    key: keyName,
    bubbles: true,
    cancelable: true,
  });
  input.dispatchEvent(event);
  return event;
}

function changeInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
});

describe("FilterAutocomplete interaction", () => {
  it("shows every option when toggled open with a selected value", () => {
    mountAutocomplete();

    act(() => {
      host.querySelector<HTMLButtonElement>("button")!.click();
    });

    expect(options().map((option) => option.textContent)).toEqual([
      "Publicado",
      "Adjudicado",
      "En evaluación",
    ]);
    expect(getInput().getAttribute("aria-expanded")).toBe("true");
    expect(getInput().hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("shows every option on focus and resets the active item on reopen", () => {
    mountAutocomplete();
    const input = getInput();

    act(() => input.focus());
    expect(options()).toHaveLength(3);
    act(() => key(input, "ArrowDown"));
    expect(input.getAttribute("aria-activedescendant")).toBe("status-option-0");
    act(() => key(input, "Escape"));
    act(() => host.querySelector<HTMLButtonElement>("button")!.click());

    expect(options()).toHaveLength(3);
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("filters after typing and Escape closes without changing the typed value", () => {
    mountAutocomplete();
    const input = getInput();

    act(() => {
      input.focus();
      changeInput(input, "evalu");
    });

    expect(options().map((option) => option.textContent)).toEqual([
      "En evaluación",
    ]);
    act(() => key(input, "Escape"));

    expect(input.value).toBe("evalu");
    expect(host.querySelector("[role=listbox]")).toBeNull();
  });

  it("keeps Enter selection out of the enclosing search key handler", () => {
    mountAutocomplete();
    const input = getInput();
    act(() => input.focus());

    act(() => key(input, "ArrowDown"));
    expect(input.getAttribute("aria-activedescendant")).toBe("status-option-0");
    const enter = key(input, "Enter");
    act(() => {});

    expect(enter.defaultPrevented).toBe(true);
    expect(bubbledKeys).toEqual(["ArrowDown"]);
    expect(submitted).toBe(0);
    expect(input.value).toBe("Publicado");
  });

  it("closes on outside blur and scrolls the active item into view when supported", () => {
    mountAutocomplete("");
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const input = getInput();
    const outside = document.createElement("button");
    document.body.append(outside);

    act(() => input.focus());
    act(() => key(input, "ArrowDown"));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });

    act(() => outside.focus());
    expect(host.querySelector("[role=listbox]")).toBeNull();
  });
});
