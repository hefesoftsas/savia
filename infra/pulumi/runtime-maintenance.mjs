// This module never defines a migration. Existing class names and namespace
// bindings must be supplied unchanged by the retirement publisher.
export function maintenanceModule({
  durableObjectClasses = [],
  workflowClasses = [],
}) {
  const classes = [...durableObjectClasses, ...workflowClasses];
  if (
    classes.some(
      (name) => typeof name !== "string" || !/^[A-Z][A-Za-z0-9_]*$/.test(name),
    )
  )
    throw new Error("Unsupported maintenance class name");
  if (new Set(classes).size !== classes.length)
    throw new Error("Duplicate maintenance class");
  return [
    'import { DurableObject, WorkflowEntrypoint } from "cloudflare:workers";',
    'const unavailable = () => new Response("Environment retired; data retained", { status: 503 });',
    ...durableObjectClasses.map(
      (name) =>
        `export class ${name} extends DurableObject { async alarm() {} async fetch() { return unavailable(); } }`,
    ),
    ...workflowClasses.map(
      (name) =>
        `export class ${name} extends WorkflowEntrypoint { async run() { throw new Error("Environment retired"); } }`,
    ),
    "export default { fetch: unavailable, scheduled() {}, queue(batch) { batch.retryAll(); }, email(message) { message.setReject('Environment retired'); } };",
  ].join("\n");
}

export function maintenanceWorkerConfig(config) {
  const result = {
    ...config,
    main: "maintenance.mjs",
    workers_dev: false,
    preview_urls: false,
    routes: [],
    services: [],
    tail_consumers: [],
    workflows: [],
    triggers: { crons: [] },
    queues: { consumers: [], producers: [] },
    durable_objects: {
      bindings: (config.durable_objects?.bindings ?? []).filter(
        (binding) =>
          !binding.script_name || binding.script_name === config.name,
      ),
    },
  };
  delete result.assets;
  return result;
}
