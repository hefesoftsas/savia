import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createBrowserSmoke } from "./browser-smoke.mjs";

const require = createRequire(new URL("../api/package.json", import.meta.url));
const { SignJWT } = require("jose");

test(
  "native Savia collections execute both runtimes, deduplicate delivery, stop cycles, and persist across restart",
  { timeout: 90_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "savia-native-flows-"));
    let fixture = await createBrowserSmoke({ port: 0, directory });
    const secrets = fixture.secrets;
    const origin = "http://savia-flows-browser.fixture";
    const flowPrefix = "/v1/savia-flows/tenant:101";
    const studioPrefix = "/v1/studio/101/api/records";
    async function json(
      path,
      { method = "GET", body, headers } = {},
      status = 200,
    ) {
      const response = await fixture.runtime.dispatchFetch(
        origin +
          path +
          (path.startsWith(flowPrefix)
            ? (path.includes("?") ? "&" : "?") + "tenant=tenant:101"
            : ""),
        {
          method,
          headers: { "content-type": "application/json", ...headers },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
      );
      const data = await response.json();
      assert.equal(response.status, status, `${path}: ${JSON.stringify(data)}`);
      return data;
    }
    let types;
    const node = (type, id, values = {}, position = { x: 80, y: 80 }) => {
      const definition = types.find((item) => item.type === type);
      assert.ok(definition, `Missing node ${type}`);
      return {
        id,
        type,
        name: definition.name,
        position,
        inputs: definition.inputs.map((input) => ({
          ...input,
          ...(Object.hasOwn(values, input.name)
            ? { value: values[input.name] }
            : {}),
        })),
        outputs: definition.outputs,
      };
    };
    const edge = (source, sourceOutput, target, targetInput) => ({
      source,
      sourceOutput,
      target,
      targetInput,
    });
    async function workflow(
      name,
      nodes,
      { runtime = "worker", trigger = "manual", edges = [] } = {},
    ) {
      return json(
        flowPrefix + "/workflows",
        { method: "POST", body: { name, runtime, trigger, nodes, edges } },
        201,
      );
    }
    async function execute(flow) {
      return json(
        flowPrefix + "/workflows/" + flow.id + "/execute/dev",
        { method: "POST", body: {} },
        201,
      );
    }
    async function subscribe(flow, config) {
      await json(flowPrefix + "/workflows/" + flow.id + "/savia-trigger", {
        method: "PUT",
        body: { ignoreOwnChanges: true, ...config },
      });
      await json(flowPrefix + "/workflows/" + flow.id + "/enabled", {
        method: "PATCH",
        body: { enabled: true },
      });
    }
    async function history(flow) {
      return (await json(flowPrefix + "/executions?workflowId=" + flow.id))
        .executions;
    }
    async function waitForRuns(flow, count) {
      const deadline = Date.now() + 20_000;
      let executions = [];
      while (Date.now() < deadline) {
        await (await fixture.fixtureRequest("drain")).text();
        executions = await history(flow);
        if (
          executions.length >= count &&
          executions.every((item) =>
            ["completed", "failed", "error"].includes(item.status),
          )
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(executions.length, count, JSON.stringify(executions));
      assert.ok(
        executions.every((item) => item.status === "completed"),
        JSON.stringify(executions),
      );
      return executions;
    }
    async function eventRows() {
      return (await fixture.fixtureRequest("events")).json();
    }
    async function replayEvent(row) {
      const event = {
        id: row.id,
        tenant: row.tenant_id,
        collection: row.collection_name,
        operation: row.operation,
        recordId: row.record_id,
        recordVersion: row.record_version,
        timestamp: row.occurred_at,
        before: null,
        after: null,
        changedFields: [],
        actor: { kind: row.actor_kind, id: row.actor_id },
      };
      const body = JSON.stringify(event);
      const { createHash } = await import("node:crypto");
      const token = await new SignJWT({
        tenant: event.tenant,
        eventId: event.id,
        bodyDigest: createHash("sha256").update(body).digest("hex"),
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer("savia")
        .setAudience("savia-flows-collection-events")
        .setIssuedAt()
        .setExpirationTime("30s")
        .sign(new TextEncoder().encode(secrets.bridgeSecret));
      const receiver = await fixture.runtime.getWorker("savia-flows");
      const response = await receiver.fetch(
        "http://savia-flows.local/internal/savia/collection-events",
        { method: "POST", headers: { "x-savia-flows-event": token }, body },
      );
      assert.equal(response.status, 200, await response.text());
    }
    try {
      types = (await json("/v1/savia-flows/types?tenant=tenant:101")).nodeTypes;
      assert.equal(
        types.filter((type) => type.type.startsWith("savia-")).length,
        6,
      );
      const catalog = await json(flowPrefix + "/savia/collections");
      assert.deepEqual(catalog.collections.map((item) => item.name).sort(), [
        "flow_requests",
        "flow_results",
      ]);
      // A real production host gateway, current Studio schema, and all native CRUD nodes.
      const create = await workflow("Native create", [
        node("savia-create-record", "create", {
          collection: "flow_results",
          data: { title: "Manual native record", status: "new", count: 1 },
        }),
      ]);
      const created = await execute(create);
      assert.equal(created.status, "completed", JSON.stringify(created));
      const record = created.nodeExecutions[0].outputs.data;
      const read = await workflow("Native read", [
        node("savia-read-record", "read", {
          collection: "flow_results",
          recordId: record.id,
        }),
      ]);
      assert.equal(
        (await execute(read)).nodeExecutions[0].outputs.data.title,
        "Manual native record",
      );
      const update = await workflow("Native update", [
        node("savia-update-record", "update", {
          collection: "flow_results",
          recordId: record.id,
          version: 1,
          data: { status: "ready" },
        }),
      ]);
      assert.equal(
        (await execute(update)).nodeExecutions[0].outputs.data._version,
        2,
      );
      const stale = await execute(update);
      assert.equal(stale.status, "error");
      const list = await workflow("Native list", [
        node("savia-list-records", "list", {
          collection: "flow_results",
          filters: { status: "ready" },
          pageSize: 1,
        }),
      ]);
      const listed = await execute(list);
      assert.equal(listed.nodeExecutions[0].outputs.total, 1);
      assert.equal(listed.nodeExecutions[0].outputs.data[0].id, record.id);
      const remove = await workflow("Native delete", [
        node("savia-delete-record", "delete", {
          collection: "flow_results",
          recordId: record.id,
          version: 2,
        }),
      ]);
      assert.equal(
        (await execute(remove)).nodeExecutions[0].outputs.data._version,
        3,
      );
      assert.equal((await json(studioPrefix + "/flow_results")).data.length, 0);

      const graph = [
        node("savia-collection-event", "event"),
        node(
          "json-extract-object",
          "after",
          { path: "$.after" },
          { x: 320, y: 80 },
        ),
        node(
          "json-template",
          "values",
          { template: { title: "${title}", status: "${status}", count: 7 } },
          { x: 560, y: 80 },
        ),
        node(
          "savia-create-record",
          "copy",
          { collection: "flow_results" },
          { x: 800, y: 80 },
        ),
      ];
      const edges = [
        edge("event", "event", "after", "json"),
        edge("after", "value", "values", "variables"),
        edge("values", "result", "copy", "data"),
      ];
      const worker = await workflow("On request created", graph, {
        trigger: "savia_collection_event",
        edges,
      });
      const durable = await workflow("On status changed", graph, {
        trigger: "savia_collection_event",
        runtime: "workflow",
        edges,
      });
      await subscribe(worker, {
        collection: "flow_requests",
        operations: ["created"],
        conditions: [{ field: "status", source: "after", equals: "ready" }],
      });
      await subscribe(durable, {
        collection: "flow_requests",
        operations: ["updated"],
        watchedFields: ["status"],
        conditions: [{ field: "status", source: "after", equals: "ready" }],
      });
      const draft = (
        await json(
          studioPrefix + "/flow_requests",
          {
            method: "POST",
            body: { title: "Durable event payload", status: "draft", count: 1 },
          },
          201,
        )
      ).data;
      await json(studioPrefix + "/flow_requests/" + draft.id, {
        method: "PATCH",
        body: { _version: 1, count: 2 },
      });
      await json(studioPrefix + "/flow_requests/" + draft.id, {
        method: "PATCH",
        body: { _version: 2, status: "ready" },
      });
      const durableRuns = await waitForRuns(durable, 1);
      const durableDetails = await json(
        flowPrefix + "/executions/" + durableRuns[0].id,
      );
      assert.equal(durableDetails.execution.status, "completed");
      assert.equal(durableDetails.execution.nodeExecutions.length, 4);
      const ready = (
        await json(
          studioPrefix + "/flow_requests",
          {
            method: "POST",
            body: { title: "Worker event payload", status: "ready" },
          },
          201,
        )
      ).data;
      const workerRuns = await waitForRuns(worker, 1);
      const workerDetails = await json(
        flowPrefix + "/executions/" + workerRuns[0].id,
      );
      assert.equal(workerDetails.execution.status, "completed");
      assert.equal(workerDetails.execution.nodeExecutions.length, 4);
      const resultRecords = (await json(studioPrefix + "/flow_results")).data;
      assert.deepEqual(resultRecords.map((item) => item.title).sort(), [
        "Durable event payload",
        "Worker event payload",
      ]);
      assert.ok(resultRecords.every((item) => item.count === 7));
      const rows = await eventRows();
      const original = rows.find(
        (item) => item.record_id === ready.id && item.operation === "created",
      );
      await Promise.all([replayEvent(original), replayEvent(original)]);
      assert.equal((await history(worker)).length, 1);
      assert.equal((await json(studioPrefix + "/flow_results")).data.length, 2);

      const lifecycle = await workflow(
        "Delete and restore",
        [node("savia-collection-event", "event")],
        { trigger: "savia_collection_event" },
      );
      await subscribe(lifecycle, {
        collection: "flow_requests",
        operations: ["deleted", "restored"],
      });
      await json(studioPrefix + "/flow_requests/" + ready.id + "?version=1", {
        method: "DELETE",
      });
      await json(studioPrefix + "/flow_requests/" + ready.id + "/restore", {
        method: "POST",
        body: { version: 2 },
      });
      await waitForRuns(lifecycle, 2);
      const loop = await workflow(
        "Ignore own collection changes",
        [
          node("savia-collection-event", "event"),
          node("savia-create-record", "write", {
            collection: "flow_results",
            data: { title: "Self change", status: "loop-test" },
          }),
        ],
        { trigger: "savia_collection_event" },
      );
      await subscribe(loop, {
        collection: "flow_results",
        operations: ["created"],
        conditions: [{ field: "status", source: "after", equals: "loop-test" }],
      });
      await json(
        studioPrefix + "/flow_results",
        { method: "POST", body: { title: "Loop root", status: "loop-test" } },
        201,
      );
      await waitForRuns(loop, 1);
      await (await fixture.fixtureRequest("drain")).text();
      assert.equal((await history(loop)).length, 1);
      assert.equal(
        (await json(studioPrefix + "/flow_results")).data.filter(
          (item) => item.status === "loop-test",
        ).length,
        2,
      );

      // A generic enable toggle must not revive a deactivated subscription or
      // admit changes queued before an explicit subscription save.
      await json(flowPrefix + "/workflows/" + worker.id + "/enabled", {
        method: "PATCH",
        body: { enabled: false },
      });
      await json(flowPrefix + "/workflows/" + worker.id + "/enabled", {
        method: "PATCH",
        body: { enabled: true },
      });
      assert.equal(
        (await json(flowPrefix + "/workflows/" + worker.id + "/savia-trigger"))
          .enabled,
        false,
      );
      const disabledRecord = (
        await json(
          studioPrefix + "/flow_requests",
          {
            method: "POST",
            body: { title: "Disabled subscription", status: "ready" },
          },
          201,
        )
      ).data;
      await (await fixture.fixtureRequest("drain")).text();
      assert.equal((await history(worker)).length, 1);
      await subscribe(worker, {
        collection: "flow_requests",
        operations: ["created"],
        conditions: [{ field: "status", source: "after", equals: "ready" }],
      });
      const disabledEvent = (await eventRows()).find(
        (item) =>
          item.record_id === disabledRecord.id && item.operation === "created",
      );
      await replayEvent(disabledEvent);
      assert.equal((await history(worker)).length, 1);

      await fixture.dispose();
      fixture = await createBrowserSmoke({ port: 0, directory, secrets });
      assert.equal((await history(worker))[0].id, workerRuns[0].id);
      assert.equal((await history(durable))[0].id, durableRuns[0].id);
      assert.equal(
        (await json(flowPrefix + "/workflows/" + worker.id + "/savia-trigger"))
          .enabled,
        true,
      );
      await replayEvent(original);
      assert.equal((await history(worker)).length, 1);
      assert.equal((await json(studioPrefix + "/flow_results")).data.length, 4);
      await fixture.revokeEditor();
      await json(
        studioPrefix + "/flow_requests",
        {
          method: "POST",
          body: { title: "Revoked subscriber", status: "ready" },
        },
        201,
      );
      await (await fixture.fixtureRequest("drain")).text();
      assert.equal((await history(worker)).length, 1);
    } finally {
      await fixture.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
