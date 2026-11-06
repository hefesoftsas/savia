import type { PluginApi } from "@savia/plugin-sdk";
import { defineReactPlugin } from "@savia/plugin-sdk/react";
import { Workbench, type WorkbenchConfig } from "@savia/plugin-ui";
import "@savia/plugin-ui/workbench.css";

const config: WorkbenchConfig = {
  object: "example_tasks",
  title: "Example Tasks",
  description: "Manage your workspace records.",
  singular: "Record",
  createLabel: "New record",
  fields: [{ key: "name", label: "Name", required: true, lookup: true }],
  defaults: { name: "" },
  stages: [],
  columns: [
    {
      key: "name",
      label: "Name",
      render: (record) => String(record.name ?? ""),
    },
  ],
  filters: [{ value: "all", label: "All" }],
  matches: () => true,
  metrics: (records) => [
    { label: "Records", value: records.length, detail: "In this collection" },
  ],
  validate: (record) =>
    String(record.name ?? "").trim() ? null : "Name is required.",
  exportHeaders: ["Name"],
  exportRow: (record) => [record.name],
};
function Screen({ savia }: { savia: PluginApi }) {
  return <Workbench savia={savia} config={config} />;
}
const plugin = defineReactPlugin(Screen);
export const { render, renderPanel } = plugin;
