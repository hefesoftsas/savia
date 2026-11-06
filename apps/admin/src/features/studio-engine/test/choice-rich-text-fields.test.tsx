// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DynamicForm from "../dynamic-form";
import { makeConfig, type StudioObject } from "@savia/studio-shared/metadata";
import React from "react";
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MultiSelectField } from "../multi-select-field";
import { RichTextField, RichTextValue } from "../rich-text-field";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("selects multiple options and preserves read-only choices", () => {
  const change = vi.fn();
  const props = {
    fieldName: "tags",
    options: [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ],
    value: ["a"],
    setFieldValue: change,
  };
  const { rerender } = render(<MultiSelectField {...props} />);
  expect(screen.getByRole("checkbox", { name: "Alpha" })).toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: "Beta" }));
  expect(change).toHaveBeenLastCalledWith("tags", ["a", "b"]);
  rerender(<MultiSelectField {...props} readOnly />);
  expect(screen.getByRole("checkbox", { name: "Beta" })).toBeDisabled();
});
it("applies formatting to selected text without submitting the form", () => {
  const change = vi.fn();
  render(
    <>
      <label id="notes_label">Notes</label>
      <RichTextField fieldName="notes" value="Hello" setFieldValue={change} />
    </>,
  );
  const input = screen.getByRole("textbox", {
    name: "Notes",
  }) as HTMLTextAreaElement;
  input.setSelectionRange(0, 5);
  fireEvent.click(screen.getByRole("button", { name: "Bold", exact: true }));
  expect(change).toHaveBeenLastCalledWith("notes", "**Hello**");
  expect(
    screen.getByRole("button", { name: "Bold", exact: true }),
  ).toHaveAttribute("type", "button");
});
it("renders formatting while blocking raw HTML, scripts and unsafe links", () => {
  const { container } = render(
    <RichTextValue
      value={
        "**Hello**\n\n- Item\n\n[Bad](javascript:alert%281%29)\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>"
      }
    />,
  );
  expect(container.querySelector("strong")).toHaveTextContent("Hello");
  expect(container.querySelector("li")).toHaveTextContent("Item");
  expect(container.querySelector("script, img")).toBeNull();
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
});

it("saves a dynamic form with multiple choices and rich text", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const save = vi.fn(async () => undefined);
  const object: StudioObject = {
    name: "notes",
    label: "Notes",
    description: "",
    config: makeConfig({
      tags: {
        type: "MultiSelect",
        label: "Tags",
        required: true,
        options: [
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ],
      },
      notes: { type: "RichText", label: "Notes", required: true },
    }),
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DynamicForm object={object} onSave={save} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "Alpha" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Beta" }));
  fireEvent.change(screen.getByRole("textbox", { name: /Notes/ }), {
    target: { value: "**Important**" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save record" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["a", "b"], notes: "**Important**" }),
    ),
  );
  vi.unstubAllGlobals();
});

it("keeps rich-text link clicks separate from record navigation", () => {
  const openRecord = vi.fn();
  render(
    <div onClick={openRecord}>
      <RichTextValue value="[Documentation](https://example.com/docs)" />
    </div>,
  );
  fireEvent.click(screen.getByRole("link", { name: "Documentation" }));
  expect(openRecord).not.toHaveBeenCalled();
});
