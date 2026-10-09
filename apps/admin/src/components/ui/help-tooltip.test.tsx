import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { HelpTooltip } from "./help-tooltip";

afterEach(cleanup);

it("opens help by click and dismisses it with Escape", async () => {
  const user = userEvent.setup();
  render(<HelpTooltip label="Contact help">One number per line.</HelpTooltip>);
  expect(screen.queryByRole("tooltip")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Contact help" }));
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "One number per line.",
  );
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("opens help on keyboard focus", async () => {
  const user = userEvent.setup();
  render(<HelpTooltip label="Contact help">One number per line.</HelpTooltip>);
  await user.tab();
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "One number per line.",
  );
});

it("opens help with a touch tap without hover", async () => {
  const user = userEvent.setup();
  render(<HelpTooltip label="Contact help">One number per line.</HelpTooltip>);
  await user.pointer([
    {
      keys: "[TouchA>]",
      target: screen.getByRole("button", { name: "Contact help" }),
    },
    { keys: "[/TouchA]" },
  ]);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "One number per line.",
  );
});
