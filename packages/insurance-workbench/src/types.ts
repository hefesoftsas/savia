import type { PluginMessages } from "@savia/studio-shared/plugin-localization";
import type { PluginApi } from "@savia/studio-shared/plugin-api";
import type { ReactNode } from "react";
import type { WorkRecord } from "./data";
export type Field = {
  key: string;
  label: string;
  type?: "text" | "date" | "number" | "textarea" | "select";
  required?: boolean;
  min?: number;
  max?: number;
  requiredStages?: readonly string[];
  maxLength?: number;
  options?: readonly { value: string; label: string }[];
  help?: string;
};
export type WorkbenchConfig = {
  messages?: PluginMessages;
  object: string;
  title: string;
  description: string;
  singular: string;
  createLabel: string;
  fields: readonly Field[];
  defaults: Record<string, unknown>;
  stages: readonly { value: string; label: string }[];
  columns: readonly {
    key: string;
    label: string;
    numeric?: boolean;
    render: (record: WorkRecord, asOf: string) => ReactNode;
  }[];
  filters: readonly { value: string; label: string }[];
  matches: (record: WorkRecord, filter: string, asOf: string) => boolean;
  metrics: (
    records: WorkRecord[],
    asOf: string,
  ) => { label: string; value: string | number; detail: string }[];
  validate: (record: Record<string, unknown>) => string | null;
  exportRow: (record: WorkRecord) => unknown[];
  exportHeaders: string[];
  footerNote?: string;
  recordActions?: (props: {
    savia: PluginApi;
    record: WorkRecord;
    onSaved: () => void;
  }) => ReactNode;
  payment?: {
    balance: (record: WorkRecord) => number | null;
    patch: (
      record: WorkRecord,
      amount: string,
      date: string,
    ) => Record<string, unknown>;
  };
};
