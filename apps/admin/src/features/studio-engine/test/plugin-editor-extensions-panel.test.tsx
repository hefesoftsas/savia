import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { render } from "./locale-test-render";
import { PluginEditorExtensionsPanel } from "../plugin-editor-extensions-panel";

afterEach(cleanup);

it("filters the verified catalog and enables then disables an extension by ID", () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <PluginEditorExtensionsPanel enabled={[]} onChange={onChange} />,
    { locale: "en" },
  );

  expect(
    screen.getByRole("heading", { name: "Extensions" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Verified catalog of VS Code web extensions/),
  ).toBeInTheDocument();
  expect(screen.getByText("Prettier")).toBeInTheDocument();
  expect(screen.getByText("React snippets")).toBeInTheDocument();

  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search extensions" }),
    {
      target: { value: "useState" },
    },
  );
  expect(screen.getByText("React snippets")).toBeInTheDocument();
  expect(screen.queryByText("Prettier")).not.toBeInTheDocument();

  fireEvent.click(
    screen.getByRole("button", { name: "Enable React snippets" }),
  );
  expect(onChange).toHaveBeenLastCalledWith(["savia.react-snippets"]);

  rerender(
    <PluginEditorExtensionsPanel
      enabled={["savia.react-snippets"]}
      onChange={onChange}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Enabled");
  fireEvent.click(
    screen.getByRole("button", { name: "Disable React snippets" }),
  );
  expect(onChange).toHaveBeenLastCalledWith([]);
});

it("disables catalog actions and localizes the panel", () => {
  render(
    <PluginEditorExtensionsPanel enabled={[]} onChange={vi.fn()} disabled />,
    { locale: "pt" },
  );

  expect(
    screen.getByRole("heading", { name: "Extensões" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("searchbox", { name: "Buscar extensões" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Ativar Prettier" }),
  ).toBeDisabled();
});
