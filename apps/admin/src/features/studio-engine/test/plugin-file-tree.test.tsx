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

it("groups nested paths into sorted folders and navigates the visible tree", () => {
  const select = vi.fn();
  render(
    <PluginFileTree
      names={[
        "zeta.tsx",
        "src/zeta.tsx",
        "src/components/Button.tsx",
        "assets/logo.svg",
        "src/components/index.json",
      ]}
      selected="src/components/Button.tsx"
      projectName="custom.demo"
      label="Files"
      onSelect={select}
    />,
  );

  const root = screen.getByRole("treeitem", { name: "custom.demo" });
  const rootGroup = root.querySelector('[role="group"]')!;
  expect(
    Array.from(rootGroup.children).map((item) => item.textContent),
  ).toEqual([
    expect.stringContaining("assets"),
    expect.stringContaining("src"),
    expect.stringContaining("zeta.tsx"),
  ]);
  expect(screen.getByRole("treeitem", { name: "src" })).toHaveAttribute(
    "aria-level",
    "2",
  );
  expect(
    screen.getByRole("treeitem", { name: "src/components" }),
  ).toHaveAttribute("aria-level", "3");
  expect(
    screen.getByRole("treeitem", { name: "src/components/Button.tsx" }),
  ).toHaveAttribute("aria-label", "src/components/Button.tsx");
  expect(
    screen.getByRole("treeitem", { name: "src/components/Button.tsx" }),
  ).toHaveAttribute("title", "src/components/Button.tsx");

  const button = screen.getByRole("treeitem", {
    name: "src/components/Button.tsx",
  });
  button.focus();
  expect(button).toHaveAttribute("tabindex", "0");
  expect(root).toHaveAttribute("tabindex", "-1");
  expect(screen.getByRole("treeitem", { name: "src" })).toHaveAttribute(
    "tabindex",
    "-1",
  );
  fireEvent.keyDown(button, { key: "ArrowLeft" });
  const components = screen.getByRole("treeitem", { name: "src/components" });
  expect(components).toHaveFocus();
  expect(components).toHaveAttribute("tabindex", "0");
  expect(root).toHaveAttribute("tabindex", "-1");
  fireEvent.keyDown(screen.getByRole("treeitem", { name: "src/components" }), {
    key: "ArrowLeft",
  });
  expect(
    screen.queryByRole("treeitem", { name: "src/components/Button.tsx" }),
  ).toBeNull();
  fireEvent.keyDown(screen.getByRole("treeitem", { name: "src/components" }), {
    key: "ArrowRight",
  });
  expect(
    screen.getByRole("treeitem", { name: "src/components/Button.tsx" }),
  ).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("treeitem", { name: "src/components" }), {
    key: "ArrowRight",
  });
  expect(
    screen.getByRole("treeitem", { name: "src/components/Button.tsx" }),
  ).toHaveFocus();
  fireEvent.keyDown(
    screen.getByRole("treeitem", { name: "src/components/Button.tsx" }),
    {
      key: "Enter",
    },
  );
  expect(select).toHaveBeenCalledExactlyOnceWith("src/components/Button.tsx");
});

it("expands newly selected ancestors and supports an empty file list", () => {
  const { rerender } = render(
    <PluginFileTree
      names={[]}
      selected=""
      projectName="custom.demo"
      label="Files"
      onSelect={vi.fn()}
    />,
  );
  expect(screen.getByRole("treeitem", { name: "custom.demo" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );

  rerender(
    <PluginFileTree
      names={["src/index.tsx"]}
      selected="src/index.tsx"
      projectName="custom.demo"
      label="Files"
      onSelect={vi.fn()}
    />,
  );
  expect(screen.getByRole("treeitem", { name: "src" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(screen.getByRole("treeitem", { name: "src/index.tsx" })).toBeVisible();
});

it("keeps project and file node identities separate and activates full paths", () => {
  const select = vi.fn();
  render(
    <PluginFileTree
      names={["root", "src/long-name.tsx"]}
      selected="src/long-name.tsx"
      projectName="root"
      label="Files"
      onSelect={select}
    />,
  );

  const rootNodes = screen.getAllByRole("treeitem", { name: "root" });
  expect(rootNodes).toHaveLength(2);
  expect(rootNodes[0]).toHaveAttribute("data-tree-id", "project:root");
  expect(rootNodes[1]).toHaveAttribute("data-tree-id", "file:root");

  const leaf = screen.getByRole("treeitem", { name: "src/long-name.tsx" });
  expect(leaf.textContent).toContain("long-name.tsx");
  expect(leaf.textContent).not.toContain("src/");
  fireEvent.click(leaf);
  expect(select).toHaveBeenCalledExactlyOnceWith("src/long-name.tsx");
});

it("reveals filtered matches under a collapsed project and restores collapse", () => {
  const props = {
    names: ["src/index.tsx"],
    selected: "src/index.tsx",
    projectName: "custom.demo",
    label: "Files",
    onSelect: vi.fn(),
  };
  const { rerender } = render(<PluginFileTree {...props} />);
  const root = screen.getByRole("treeitem", { name: "custom.demo" });
  fireEvent.click(root.querySelector(".plugin-file-tree-row")!);
  expect(root).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("treeitem", { name: "src/index.tsx" })).toBeNull();

  rerender(<PluginFileTree {...props} filterActive />);
  expect(root).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("treeitem", { name: "src/index.tsx" })).toBeVisible();

  rerender(<PluginFileTree {...props} />);
  expect(root).toHaveAttribute("aria-expanded", "false");
  expect(root).toHaveAttribute("tabindex", "0");
  expect(screen.queryByRole("treeitem", { name: "src/index.tsx" })).toBeNull();
});

it("opens a collapsed project when the external selection changes", () => {
  const props = {
    names: ["src/first.tsx", "src/next.tsx"],
    selected: "src/first.tsx",
    projectName: "custom.demo",
    label: "Files",
    onSelect: vi.fn(),
  };
  const { rerender } = render(<PluginFileTree {...props} />);
  const root = screen.getByRole("treeitem", { name: "custom.demo" });
  fireEvent.click(root.querySelector(".plugin-file-tree-row")!);
  expect(root).toHaveAttribute("aria-expanded", "false");

  rerender(<PluginFileTree {...props} selected="src/next.tsx" />);
  expect(root).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("treeitem", { name: "src/next.tsx" })).toBeVisible();
});
