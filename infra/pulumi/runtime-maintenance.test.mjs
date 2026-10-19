import test from "node:test";
import assert from "node:assert/strict";
import {
  maintenanceModule,
  maintenanceWorkerConfig,
} from "./runtime-maintenance.mjs";

test("namespace hosts preserve class exports with inert alarms and no storage mutations", () => {
  const source = maintenanceModule({
    durableObjectClasses: ["DatabaseDO", "RealtimeHub"],
    workflowClasses: ["ExecuteWorkflow"],
  });
  for (const name of ["DatabaseDO", "RealtimeHub"])
    assert.match(
      source,
      new RegExp(`export class ${name} extends DurableObject`),
    );
  assert.match(
    source,
    /export class ExecuteWorkflow extends WorkflowEntrypoint/,
  );
  assert.match(source, /async alarm\(\) \{\}/);
  assert.doesNotMatch(
    source,
    /storage\.(delete|put|sql)|(?:await|return)\s+fetch\(|setAlarm|migrations|deleteNamespace/,
  );
  assert.match(source, /status: 503/);
  assert.throws(
    () => maintenanceModule({ durableObjectClasses: ["Bad;code()"] }),
    /class/,
  );
  assert.throws(
    () =>
      maintenanceModule({
        durableObjectClasses: ["Store"],
        workflowClasses: ["Store"],
      }),
    /Duplicate/,
  );
});

test("maintenance detaches cross-script references while retaining local namespaces", () => {
  const config = maintenanceWorkerConfig({
    name: "savia-agencies-preview",
    main: "original.mjs",
    workers_dev: true,
    routes: ["example.test/*"],
    services: [{ binding: "AUTH", service: "savia-auth-preview" }],
    durable_objects: {
      bindings: [
        { name: "LOCAL", class_name: "RealtimeHub" },
        { name: "REMOTE", class_name: "Store", script_name: "other" },
      ],
    },
    queues: {
      consumers: [{ queue: "q" }],
      producers: [{ queue: "q", binding: "QUEUE" }],
    },
    workflows: [{ name: "w" }],
    triggers: { crons: ["* * * * *"] },
  });
  assert.deepEqual(config.durable_objects.bindings, [
    { name: "LOCAL", class_name: "RealtimeHub" },
  ]);
  assert.deepEqual(config.services, []);
  assert.deepEqual(config.queues, { consumers: [], producers: [] });
  assert.deepEqual(config.workflows, []);
  assert.deepEqual(config.routes, []);
  assert.deepEqual(config.triggers, { crons: [] });
  assert.equal(config.workers_dev, false);
  assert.equal(config.main, "maintenance.mjs");
});
