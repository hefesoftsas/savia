import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PluginFileTree } from "../plugin-file-tree";
afterEach(cleanup);
it("supports keyboard navigation, folder collapse and file activation", () => {
  const select = vi.fn();
  render(
    <PluginFileTree
      names={["entry.tsx", "store.json"]}
      selected="entry.tsx"
      projectName="custom.demo"
      label="Files"
      onSelect={select}
    />,
  );
  const source = screen.getByRole("treeitem", { name: "entry.tsx" });
  source.focus();
  fireEvent.keyDown(source, { key: "ArrowDown" });
  const store = screen.getByRole("treeitem", { name: "store.json" });
  expect(store).toHaveFocus();
  fireEvent.keyDown(store, { key: "Enter" });
  expect(select).toHaveBeenCalledWith("store.json");
  fireEvent.keyDown(store, { key: "ArrowLeft" });
  const root = screen.getByRole("treeitem", {
    name: "custom.demo",
    exact: true,
  });
  expect(root).toHaveFocus();
  fireEvent.keyDown(root, { key: "ArrowLeft" });
  expect(
    screen.queryByRole("treeitem", { name: "entry.tsx" }),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(root, { key: "ArrowRight" });
  expect(
    screen.getByRole("treeitem", { name: "entry.tsx" }),
  ).toBeInTheDocument();
});
