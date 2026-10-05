import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "@/api/api-client";
import { SelectionAIPanel } from "./selection-ai-panel";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./selection-ai-request", () => ({ requestSelectionAI: request }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  request.mockReset();
});

it("times out a stalled generation, preserves the selection, and lets the user retry", async () => {
  const onApply = vi.fn();
  let signal: AbortSignal | undefined;
  request.mockImplementation((_api, options) => {
    signal = options.signal;
    return new Promise(() => {});
  });
  render(
    <SelectionAIPanel
      api={
        new ApiClient({
          baseUrl: "https://savia.test",
          tokenSource: { getAccessToken: async () => null },
          fetcher: async () => Response.json({ data: [] }),
        })
      }
      text="Original selection"
      onApply={onApply}
      onClose={vi.fn()}
      onRestoreFocus={vi.fn()}
    />,
  );
  await screen.findByRole("button", { name: "Create translator" });
  vi.useFakeTimers();
  fireEvent.change(screen.getByLabelText("Instruction"), {
    target: { value: "Translate" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  act(() => {
    vi.advanceTimersByTime(15_000);
  });
  expect(screen.getByRole("status").textContent).toContain("15s");
  expect(screen.getByRole("status").textContent).toContain(
    "maximum wait is 90 seconds",
  );
  act(() => {
    vi.advanceTimersByTime(75_000);
  });
  expect(signal?.aborted).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain(
    "did not finish within 90 seconds",
  );
  expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled();
  expect(onApply).not.toHaveBeenCalled();
  expect(screen.getByText("Original selection")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  expect(signal?.aborted).toBe(false);
});
