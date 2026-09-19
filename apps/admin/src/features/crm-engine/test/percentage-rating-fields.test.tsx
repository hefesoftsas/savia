// @vitest-environment jsdom
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
import { PercentageField, RatingField } from "../percentage-rating-fields";
import { formatFieldValue } from "../field-value";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("edits percentages as numeric percent units and clears to null", () => {
  const change = vi.fn();
  render(
    <>
      <label id="rate_label">Rate</label>
      <PercentageField fieldName="rate" value={25} setFieldValue={change} />
    </>,
  );
  const input = screen.getByRole("spinbutton", { name: "Rate" });
  expect(input).toHaveValue(25);
  fireEvent.input(input, { target: { value: "35.25" } });
  expect(change).toHaveBeenLastCalledWith("rate", 35.25);
  fireEvent.input(input, { target: { value: "" } });
  expect(change).toHaveBeenLastCalledWith("rate", null);
  expect(
    formatFieldValue(25, { type: "Percentage", label: "Rate" }, "en-US"),
  ).toBe("25%");
});
it("selects a rating, exposes its scale, and protects readonly values", () => {
  const change = vi.fn();
  const { rerender } = render(
    <>
      <label id="score_label">Score</label>
      <RatingField fieldName="score" value={3} setFieldValue={change} />
    </>,
  );
  expect(screen.getByRole("radio", { name: "3 of 5" })).toBeChecked();
  fireEvent.click(screen.getByRole("radio", { name: "4 of 5" }));
  expect(change).toHaveBeenLastCalledWith("score", 4);
  fireEvent.click(screen.getByRole("button", { name: "Clear rating" }));
  expect(change).toHaveBeenLastCalledWith("score", null);
  rerender(
    <RatingField fieldName="score" value={3} readOnly setFieldValue={change} />,
  );
  expect(screen.getByRole("radio", { name: "4 of 5" })).toBeDisabled();
});
it("supports numeric rating scales and missing values", () => {
  render(
    <>
      <label id="score_label">Score</label>
      <RatingField
        fieldName="score"
        config={{ maximum: 10, ratingStyle: "number" }}
      />
    </>,
  );
  expect(screen.getByRole("spinbutton", { name: "Score" })).toHaveAttribute(
    "max",
    "10",
  );
  expect(formatFieldValue(4, { type: "Rating", label: "Score" })).toBe("4 / 5");
  expect(formatFieldValue(null, { type: "Percentage", label: "Rate" })).toBe(
    "—",
  );
});

it.each(["Percentage", "Rating"])(
  "builds numeric filters for %s",
  async (type) => {
    const { RecordsFiltersPanel } = await import("../records-filters-panel");
    const { makeConfig } = await import("@savia/crm-shared/metadata");
    const changed = vi.fn();
    render(
      <RecordsFiltersPanel
        object={{
          name: "reviews",
          label: "Reviews",
          description: "",
          config: makeConfig({ score: { type, label: "Score" } }),
        }}
        filters={{
          logic: "and",
          conditions: [{ field: "score", op: "gte", value: 3 }],
        }}
        onFiltersChange={vi.fn()}
        onConditionChange={changed}
      />,
    );
    const input = screen.getByLabelText("Valor del filtro 1");
    expect(input).toHaveAttribute("type", "number");
    fireEvent.change(input, { target: { value: "4" } });
    expect(changed).toHaveBeenCalledWith(0, { value: 4 });
  },
);

it("saves percentage and rating as numbers through the dynamic form", async () => {
  const { default: DynamicForm } = await import("../dynamic-form");
  const { QueryClient, QueryClientProvider } =
    await import("@tanstack/react-query");
  const { makeConfig } = await import("@savia/crm-shared/metadata");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const save = vi.fn(async () => undefined);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DynamicForm
        object={{
          name: "reviews",
          label: "Reviews",
          description: "",
          config: makeConfig({
            rate: { type: "Percentage", label: "Rate", required: true },
            score: { type: "Rating", label: "Score", required: true },
          }),
        }}
        onSave={save}
      />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByRole("spinbutton", { name: /Rate/ }), {
    target: { value: "25.5" },
  });
  fireEvent.click(screen.getByRole("radio", { name: "4 of 5" }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ rate: 25.5, score: 4 }),
    ),
  );
});
