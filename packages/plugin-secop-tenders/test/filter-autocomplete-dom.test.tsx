/** @vitest-environment jsdom */

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilterAutocomplete } from "../filter-autocomplete";

let root: Root;
let host: HTMLDivElement;
let submitted = 0;
let bubbledKeys: string[] = [];

function mountAutocomplete(
  initialValue = "Publicado",
  catalogOptions = ["Publicado", "Adjudicado", "En evaluación"],
) {
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
          options={catalogOptions}
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
  it("closes on an outside pointer even when focus does not move", () => {
    mountAutocomplete();
    act(() => getInput().focus());
    expect(options()).toHaveLength(3);
    act(() =>
      document.body.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true }),
      ),
    );
    expect(host.querySelector("[role=listbox]")).toBeNull();
  });
  it("closes on a non-focusing outside click and can reopen from the focused input", () => {
    mountAutocomplete();
    act(() => getInput().focus());
    act(() => document.body.click());
    expect(host.querySelector("[role=listbox]")).toBeNull();
    act(() => getInput().click());
    expect(options()).toHaveLength(3);
  });
  it("closes when the toggle is pressed a second time", () => {
    mountAutocomplete();
    const toggle = host.querySelector<HTMLButtonElement>(
      ".secop-autocomplete-toggle",
    )!;
    act(() => toggle.click());
    expect(options()).toHaveLength(3);
    act(() => toggle.click());
    expect(host.querySelector("[role=listbox]")).toBeNull();
  });

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

it("finds and selects a value outside the first displayed batch", () => {
  mountAutocomplete(
    "",
    Array.from({ length: 11881 }, (_, i) => `Entity ${i}`),
  );
  const input = getInput();
  act(() => {
    input.focus();
    changeInput(input, "Entity 11880");
  });
  expect(options().map((option) => option.textContent)).toEqual([
    "Entity 11880",
  ]);
  act(() => key(input, "ArrowDown"));
  act(() => key(input, "Enter"));
  expect(input.value).toBe("Entity 11880");
});

it("exposes the next option batch when scrolling the dropdown", () => {
  mountAutocomplete(
    "",
    Array.from({ length: 120 }, (_, i) => `Entity ${i}`),
  );
  act(() => getInput().focus());
  expect(options()).toHaveLength(50);
  const list = host.querySelector<HTMLElement>("[role=listbox]")!;
  Object.defineProperties(list, {
    scrollHeight: { value: 1000 },
    clientHeight: { value: 300 },
    scrollTop: { value: 700 },
  });
  act(() => list.dispatchEvent(new Event("scroll", { bubbles: true })));
  expect(options()).toHaveLength(100);
  expect(options()[99].textContent).toBe("Entity 99");
});

describe("multiple selections", () => {
  function mountMultiple() {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    function Harness() {
      const [value, setValue] = useState<string[]>([]);
      return (
        <FilterAutocomplete
          multiple
          id="departments"
          label="Departments"
          value={value}
          onChange={setValue}
          options={["Bogotá", "Boyacá", "Caldas"]}
          removeLabel="Remove"
        />
      );
    }
    act(() => root.render(<Harness />));
    act(() => getInput().focus());
  }
  it("keeps the list open, marks each selection and removes a chip independently", () => {
    mountMultiple();
    act(() => options()[0]!.click());
    act(() => options()[1]!.click());
    expect(
      host
        .querySelector('[role="listbox"]')
        ?.getAttribute("aria-multiselectable"),
    ).toBe("true");
    expect(
      options()
        .filter((option) => option.getAttribute("aria-selected") === "true")
        .map((option) => option.textContent),
    ).toEqual(["Bogotá", "Boyacá"]);
    expect(host.querySelectorAll(".secop-filter-chip")).toHaveLength(2);
    act(() =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="Remove: Bogotá"]')!
        .click(),
    );
    expect(host.querySelectorAll(".secop-filter-chip")).toHaveLength(1);
    expect(host.querySelector(".secop-filter-chip")?.textContent).toBe(
      "Boyacá",
    );
    act(() => key(getInput(), "Escape"));
    expect(host.querySelector(".secop-autocomplete-popup")).toBeNull();
    expect(getInput().value).toBe("Boyacá");
    act(() => key(getInput(), "ArrowDown"));
    expect(host.querySelector(".secop-filter-chip")?.textContent).toBe(
      "Boyacá",
    );
  });
  it("adds a typed value with Enter and preserves prior selections", () => {
    mountMultiple();
    act(() => options()[0]!.click());
    act(() => changeInput(getInput(), "Antioquia"));
    let event: KeyboardEvent | undefined;
    act(() => {
      event = key(getInput(), "Enter");
    });
    expect(event?.defaultPrevented).toBe(true);
    expect(
      Array.from(host.querySelectorAll(".secop-filter-chip")).map(
        (chip) => chip.textContent,
      ),
    ).toEqual(["Bogotá", "Antioquia"]);
    expect(getInput().value).toBe("");
  });
});

it("keeps only the newly opened filter visible and retains both selections on outside dismissal", () => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <>
        <FilterAutocomplete
          multiple
          id="first"
          label="First filter"
          value={["A"]}
          onChange={() => {}}
          options={["A", "B"]}
        />
        <FilterAutocomplete
          multiple
          id="second"
          label="Second filter"
          value={["B"]}
          onChange={() => {}}
          options={["A", "B"]}
        />
      </>,
    ),
  );
  const toggles = host.querySelectorAll<HTMLButtonElement>(
    ".secop-autocomplete-toggle",
  );
  act(() => toggles[0]!.click());
  expect(host.querySelector("#first-listbox")).not.toBeNull();
  act(() => toggles[1]!.click());
  expect(host.querySelector("#first-listbox")).toBeNull();
  expect(host.querySelector("#second-listbox")).not.toBeNull();
  act(() => document.body.click());
  expect(host.querySelectorAll("[role=listbox]")).toHaveLength(0);
  expect(host.querySelector<HTMLInputElement>("#first")!.value).toBe("A");
  expect(host.querySelector<HTMLInputElement>("#second")!.value).toBe("B");
});
it("Escape also dismisses a popup when a selected-chip button has focus", () => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <FilterAutocomplete
        multiple
        id="chips"
        label="Chips"
        value={["A"]}
        onChange={() => {}}
        options={["A", "B"]}
      />,
    ),
  );
  const input = getInput();
  act(() => input.focus());
  const remove = host.querySelector<HTMLButtonElement>(
    ".secop-filter-chip button",
  )!;
  act(() => remove.focus());
  act(() =>
    remove.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(host.querySelector("[role=listbox]")).toBeNull();
  expect(input.value).toBe("A");
  expect(document.activeElement).toBe(input);
});
