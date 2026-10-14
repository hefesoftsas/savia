import type { StoreRecordMonitor } from "@savia/studio-shared/plugin-store";

const MAX_TITLE_LENGTH = 500;
const MAX_BODY_LENGTH = 4_000;
const BOGOTA_OFFSET_MINUTES = -5 * 60;

export type MonitorObservationState = {
  status: string | null;
  deadline: number | null;
  notifiedHours: number[];
  sequence: number;
  deadlineRevision: number;
};

export type MonitorAlert = {
  kind: "status" | "deadline";
  key: string;
  title: string;
  body: string;
};

export type MonitorCheckPlan = {
  status: string;
  deadlineValue: string;
  deadlineAt: number | null;
  state: MonitorObservationState;
  alerts: MonitorAlert[];
  errorCode: string | null;
};

function text(value: unknown, maxLength = MAX_BODY_LENGTH): string {
  if (value === null || value === undefined) return "";
  return String(value).trim().slice(0, maxLength);
}

function firstText(
  row: Record<string, unknown>,
  fields: readonly string[],
): string | null {
  for (const field of fields) {
    const value = text(row[field]);
    if (value) return value;
  }
  return null;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function utcMillis(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);
  return date.getTime();
}

/** Parse only ISO calendar dates and ISO timestamps, without Date.parse rollover. */
export function parseMonitorDeadline(
  value: unknown,
  timeZone: "UTC" | "America/Bogota",
): number | null {
  if (typeof value !== "string") return null;
  const input = value.trim();
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  const timestampMatch =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?$/.exec(
      input,
    );
  if (!dateMatch && !timestampMatch) return null;

  const match = dateMatch ?? timestampMatch!;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  )
    return null;

  if (dateMatch) {
    const localEndOfDay = utcMillis(year, month, day, 23, 59, 59, 999);
    const offset = timeZone === "America/Bogota" ? BOGOTA_OFFSET_MINUTES : 0;
    return localEndOfDay - offset * 60_000;
  }

  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? "0");
  const millisecond = Number(((match[7] ?? "") + "000").slice(0, 3));
  if (hour > 23 || minute > 59 || second > 59) return null;

  const zone = match[8];
  let offset = timeZone === "America/Bogota" ? BOGOTA_OFFSET_MINUTES : 0;
  if (zone === "Z") offset = 0;
  else if (zone) {
    const zoneHours = Number(zone.slice(1, 3));
    const zoneMinutes = Number(zone.slice(4, 6));
    if (zoneHours > 23 || zoneMinutes > 59) return null;
    const magnitude = zoneHours * 60 + zoneMinutes;
    offset = zone[0] === "+" ? magnitude : -magnitude;
  }
  return (
    utcMillis(year, month, day, hour, minute, second, millisecond) -
    offset * 60_000
  );
}

function initialState(
  record: Record<string, unknown>,
  monitor: StoreRecordMonitor,
): MonitorObservationState {
  const status = text(record[monitor.status.field]) || null;
  const rawDeadline = record[monitor.deadline.field];
  return {
    status,
    deadline:
      typeof rawDeadline === "string"
        ? parseMonitorDeadline(rawDeadline, monitor.timeZone)
        : null,
    notifiedHours: [],
    sequence: 0,
    deadlineRevision: 0,
  };
}

function copyState(state: MonitorObservationState): MonitorObservationState {
  return {
    status: state.status,
    deadline: state.deadline,
    notifiedHours: [...new Set(state.notifiedHours)].filter(
      (hours) => Number.isInteger(hours) && hours > 0,
    ),
    sequence: Math.max(0, Math.floor(state.sequence)),
    deadlineRevision: Math.max(0, Math.floor(state.deadlineRevision)),
  };
}

function formatDeadline(
  deadline: number,
  timeZone: "UTC" | "America/Bogota",
): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(deadline));
}

function renderTemplate(
  template: string,
  values: Record<string, string>,
  maxLength: number,
): string {
  return template
    .replace(/\{\s*(name|previous|current|deadline|hours)\s*\}/g, (_, key: string) =>
      values[key] ?? "",
    )
    .slice(0, maxLength);
}

function makeAlert(
  monitor: StoreRecordMonitor,
  kind: MonitorAlert["kind"],
  key: string,
  titleTemplate: string,
  bodyTemplate: string,
  values: Record<string, string>,
): MonitorAlert {
  return {
    kind,
    key,
    title: renderTemplate(titleTemplate, values, MAX_TITLE_LENGTH),
    body: renderTemplate(bodyTemplate, values, MAX_BODY_LENGTH),
  };
}

/** Compare a saved interest with the single exact SECOP lookup result. */
export function planMonitorCheck(args: {
  monitor: StoreRecordMonitor;
  record: Record<string, unknown>;
  rows: Record<string, unknown>[];
  state?: MonitorObservationState;
  now: number;
}): MonitorCheckPlan {
  const { monitor, record, rows, now } = args;
  const expectedId = record[monitor.matchField];
  const matches = rows.filter((row) => row.id === expectedId);
  if (matches.length !== 1) throw new Error("record_missing");
  const remote = matches[0];
  const state = copyState(args.state ?? initialState(record, monitor));
  const alerts: MonitorAlert[] = [];
  let status = state.status ?? "";

  const remoteStatus = firstText(remote, monitor.status.resultFields);
  if (remoteStatus !== null) {
    if (state.status !== null && remoteStatus !== state.status) {
      const previous = state.status;
      state.sequence += 1;
      alerts.push(
        makeAlert(
          monitor,
          "status",
          `status:${state.sequence}`,
          monitor.notifications.changedTitle,
          monitor.notifications.changedBody,
          { name: text(record[monitor.titleField], 500), previous, current: remoteStatus },
        ),
      );
    }
    state.status = remoteStatus;
    status = remoteStatus;
  }

  const rawDeadline = firstText(remote, monitor.deadline.resultFields);
  const deadlineValue = rawDeadline ?? "";
  let deadlineAt: number | null = null;
  let errorCode: string | null = null;
  if (rawDeadline !== null) {
    deadlineAt = parseMonitorDeadline(rawDeadline, monitor.timeZone);
    if (deadlineAt === null) {
      errorCode = "invalid_deadline";
    } else if (deadlineAt !== state.deadline) {
      state.deadlineRevision += 1;
      state.notifiedHours = [];
      state.deadline = deadlineAt;
    }
  } else {
    if (state.deadline !== null) {
      state.deadlineRevision += 1;
      state.notifiedHours = [];
    }
    state.deadline = null;
  }

  if (deadlineAt !== null && deadlineAt > now) {
    const remainingHours = (deadlineAt - now) / 3_600_000;
    const threshold = [...monitor.reminderHours]
      .sort((a, b) => a - b)
      .find((hours) => remainingHours <= hours);
    if (threshold !== undefined && !state.notifiedHours.includes(threshold)) {
      state.notifiedHours.push(threshold);
      alerts.push(
        makeAlert(
          monitor,
          "deadline",
          `deadline:${state.deadlineRevision}:${deadlineAt}:${threshold}`,
          monitor.notifications.closingTitle,
          monitor.notifications.closingBody,
          {
            name: text(record[monitor.titleField], 500),
            deadline: formatDeadline(deadlineAt, monitor.timeZone),
            hours: String(threshold),
          },
        ),
      );
    }
  }

  return { status, deadlineValue, deadlineAt, state, alerts, errorCode };
}
