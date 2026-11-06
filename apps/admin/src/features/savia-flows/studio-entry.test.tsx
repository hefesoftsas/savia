import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setStudioRuntime } from "@/features/studio-engine/runtime";
import { StudioFlowsEntry } from "./studio-entry";
vi.mock("@/i18n/core", () => ({ useMessages: () => (key: string) => key }));
afterEach(() => {
  cleanup();
  setStudioRuntime({ embedded: false });
});
describe("retired Studio workflow entry", () => {
  it("opens the replacement catalog in the currently selected tenant", () => {
    setStudioRuntime({ embedded: true, tenantId: 101 });
    render(<StudioFlowsEntry />);
    expect(
      screen.getByRole("link", { name: "Open Savia Flows" }),
    ).toHaveAttribute("href", "/savia-flows?tenantId=101");
    expect(screen.queryByText("Guardar borrador")).not.toBeInTheDocument();
  });
  it("does not assume a tenant in standalone contexts", () => {
    render(<StudioFlowsEntry />);
    expect(
      screen.getByRole("link", { name: "Open Savia Flows" }),
    ).toHaveAttribute("href", "/savia-flows");
  });
});
