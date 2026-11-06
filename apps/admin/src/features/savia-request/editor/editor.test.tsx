import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { CodeEditor } from "./code-editor";
import { VariableInput } from "./variable-input";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.classList.remove("dark");
});

it("inserts the selected variable at the focused template position", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <VariableInput
      aria-label="Endpoint"
      onChange={onChange}
      value="https://provider.test/{{"
      variables={["token"]}
    />,
  );

  await user.click(screen.getByRole("option", { name: "{{token}}" }));

  expect(onChange).toHaveBeenCalledWith("https://provider.test/{{token}}");
});

it("keeps CodeMirror labelled when the application is in dark mode", () => {
  document.documentElement.classList.add("dark");
  render(<CodeEditor label="Body del request" onChange={vi.fn()} value="{}" />);

  expect(screen.getByLabelText("Body del request")).toBeVisible();
});
