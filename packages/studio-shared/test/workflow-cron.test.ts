import { describe, expect, it } from "vitest";
import {
  cronNextOccurrence,
  isRunnableCronSchedule,
  parseCronSchedule,
} from "../src/workflow-cron";

const minute = (iso: string) => Date.parse(iso);
describe("cron schedules", () => {
  it("parses the five fields with lists, ranges, steps and names", () => {
    const parsed = parseCronSchedule("*/15 9-17 * JAN,MAR mon-fri");
    expect([...parsed.minute.values].slice(0, 3)).toEqual([0, 15, 30]);
    expect(parsed.hour.values.has(17)).toBe(true);
    expect(parsed.month.values).toEqual(new Set([1, 3]));
    expect(parsed.dayOfWeek.values.has(5)).toBe(true);
    expect(() => parseCronSchedule("* * *")).toThrow();
    expect(() => parseCronSchedule("61 * * * *")).toThrow();
    expect(() => parseCronSchedule("0 0 * * FUNDAY")).toThrow();
    expect(() => parseCronSchedule("0 0 * 13 * *")).toThrow();
  });
  it("finds minute-aligned occurrences strictly after the start", () => {
    expect(
      cronNextOccurrence("* * * * *", minute("2026-03-02T10:00:00Z")),
    ).toBe(minute("2026-03-02T10:01:00Z"));
    expect(
      cronNextOccurrence("30 9 * * 1", minute("2026-03-02T09:30:00Z")),
    ).toBe(minute("2026-03-09T09:30:00Z"));
    expect(
      cronNextOccurrence("0 0 29 2 *", minute("2027-01-01T00:00:00Z")),
    ).toBe(minute("2028-02-29T00:00:00Z"));
    expect(
      cronNextOccurrence("0 0 30 2 *", minute("2026-01-01T00:00:00Z")),
    ).toBeNull();
  });
  it("applies the day-of-month/day-of-week OR rule and Sunday aliases", () => {
    // 2026-03-07 is a Saturday.
    expect(
      cronNextOccurrence("0 0 7 * sat", minute("2026-03-01T00:00:00Z")),
    ).toBe(minute("2026-03-07T00:00:00Z"));
    expect(
      cronNextOccurrence("0 0 * * 7", minute("2026-03-02T00:00:00Z")),
    ).toBe(minute("2026-03-08T00:00:00Z"));
    expect(
      cronNextOccurrence("0 12 * * SUN", minute("2026-03-02T00:00:00Z")),
    ).toBe(minute("2026-03-08T12:00:00Z"));
  });
  it("reports runnable expressions", () => {
    expect(isRunnableCronSchedule("0 9 * * 1")).toBe(true);
    expect(isRunnableCronSchedule("nope")).toBe(false);
    expect(isRunnableCronSchedule("0 0 30 2 *")).toBe(false);
  });
});
