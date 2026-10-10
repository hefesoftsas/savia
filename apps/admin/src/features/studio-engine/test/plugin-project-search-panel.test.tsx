import React, { createRef } from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PluginProjectSearchPanel } from "../plugin-project-search-panel";

afterEach(cleanup);

const labels = {
  search: "Search files",
  placeholder: "Find in project",
  noResults: "No matches",
  resultCount: (count: number) => `${count} results`,
  truncated: "Showing the first 500 results",
};

it("renders accessible empty and result states and forwards the selected match", () => {
  const onQueryChange = vi.fn();
  const onSelect = vi.fn();
  const inputRef = createRef<HTMLInputElement>();
  const files = {
    "src/main.tsx": "  render()\nrender again",
    "src/util.ts": "const renderNow = 1",
  };
  const { rerender } = render(
    <PluginProjectSearchPanel
      files={{}}
      query=""
      onQueryChange={onQueryChange}
      onSelect={onSelect}
      labels={labels}
      inputRef={inputRef}
    />,
  );

  expect(
    screen.getByRole("searchbox", { name: "Search files" }),
  ).toHaveAttribute("placeholder", "Find in project");
  expect(inputRef.current).toHaveFocus();
  expect(screen.getByText("No matches")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "render" },
  });
  expect(onQueryChange).toHaveBeenCalledWith("render");

  rerender(
    <PluginProjectSearchPanel
      files={files}
      query="render"
      onQueryChange={onQueryChange}
      onSelect={onSelect}
      labels={labels}
    />,
  );
  expect(screen.getByText("3 results")).toBeInTheDocument();
  expect(
    screen.getByRole("group", { name: "src/main.tsx" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("group", { name: "src/util.ts" }),
  ).toBeInTheDocument();
  expect(
    screen
      .getByRole("button", { name: "src/main.tsx:1:3" })
      .querySelector("code"),
  ).toHaveTextContent("render()");

  const match = screen.getByRole("button", {
    name: "src/main.tsx:1:3",
  });
  fireEvent.click(match);
  expect(onSelect).toHaveBeenCalledWith({
    path: "src/main.tsx",
    lineNumber: 1,
    column: 3,
    endColumn: 9,
    lineText: "  render()",
  });

  rerender(
    <PluginProjectSearchPanel
      files={{
        "many.ts": Array.from({ length: 501 }, () => "render").join("\n"),
      }}
      query="render"
      onQueryChange={onQueryChange}
      onSelect={onSelect}
      labels={labels}
    />,
  );
  expect(screen.getByText("500 results")).toBeInTheDocument();
  expect(screen.getByText("Showing the first 500 results")).toBeInTheDocument();
});

it("bounds long line snippets and highlights the literal match", () => {
  const longLine = `${"a".repeat(220)}needle${"b".repeat(220)}`;
  render(
    <PluginProjectSearchPanel
      files={{ "src/deep/module.ts": longLine }}
      query="needle"
      onQueryChange={vi.fn()}
      onSelect={vi.fn()}
      labels={labels}
    />,
  );

  expect(
    screen.getByRole("heading", { name: "src/deep/module.ts" }),
  ).toBeInTheDocument();
  const snippet = screen.getByText("needle", { selector: "mark" });
  expect(snippet).toHaveTextContent("needle");
  expect(snippet.closest("code")?.textContent?.length).toBeLessThanOrEqual(162);
});
