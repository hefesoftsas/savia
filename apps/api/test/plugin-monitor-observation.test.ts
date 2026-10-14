import { describe, expect, it } from "vitest";
import type { StoreRecordMonitor } from "@savia/studio-shared/plugin-store";
import {
  parseMonitorDeadline,
  planMonitorCheck,
  type MonitorObservationState,
} from "../src/studio/plugin-monitor-observation";

const monitor: StoreRecordMonitor = {
  id: "secop-opportunities",
  collection: "procurement_opportunities",
  actionId: "search",
  lookup: { field: "process_id", argument: "id_del_proceso" },
  matchField: "source_id",
  status: {
    field: "source_status",
    resultFields: ["estado_del_procedimiento", "estado"],
  },
  deadline: {
    field: "deadline",
    resultFields: ["fecha_de_recepcion_de", "fecha_limite"],
  },
  enabledField: "monitoring_enabled",
  checkedAtField: "monitor_checked_at",
  errorField: "monitor_error",
  titleField: "name",
  intervalMinutes: 60,
  reminderHours: [168, 72, 24],
  timeZone: "America/Bogota",
  pauseWhen: { field: "status", values: ["discarded", "awarded"] },
  notifications: {
    changedTitle: "{name} status changed",
    changedBody: "{previous} → {current}",
    closingTitle: "{name} closes soon",
    closingBody: "{deadline} · {hours} hours",
    connectionTitle: "Connection problem",
    connectionBody: "Could not check {{name}}",
  },
};

const now = Date.UTC(2026, 9, 14, 12);
const record = {
  source_id: "source-1",
  process_id: "process-1",
  source_status: "Publicado",
  deadline: "2026-10-21",
  name: "Tender alpha",
};

function plan(
  rows: Record<string, unknown>[],
  state?: MonitorObservationState,
  overrides: { record?: Record<string, unknown>; now?: number } = {},
) {
  return planMonitorCheck({
    monitor,
    record: overrides.record ?? record,
    rows,
    ...(state ? { state } : {}),
    now: overrides.now ?? now,
  });
}

describe("parseMonitorDeadline", () => {
  it("uses UTC or Bogota for date-only and offset-less timestamps", () => {
    expect(parseMonitorDeadline("2026-10-14", "UTC")).toBe(
      Date.UTC(2026, 9, 14, 23, 59, 59, 999),
    );
    expect(parseMonitorDeadline("2026-10-14", "America/Bogota")).toBe(
      Date.UTC(2026, 9, 15, 4, 59, 59, 999),
    );
    expect(
      parseMonitorDeadline("2026-10-14T12:30:00", "America/Bogota"),
    ).toBe(Date.UTC(2026, 9, 14, 17, 30));
    expect(parseMonitorDeadline("2026-10-14T12:30:00", "UTC")).toBe(
      Date.UTC(2026, 9, 14, 12, 30),
    );
  });

  it("respects explicit offsets and rejects malformed or impossible dates", () => {
    expect(
      parseMonitorDeadline("2026-10-14T12:30:00-05:00", "UTC"),
    ).toBe(Date.UTC(2026, 9, 14, 17, 30));
    expect(parseMonitorDeadline("2026-10-14T17:30:00Z", "America/Bogota")).toBe(
      Date.UTC(2026, 9, 14, 17, 30),
    );
    for (const invalid of [
      "2026-02-29",
      "2024-02-30T12:00:00",
      "2026-13-01",
      "2026-10-14T24:00:00",
      "2026-10-14T12:60:00Z",
      "10/14/2026",
      "2026-10-14 12:00:00",
      "2026-10-14T12:00:00+25:00",
    ]) {
      expect(parseMonitorDeadline(invalid, "UTC"), invalid).toBeNull();
    }
  });
});

