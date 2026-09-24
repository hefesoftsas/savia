import { TimeField } from "../time-field";
// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DateTimeField, localDateTime } from "../date-time-field";
afterEach(cleanup);
it("round trips the user's local time to ISO without shifting the hour", () => {
  const change = vi.fn();
  const local = new Date(2026, 8, 11, 14, 35);
  render(
    <>
      <label id="meeting_label">Reunión</label>
      <DateTimeField
        fieldName="meeting"
        value={local.toISOString()}
        setFieldValue={change}
      />
    </>,
  );
  const input = screen.getByLabelText("Reunión");
  expect(input).toHaveValue("2026-09-11T14:35");
  expect(change).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "2026-09-11T15:45" } });
  expect(change).toHaveBeenCalledWith(
    "meeting",
    new Date(2026, 8, 11, 15, 45).toISOString(),
  );
  expect(localDateTime(new Date(2026, 8, 11, 15, 45).toISOString())).toBe(
    "2026-09-11T15:45",
  );
});
it("preserves native required validation, error semantics and read-only values", () => {
  const change = vi.fn();
  const { rerender } = render(
    <>
      <label id="date_label">Fecha</label>
      <DateTimeField
        fieldName="date"
        required
        error={{ type: "required", message: "Selecciona una fecha" }}
        setFieldValue={change}
      />
    </>,
  );
  const input = screen.getByLabelText("Fecha") as HTMLInputElement;
  expect(input).toBeRequired();
  expect(input.checkValidity()).toBe(false);
  expect(input).toHaveAttribute("aria-invalid", "true");
  rerender(
    <>
      <label id="date_label">Fecha</label>
      <DateTimeField
        fieldName="date"
        readOnly
        value="2026-09-11T19:00:00Z"
        setFieldValue={change}
      />
    </>,
  );
  expect(input).toHaveAttribute("readonly");
  fireEvent.change(input, { target: { value: "2026-09-12T15:00" } });
  expect(change).not.toHaveBeenCalled();
});

it("edits and clears a time while preserving readonly and required states", () => {
  const change = vi.fn();
  const { rerender } = render(
    <>
      <label id="time_label">Time</label>
      <TimeField
        fieldName="time"
        required
        value="09:30"
        setFieldValue={change}
      />
    </>,
  );
  const input = screen.getByLabelText("Time");
  expect(input).toHaveAttribute("type", "time");
  expect(input).toBeRequired();
  fireEvent.blur(input, { target: { value: "10:45" } });
  expect(change).toHaveBeenLastCalledWith("time", "10:45");
  fireEvent.change(input, { target: { value: "" } });
  expect(change).toHaveBeenLastCalledWith("time", "");
  change.mockClear();
  rerender(
    <>
      <label id="time_label">Time</label>
      <TimeField
        fieldName="time"
        readOnly
        value="09:30"
        setFieldValue={change}
      />
    </>,
  );
  fireEvent.change(input, { target: { value: "11:00" } });
  expect(change).not.toHaveBeenCalled();
});
