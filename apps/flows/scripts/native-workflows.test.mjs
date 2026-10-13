import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrowserSmoke } from "./browser-smoke.mjs";

test(
  "Flows adopts existing native workflows and preserves publish, inbox, webhook, retry and restart behavior",
  { timeout: 120_000 },
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "savia-native-replacement-"),
    );
    let fixture = await createBrowserSmoke({ port: 0, directory });
    const keys = fixture.secrets;
    const native = "/v1/savia-flows/tenant:101/savia/native";
    const compatibility = "/v1/studio/101/api";
    const origin = "http://savia-flows-browser.fixture";
    async function json(
      path,
      method = "GET",
      body,
      expected = 200,
      headers = {},
    ) {
      const url = new URL(origin + path);
      if (path.startsWith("/v1/savia-flows/"))
        url.searchParams.set("tenant", "tenant:101");
      const response = await fixture.runtime.dispatchFetch(url, {
        method,
        headers: { "content-type": "application/json", ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const raw = await response.text();
      let result;
      try {
        result = JSON.parse(raw);
      } catch {
        throw new Error(`${path} returned ${response.status}: ${raw}`);
      }
      assert.equal(
        response.status,
        expected,
        `${path}: ${JSON.stringify(result)}`,
      );
      return result;
    }
    try {
      const initial = (await json(native + "/inventory")).data;
      assert.equal(initial.workflows, 0);
      const targetObject = (await json(compatibility + "/objects")).data.find(
        (object) => object.name === "flow_results",
      );
      await json(compatibility + "/objects/flow_results", "PUT", {
        ...targetObject,
        config: {
          ...targetObject.config,
          version: 2,
          fields: {
            ...targetObject.config.fields,
            title: {
              ...targetObject.config.fields.title,
              config: { unique: true },
            },
          },
        },
      });
      const definition = {
        trigger: { type: "manual" },
        positions: { prepare: { x: 125, y: 80 }, check: { x: 125, y: 240 } },
        nodes: [
          {
            id: "prepare",
            type: "transform",
            values: {
              title: { concat: ["Requested: ", { ref: "trigger.title" }] },
              next_date: {
                dateOffset: { value: { ref: "trigger.date" }, days: 1 },
              },
            },
            next: "check",
          },
          {
            id: "check",
            type: "condition",
            left: { ref: "trigger.status" },
            operator: "eq",
            right: "ready",
            next: "query",
            otherwise: "end",
          },
          {
            id: "query",
            type: "query",
            collection: "flow_results",
            field: "title",
            value: "Shared native key",
            limit: 20,
            next: "create",
          },
          {
            id: "create",
            type: "create",
            collection: "flow_results",
            matchField: "title",
            values: {
              title: "Shared native key",
              status: "new",
              count: { ref: "steps.query.count" },
            },
            next: "update",
          },
          {
            id: "update",
            type: "update",
            collection: "flow_results",
            recordId: { ref: "steps.create.id" },
            values: { status: "processed" },
            next: "task",
          },
          {
            id: "task",
            type: "task",
            title: { ref: "steps.prepare.title" },
            assignee: { ref: "system.owner" },
            dueDays: 0,
            next: "notice",
          },
          {
            id: "notice",
            type: "notification",
            title: "Native replacement verified",
            assignee: { ref: "system.owner" },
            next: "wait",
          },
          {
            id: "wait",
            type: "delay",
            until: "2000-01-01T00:00:00Z",
            next: "end",
          },
          { id: "end", type: "transform", values: {} },
        ],
      };
      const original = (
        await json(
          compatibility + "/workflows",
          "POST",
          { name: "Existing Studio flow", definition },
          201,
        )
      ).data;
      const flow = (await json(native + `/workflows/${original.id}`)).data;
      assert.deepEqual(flow.definition, definition);
      assert.equal((await json(native + "/workflows")).data.length, 1);
      await json(native + `/workflows/${flow.id}/publish`, "POST", {
        revision: flow.revision,
      });
      const saved = (
        await json(native + `/workflows/${flow.id}`, "PUT", {
          name: "Adopted native flow",
          revision: flow.revision,
          definition: {
            ...definition,
            positions: { prepare: { x: 510, y: 90 } },
            nodes: definition.nodes.map((node) =>
              node.id === "prepare"
                ? {
                    ...node,
                    values: { title: "Edited draft", next_date: "2026-10-13" },
                  }
                : node,
            ),
          },
        })
      ).data;
      assert.equal(saved.definition.positions.prepare.x, 510);
      const input = { title: "first", status: "ready", date: "2026-10-12" };
      const run = (
        await json(
          native + `/workflows/${flow.id}/start`,
          "POST",
          { data: input, key: "same-event" },
          202,
        )
      ).data;
      assert.equal(
        (
          await json(
            native + `/workflows/${flow.id}/start`,
            "POST",
            { data: input, key: "same-event" },
            202,
          )
        ).data.id,
        run.id,
      );
      await json(
        native + `/workflows/${flow.id}/start`,
        "POST",
        { data: { ...input, title: "changed" }, key: "same-event" },
        409,
      );
      await fixture.fixtureRequest("native-tick");
      const history = (await json(native + `/workflow-executions/${run.id}`))
        .data;
      assert.equal(history.status, "completed");
      assert.equal(
        history.jobs.find((job) => job.node_id === "prepare").output.title,
        "Requested: first",
      );
      assert.equal(
        history.jobs.find((job) => job.node_id === "prepare").output.next_date,
        "2026-10-13",
      );
      const inbox = (await json(native + "/workflow-inbox")).data;
      assert.equal(inbox.length, 2);
      assert.ok(inbox.every((item) => item.status === "open"));
      for (const item of inbox)
        await json(native + `/workflow-inbox/${item.id}/resolve`, "POST");
      assert.ok(
        (await json(native + "/workflow-inbox")).data.every(
          (item) => item.status === "done",
        ),
      );
      const second = (
        await json(
          native + `/workflows/${flow.id}/start`,
          "POST",
          { data: { ...input, title: "second" }, key: "second" },
          202,
        )
      ).data;
      await fixture.fixtureRequest("native-tick");
      const secondHistory = (
        await json(native + `/workflow-executions/${second.id}`)
      ).data;
      assert.equal(
        secondHistory.jobs.find((job) => job.node_id === "create").output.id,
        history.jobs.find((job) => job.node_id === "create").output.id,
      );
      const records = (await json(compatibility + "/records/flow_results"))
        .data;
      assert.equal(records.length, 1);
      assert.equal(records[0].status, "processed");
      assert.deepEqual(
        (await json(native + "/objects")).data
          .map((object) => object.name)
          .sort(),
        ["flow_requests", "flow_results"],
      );
      assert.deepEqual((await json(native + "/workflow-bundles")).data, []);

      const retryFlow = (
        await json(
          native + "/workflows",
          "POST",
          {
            name: "Retry a native step",
            definition: {
              trigger: { type: "manual" },
              nodes: [
                {
                  id: "prepare",
                  type: "transform",
                  values: { prepared: true },
                  next: "create",
                },
                {
                  id: "create",
                  type: "create",
                  collection: "flow_results",
                  values: { title: "Shared native key" },
                },
              ],
            },
          },
          201,
        )
      ).data;
      await json(native + `/workflows/${retryFlow.id}/publish`, "POST", {
        revision: retryFlow.revision,
      });
      const retryRun = (
        await json(
          native + `/workflows/${retryFlow.id}/start`,
          "POST",
          { data: {}, key: "unique-conflict" },
          202,
        )
      ).data;
      await fixture.fixtureRequest("native-tick");
      const failed = (
        await json(native + `/workflow-executions/${retryRun.id}`)
      ).data;
      assert.equal(failed.status, "failed");
      assert.equal(failed.node_id, "create");
      assert.equal(failed.jobs.length, 1);
      await json(
        compatibility + `/records/flow_results/${records[0].id}`,
        "PATCH",
        { title: "Released unique key", _version: records[0]._version },
      );
      assert.equal(
        (
          await json(
            native + `/workflow-executions/${retryRun.id}/retry`,
            "POST",
          )
        ).data.id,
        retryRun.id,
      );
      await fixture.fixtureRequest("native-tick");
      const resumed = (
        await json(native + `/workflow-executions/${retryRun.id}`)
      ).data;
      assert.equal(resumed.status, "completed");
      assert.equal(
        resumed.jobs.filter((job) => job.node_id === "prepare").length,
        1,
      );
      assert.equal(resumed.jobs.length, 2);

      const destination = (
        await json(
          native + "/workflow-webhook-destinations",
          "POST",
          {
            name: "Local verification destination",
            url: "https://example.com/first",
            authType: "none",
          },
          201,
        )
      ).data;
      const outbound = (
        await json(
          native + "/workflows",
          "POST",
          {
            name: "Outgoing native webhook",
            definition: {
              trigger: { type: "manual" },
              nodes: [
                {
                  id: "send",
                  type: "webhook",
                  destinationId: destination.id,
                  destinationRevision: destination.revision,
                  values: { title: "Local verification" },
                },
              ],
            },
          },
          201,
        )
      ).data;
      await json(native + `/workflows/${outbound.id}/publish`, "POST", {
        revision: outbound.revision,
      });
      await json(
        native + `/workflow-webhook-destinations/${destination.id}`,
        "PUT",
        {
          revision: destination.revision,
          config: {
            name: destination.name,
            url: "https://example.com/second",
            authType: "none",
          },
        },
      );
      assert.equal(
        (await json(native + `/workflows/${outbound.id}`)).data.definition
          .nodes[0].destinationRevision,
        1,
      );
      await json(
        native + `/workflow-webhook-destinations/${destination.id}/enabled`,
        "POST",
        { enabled: false },
      );
      const outboundRun = (
        await json(
          native + `/workflows/${outbound.id}/start`,
          "POST",
          { data: {}, key: "disabled-destination" },
          202,
        )
      ).data;
      await fixture.fixtureRequest("native-tick");
      assert.equal(
        (await json(native + `/workflow-executions/${outboundRun.id}`)).data
          .status,
        "failed",
      );

      const webhook = (
        await json(
          native + "/workflows",
          "POST",
          {
            name: "Native incoming webhook",
            definition: {
              trigger: { type: "webhook" },
              nodes: [
                {
                  id: "end",
                  type: "transform",
                  values: { value: { ref: "trigger.value" } },
                },
              ],
            },
          },
          201,
        )
      ).data;
      await json(native + `/workflows/${webhook.id}/publish`, "POST", {
        revision: webhook.revision,
      });
      const endpoint = (
        await json(native + `/workflows/${webhook.id}/webhook`, "POST")
      ).data;
      assert.ok(endpoint.secret);
      assert.equal(
        (await json(native + `/workflows/${webhook.id}/webhook`)).data.secret,
        undefined,
      );
      const headers = {
        authorization: "Bearer " + endpoint.secret,
        "idempotency-key": "incoming-1",
      };
      const incoming = await json(
        `/api/public/workflow-webhooks/${endpoint.id}`,
        "POST",
        { value: 42 },
        202,
        headers,
      );
      assert.equal(
        (
          await json(
            `/api/public/workflow-webhooks/${endpoint.id}`,
            "POST",
            { value: 42 },
            202,
            headers,
          )
        ).data.executionId,
        incoming.data.executionId,
      );
      await json(
        `/api/public/workflow-webhooks/${endpoint.id}`,
        "POST",
        { value: 43 },
        409,
        headers,
      );
      const rotated = (
        await json(native + `/workflows/${webhook.id}/webhook/rotate`, "POST")
      ).data;
      assert.equal(rotated.id, endpoint.id);
      await json(
        `/api/public/workflow-webhooks/${endpoint.id}`,
        "POST",
        { value: 42 },
        404,
        headers,
      );
      await fixture.fixtureRequest("native-tick");
      assert.equal(
        (
          await json(
            native + `/workflow-executions/${incoming.data.executionId}`,
          )
        ).data.status,
        "completed",
      );

      const waiting = (
        await json(
          native + "/workflows",
          "POST",
          {
            name: "Durable native wait",
            definition: {
              trigger: { type: "manual" },
              nodes: [
                { id: "wait", type: "delay", seconds: 3600, next: "end" },
                { id: "end", type: "transform", values: {} },
              ],
            },
          },
          201,
        )
      ).data;
      await json(native + `/workflows/${waiting.id}/publish`, "POST", {
        revision: waiting.revision,
      });
      const waitingRun = (
        await json(
          native + `/workflows/${waiting.id}/start`,
          "POST",
          { data: {}, key: "wait" },
          202,
        )
      ).data;
      await fixture.fixtureRequest("native-tick");
      assert.equal(
        (await json(native + `/workflow-executions/${waitingRun.id}`)).data
          .status,
        "waiting",
      );
      const beforeRestart = (await json(native + "/inventory")).data;
      await fixture.dispose();
      fixture = await createBrowserSmoke({ port: 0, directory, secrets: keys });
      assert.deepEqual((await json(native + "/inventory")).data, beforeRestart);
      assert.equal(
        (await json(native + `/workflows/${flow.id}`)).data.definition.positions
          .prepare.x,
        510,
      );
      assert.equal(
        (await json(native + `/workflow-executions/${waitingRun.id}`)).data
          .status,
        "waiting",
      );
      await json(
        native + `/workflow-executions/${waitingRun.id}/cancel`,
        "POST",
      );
      assert.equal(
        (await json(native + `/workflow-executions/${waitingRun.id}`)).data
          .status,
        "cancelled",
      );
      const scheduled = (
        await json(
          native + "/workflows",
          "POST",
          {
            name: "Native schedule",
            definition: {
              trigger: {
                type: "schedule",
                intervalMinutes: 1,
                startAt: "2020-01-01T00:00:00Z",
              },
              nodes: [
                {
                  id: "end",
                  type: "transform",
                  values: { owner: { ref: "system.owner" } },
                },
              ],
            },
          },
          201,
        )
      ).data;
      await json(native + `/workflows/${scheduled.id}/publish`, "POST", {
        revision: scheduled.revision,
      });
      await fixture.fixtureRequest("native-tick");
      const scheduledRun = (
        await json(native + `/workflows/${scheduled.id}/executions`)
      ).data[0];
      assert.ok(scheduledRun);
      assert.equal(
        (await json(native + `/workflow-executions/${scheduledRun.id}`)).data
          .jobs[0].output.owner,
        "browser-verification",
      );
      const blocked = (
        await json(
          native + `/workflows/${flow.id}/start`,
          "POST",
          { data: input, key: "revoked" },
          202,
        )
      ).data;
      await fixture.revokeEditor();
      await fixture.fixtureRequest("native-tick");
      const state = await (await fixture.fixtureRequest("native-state")).json();
      assert.equal(
        state.find((item) => item.id === blocked.id).status,
        "blocked",
      );
      await json(native + "/workflows", "GET", undefined, 403);
    } finally {
      await fixture.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