describe("planMonitorCheck", () => {
  it("requires one exact normalized ID match", () => {
    expect(() => plan([{ id: "unrelated", estado: "Cerrado" }])).toThrow(
      "record_missing",
    );
    expect(() =>
      plan([
        { id: "source-1", estado: "Cerrado" },
        { id: "source-1", estado: "Cerrado" },
      ]),
    ).toThrow("record_missing");
  });

  it("uses saved values as its initial baseline and tracks A to B to A transitions", () => {
    const initial = plan([
      { id: "source-1", estado: "En evaluación", fecha_limite: "2026-10-28" },
    ]);
    expect(initial.alerts.filter((alert) => alert.kind === "status")).toEqual([
      expect.objectContaining({
        key: "status:1",
        title: "Tender alpha status changed",
        body: "Publicado → En evaluación",
      }),
    ]);
    expect(initial.state.status).toBe("En evaluación");
    expect(initial.state.deadlineRevision).toBe(1);

    const back = plan(
      [{ id: "source-1", estado: "Publicado", fecha_limite: "2026-10-28" }],
      initial.state,
    );
    expect(back.alerts.find((alert) => alert.kind === "status")?.key).toBe(
      "status:2",
    );
    expect(back.state.status).toBe("Publicado");
  });

  it("preserves a missing remote status without inventing a transition", () => {
    const result = plan([
      { id: "source-1", fecha_limite: "2026-10-28" },
    ]);
    expect(result.status).toBe("Publicado");
    expect(result.state.status).toBe("Publicado");
    expect(result.alerts.some((alert) => alert.kind === "status")).toBe(false);
  });

  it("clears missing deadline aliases and reports invalid dates without reminders", () => {
    const missing = plan([{ id: "source-1", estado: "Publicado" }]);
    expect(missing.deadlineValue).toBe("");
    expect(missing.deadlineAt).toBeNull();

    const invalid = plan([
      { id: "source-1", estado: "Publicado", fecha_limite: "31/12/2026" },
    ]);
    expect(invalid.errorCode).toBe("invalid_deadline");
    expect(invalid.deadlineAt).toBeNull();
    expect(invalid.alerts.some((alert) => alert.kind === "deadline")).toBe(false);
  });

  it("emits each 168, 72 and 24 hour milestone once as time advances", () => {
    const deadline = now + 168 * 3_600_000;
    const at168 = plan([
      { id: "source-1", estado: "Publicado", fecha_limite: new Date(deadline).toISOString() },
    ]);
    expect(at168.alerts.find((alert) => alert.kind === "deadline")?.key).toBe(
      `deadline:1:${deadline}:168`,
    );
    const replay = plan(
      [{ id: "source-1", estado: "Publicado", fecha_limite: new Date(deadline).toISOString() }],
      at168.state,
    );
    expect(replay.alerts).toEqual([]);

    const at72 = plan(
      [{ id: "source-1", estado: "Publicado", fecha_limite: new Date(deadline).toISOString() }],
      at168.state,
      { now: deadline - 72 * 3_600_000 },
    );
    expect(at72.alerts.find((alert) => alert.kind === "deadline")?.key).toBe(
      `deadline:1:${deadline}:72`,
    );
    const at24 = plan(
      [{ id: "source-1", estado: "Publicado", fecha_limite: new Date(deadline).toISOString() }],
      at72.state,
      { now: deadline - 24 * 3_600_000 },
    );
    expect(at24.alerts.find((alert) => alert.kind === "deadline")?.key).toBe(
      `deadline:1:${deadline}:24`,
    );
  });

  it("emits only the closest crossed threshold on a late check and suppresses expired deadlines", () => {
    const deadline = now + 12 * 3_600_000;
    const late = plan([
      { id: "source-1", estado: "Publicado", fecha_limite: new Date(deadline).toISOString() },
    ]);
    expect(late.alerts.filter((alert) => alert.kind === "deadline")).toHaveLength(1);
    expect(late.alerts.find((alert) => alert.kind === "deadline")?.key).toBe(
      `deadline:1:${deadline}:24`,
    );
    const expired = plan(
      [{ id: "source-1", estado: "Publicado", fecha_limite: new Date(deadline).toISOString() }],
      undefined,
      { now: deadline },
    );
    expect(expired.alerts.some((alert) => alert.kind === "deadline")).toBe(false);
  });

  it("resets milestone identity when the closing date moves", () => {
    const firstDeadline = now + 72 * 3_600_000;
    const first = plan([
      { id: "source-1", estado: "Publicado", fecha_limite: new Date(firstDeadline).toISOString() },
    ]);
    const nextDeadline = now + 168 * 3_600_000;
    const moved = plan(
      [{ id: "source-1", estado: "Publicado", fecha_limite: new Date(nextDeadline).toISOString() }],
      first.state,
    );
    expect(moved.state.deadlineRevision).toBe(first.state.deadlineRevision + 1);
    expect(moved.state.notifiedHours).toEqual([168]);
    expect(moved.alerts.find((alert) => alert.kind === "deadline")?.key).toBe(
      `deadline:${moved.state.deadlineRevision}:${nextDeadline}:168`,
    );
  });
});
