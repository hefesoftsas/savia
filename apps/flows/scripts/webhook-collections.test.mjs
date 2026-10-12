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
  "HTTP triggers use the enabling Savia user's current authority for native writes in both runtimes",
  { timeout: 90_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "savia-http-authority-"));
    let fixture = await createBrowserSmoke({ port: 0, directory });
    const secrets = fixture.secrets;
    const origin = "http://savia-flows-browser.fixture";
    const prefix = "/v1/savia-flows/tenant:101";
    async function json(
      path,
      { method = "GET", body, headers = {} } = {},
      status = 200,
    ) {
      const url = new URL(origin + path);
      if (path.startsWith("/v1/savia-flows/"))
        url.searchParams.set("tenant", "tenant:101");
      const response = await fixture.runtime.dispatchFetch(url, {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await response.json();
      assert.equal(
        response.status,
        status,
        `${path}: ${JSON.stringify(result)}`,
      );
      return result;
    }
    let types;
    function node(type, id, values = {}, x = 80) {
      const definition = types.find((item) => item.type === type);
      assert.ok(definition, `Missing ${type}`);
      return {
        id,
        type,
        name: definition.name,
        position: { x, y: 80 },
        inputs: definition.inputs.map((input) => ({
          ...input,
          ...(Object.hasOwn(values, input.name)
            ? { value: values[input.name] }
            : {}),
        })),
        outputs: definition.outputs,
      };
    }
    async function trigger(flow, key, title, status = 201) {
      return json(
        `/api/public/savia-flows/http/${flow.id}?principalId=forged-caller&tenant=tenant:202`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer " + key,
            "x-savia-principal": "forged-caller",
            "x-savia-tenant": "tenant:202",
            cookie: "private=do-not-store",
          },
          body: { title, status: "ready" },
        },
        status,
      );
    }
    async function enable(flow, enabled = true) {
      return json(prefix + `/workflows/${flow.id}/enabled`, {
        method: "PATCH",
        body: {
          enabled,
          userId: "forged-caller",
          principalId: "forged-caller",
        },
      });
    }
    async function completed(flow, executionId) {
      const deadline = Date.now() + 20_000;
      let result;
      while (Date.now() < deadline) {
        result = (await json(prefix + "/executions/" + executionId)).execution;
        if (["completed", "error", "failed"].includes(result.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(result.status, "completed", JSON.stringify(result));
      assert.equal(result.workflowId, flow.id);
      return result;
    }
    try {
      types = (await json("/v1/savia-flows/types")).nodeTypes;
      const key = await json(
        prefix + "/api-keys",
        { method: "POST", body: { name: "Native webhook" } },
        201,
      );
      const token = key.apiKey.apiKey;
      const flows = [];
      for (const [type, triggerType, savedRuntime] of [
        ["http-request", "http_request", "workflow"],
        ["http-webhook", "http_webhook", "worker"],
      ]) {
        const flow = await json(
          prefix + "/workflows",
          {
            method: "POST",
            body: {
              name: `Native ${type}`,
              trigger: triggerType,
              runtime: savedRuntime,
              nodes: [
                node(type, "inbound"),
                node("blob-to-json", "payload", {}, 360),
                node(
                  "savia-create-record",
                  "create",
                  { collection: "flow_results" },
                  640,
                ),
              ],
              edges: [
                {
                  source: "inbound",
                  sourceOutput: "body",
                  target: "payload",
                  targetInput: "blob",
                },
                {
                  source: "payload",
                  sourceOutput: "json",
                  target: "create",
                  targetInput: "data",
                },
              ],
            },
          },
          201,
        );
        flows.push(flow);
        await json(
          `/api/public/savia-flows/http/${flow.id}`,
          { method: "POST", body: { title: "No key" } },
          401,
        );
        await trigger(flow, token, "No execution authority", 409);
        assert.equal(
          (await json(prefix + `/workflows/${flow.id}/savia-http-authority`))
            .configured,
          false,
        );
        await enable(flow);
        assert.deepEqual(
          await json(prefix + `/workflows/${flow.id}/savia-http-authority`),
          { configured: true, active: true, configuredBy: "you" },
        );
        const submitted = await trigger(flow, token, `Payload from ${type}`);
        assert.equal(
          submitted.status,
          type === "http-request" ? "completed" : "submitted",
        );
        const result = await completed(flow, submitted.id);
        const record = result.nodeExecutions.find(
          (item) => item.nodeId === "create",
        ).outputs.data;
        assert.equal(record.title, `Payload from ${type}`);
        assert.equal(record.created_by, "browser-verification");
        const historyText = JSON.stringify(result);
        assert.equal(historyText.includes(token), false);
        assert.equal(historyText.includes("do-not-store"), false);
        assert.equal(
          result.nodeExecutions.find((item) => item.nodeId === "inbound")
            .outputs.headers.authorization,
          undefined,
        );
      }
      assert.equal(
        (await json("/v1/studio/101/api/records/flow_results")).data.length,
        2,
      );
      // A valid key from another tenant still cannot invoke either target flow.
      const api = await fixture.runtime.getWorker("savia-flows");
      const addedManager = await fixture.fixtureRequest("second-manager");
      assert.equal(addedManager.status, 200);
      await addedManager.text();
      const secondContext = await new SignJWT({
        name: "Second local manager",
        organization: {
          id: "tenant:101",
          name: "Local fixture",
          role: "admin",
        },
        platformAdmin: false,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer("savia")
        .setAudience("savia-flows")
        .setSubject("second-webhook-manager")
        .setIssuedAt()
        .setExpirationTime("60s")
        .sign(new TextEncoder().encode(secrets.bridgeSecret));
      const rebound = await api.fetch(
        `http://savia-flows.local/tenant:101/workflows/${flows[0].id}/enabled`,
        {
          method: "PATCH",
          headers: {
            "x-savia-flows-context": secondContext,
            "content-type": "application/json",
          },
          body: JSON.stringify({ enabled: true, principalId: "forged-caller" }),
        },
      );
      assert.equal(rebound.status, 200, await rebound.text());
      const reassigned = await trigger(
        flows[0],
        token,
        "Reassigned execution authority",
      );
      const reassignedExecution = await completed(flows[0], reassigned.id);
      assert.equal(
        reassignedExecution.nodeExecutions.find(
          (item) => item.nodeId === "create",
        ).outputs.data.created_by,
        "second-webhook-manager",
      );
      const configuredBySecond = await json(
        prefix + `/workflows/${flows[0].id}/savia-http-authority`,
      );
      assert.equal(configuredBySecond.configuredBy, undefined);
      assert.equal(
        JSON.stringify(configuredBySecond).includes("second-webhook-manager"),
        false,
      );
      await enable(flows[0]);
      const foreignContext = await new SignJWT({
        name: "Foreign fixture",
        organization: {
          id: "tenant:202",
          name: "Foreign fixture",
          role: "admin",
        },
        platformAdmin: false,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer("savia")
        .setAudience("savia-flows")
        .setSubject("foreign-fixture")
        .setIssuedAt()
        .setExpirationTime("60s")
        .sign(new TextEncoder().encode(secrets.bridgeSecret));
      const foreignResponse = await api.fetch(
        "http://savia-flows.local/tenant:202/api-keys",
        {
          method: "POST",
          headers: {
            "x-savia-flows-context": foreignContext,
            "content-type": "application/json",
          },
          body: JSON.stringify({ name: "Other tenant" }),
        },
      );
      assert.equal(foreignResponse.status, 201);
      const foreignKey = (await foreignResponse.json()).apiKey.apiKey;
      for (const flow of flows)
        await trigger(flow, foreignKey, "Wrong tenant", 401);

      const revoked = await json(
        prefix + "/api-keys",
        { method: "POST", body: { name: "Revoked webhook" } },
        201,
      );
      await json(prefix + "/api-keys/" + revoked.apiKey.id, {
        method: "DELETE",
      });
      for (const flow of flows)
        await trigger(flow, revoked.apiKey.apiKey, "Revoked key", 401);
      for (const flow of flows) {
        await enable(flow, false);
        await trigger(flow, token, "Disabled webhook", 404);
        assert.equal(
          (await json(prefix + `/workflows/${flow.id}/savia-http-authority`))
            .active,
          false,
        );
        await enable(flow);
      }
      await fixture.dispose();
      fixture = await createBrowserSmoke({ port: 0, directory, secrets });
      for (const flow of flows) {
        assert.equal(
          (await json(prefix + `/workflows/${flow.id}/savia-http-authority`))
            .active,
          true,
        );
        const result = await trigger(
          flow,
          token,
          "Persisted execution authority",
        );
        await completed(flow, result.id);
      }
      const countBeforeRevocation = (
        await json("/v1/studio/101/api/records/flow_results")
      ).data.length;
      assert.equal(countBeforeRevocation, 5);
      await fixture.revokeEditor();
      for (const flow of flows)
        await trigger(flow, token, "Revoked Savia authority", 403);
      assert.equal(
        (await json("/v1/studio/101/api/records/flow_results")).data.length,
        countBeforeRevocation,
      );
    } finally {
      await fixture.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
