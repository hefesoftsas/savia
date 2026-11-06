import React, { Suspense } from "react";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => ({
  manager: vi.fn(),
  administration: vi.fn(),
  menu: vi.fn(),
}));
vi.mock("../screen-manager", () => {
  loaded.manager();
  return { default: () => <div>Screen manager loaded</div> };
});
vi.mock("../screen-administration", () => {
  loaded.administration();
  return { default: () => <div>Administration loaded</div> };
});
vi.mock("../screen-menu-reorder", () => {
  loaded.menu();
  return { default: () => <div>Menu loaded</div> };
});

it("loads only the studio panel that is rendered", async () => {
  const { ScreenManager } = await import("../lazy-studio-panels");
  expect(loaded.manager).not.toHaveBeenCalled();
  expect(loaded.administration).not.toHaveBeenCalled();
  expect(loaded.menu).not.toHaveBeenCalled();
  render(
    <Suspense fallback={<div>Loading</div>}>
      <ScreenManager objects={[]} onSaved={async () => {}} />
    </Suspense>,
  );
  expect(await screen.findByText("Screen manager loaded")).toBeInTheDocument();
  expect(loaded.manager).toHaveBeenCalledOnce();
  expect(loaded.administration).not.toHaveBeenCalled();
  expect(loaded.menu).not.toHaveBeenCalled();
});
