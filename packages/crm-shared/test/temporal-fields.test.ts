import { expect, it } from "vitest";
import {
  makeConfig,
  objectSchema,
  validateRecord,
  type CrmObject,
} from "../src/metadata";
const object: CrmObject = {
  name: "appointments",
  label: "Appointments",
  description: "",
  config: makeConfig({
    start: { type: "DateTime", label: "Start" },
    time: { type: "Time", label: "Time" },
    legacy: {
      type: "DateControl",
      label: "Legacy",
      config: { dateTime: true },
    },
  }),
};
it("accepts dedicated temporal types and normalizes timestamps to UTC", () => {
  expect(objectSchema.safeParse(object).success).toBe(true);
  const result = validateRecord(object, {
    start: "2026-09-19T09:30:00-05:00",
    time: "09:30",
    legacy: "2026-09-19T14:30:00Z",
  });
  expect(result.errors).toEqual({});
  expect(result.data.start).toBe("2026-09-19T14:30:00.000Z");
});
it.each(["2026-02-30T09:30:00Z", "2026-09-19T09:30", "invalid", "2026-09-19"])(
  "rejects ambiguous or impossible timestamps: %s",
  (start) => {
    expect(validateRecord(object, { start }).errors.start).toBeTruthy();
  },
);
it.each(["24:00", "12:60", "9:30", "12:30:59", "tomorrow"])(
  "rejects invalid minute precision time: %s",
  (time) => {
    expect(validateRecord(object, { time }).errors.time).toBeTruthy();
  },
);
