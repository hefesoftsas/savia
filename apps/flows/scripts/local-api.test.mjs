import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalFlows } from "./dev-local.mjs";

const require = createRequire(new URL("../api/package.json", import.meta.url));
const { SignJWT } = require("jose");

test(
  "the complete local API saves graphs, runs both runtimes and recovers tenant-scoped resources after restart",
  { timeout: 90_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "savia-flows-api-"));
    const keys = Object.fromEntries(
      ["bridgeSecret", "secretMasterKey", "formSigningKey"].map((key) => [
        key,
        randomBytes(32).toString("hex"),
      ]),
    );
    let runtime;
    async function context(tenant = "tenant:101") {
      return new SignJWT({
        name: "Local verification",
        organization: { id: tenant, name: "Local verification", role: "admin" },
        platformAdmin: false,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject("local-verification")
        .setIssuer("savia")
        .setAudience("savia-flows")
        .setIssuedAt()
        .setExpirationTime("60s")
        .sign(new TextEncoder().encode(keys.bridgeSecret));
    }
    async function request(
      path,
      {
        method = "GET",
        body,
        tenant,
        headers: extraHeaders = {},
        authenticated = true,
      } = {},
    ) {
      const headers = new Headers(extraHeaders);
      if (authenticated)
        headers.set("x-savia-flows-context", await context(tenant));
      if (body !== undefined && !(body instanceof FormData))
        headers.set("content-type", "application/json");
      let payload = body === undefined ? undefined : JSON.stringify(body);
      if (body instanceof FormData) {
        const multipart = new Request("http://savia-flows.local", {
          method: "POST",
          body,
        });
        headers.set("content-type", multipart.headers.get("content-type"));
        payload = await multipart.arrayBuffer();
      }
      return runtime.dispatchFetch("http://savia-flows.local" + path, {
        method,
        headers,
        body: payload,
      });
    }
    async function json(path, options, status = 200) {
      const response = await request(path, options);
      const data = await response.json();
      assert.equal(response.status, status, `${path}: ${JSON.stringify(data)}`);
      return data;
    }
    function node(type, id, values = {}, position = { x: 80, y: 80 }) {
      return {
        id,
        type: type.type,
        name: type.name,
        position,
        inputs: type.inputs.map((input) => ({
          ...input,
          ...(Object.hasOwn(values, input.name)
            ? { value: values[input.name] }
            : {}),
        })),
        outputs: type.outputs,
      };
    }
    try {
      runtime = await startLocalFlows({
        port: 0,
        persist: join(directory, "state"),
        registryPath: join(directory, "registry"),
        secrets: keys,
      });
      assert.equal(
        (await request("/tenant:101/workflows", { authenticated: false }))
          .status,
        401,
      );
      assert.equal((await request("/tenant:202/workflows")).status, 403);
      assert.equal(
        (await request("/forms/invalid", { authenticated: false })).status,
        400,
      );
      const { nodeTypes } = await json("/types");
      assert.ok(nodeTypes.length > 300);
      const { templates } = await json("/templates");
      assert.ok(templates.length >= 20);
      const addition = nodeTypes.find((type) => type.type === "addition");
      const multiplication = nodeTypes.find(
        (type) => type.type === "multiplication",
      );
      const nodes = [
        node(addition, "sum", { a: 20, b: 22 }),
        node(multiplication, "double", { b: 2 }, { x: 380, y: 80 }),
      ];
      const edges = [
        {
          source: "sum",
          sourceOutput: "result",
          target: "double",
          targetInput: "a",
        },
      ];
      const workflow = await json(
        "/tenant:101/workflows",
        {
          method: "POST",
          body: {
            name: "Local graph",
            trigger: "manual",
            runtime: "worker",
            nodes,
            edges,
          },
        },
        201,
      );
      const workflowPath = "/tenant:101/workflows/" + workflow.id;
      assert.deepEqual((await json(workflowPath)).edges, edges);
      const executed = await json(
        workflowPath + "/execute/dev",
        { method: "POST", body: {} },
        201,
      );
      assert.equal(executed.status, "completed");
      assert.equal(
        executed.nodeExecutions.find(
          (execution) => execution.nodeId === "double",
        ).outputs.result,
        84,
      );
      const history = await json(
        "/tenant:101/executions?workflowId=" + workflow.id,
      );
      assert.equal(history.executions[0].id, executed.id);
      assert.equal(
        (
          await request("/tenant:202/executions/" + executed.id, {
            tenant: "tenant:202",
          })
        ).status,
        404,
      );

      const durable = await json(
        "/tenant:101/workflows",
        {
          method: "POST",
          body: {
            name: "Durable local graph",
            trigger: "manual",
            runtime: "workflow",
            nodes,
            edges,
          },
        },
        201,
      );
      const submitted = await json(
        "/tenant:101/workflows/" + durable.id + "/execute/dev",
        { method: "POST", body: {} },
        201,
      );
      let completed;
      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline) {
        const response = await request(
          "/tenant:101/executions/" + submitted.id,
        );
        if (response.ok) {
          completed = (await response.json()).execution;
          if (["completed", "failed"].includes(completed.status)) break;
        } else await response.text();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(completed?.status, "completed", JSON.stringify(completed));
      assert.equal(
        completed.nodeExecutions.find(
          (execution) => execution.nodeId === "double",
        ).outputs.result,
        84,
      );

      const secret = await json(
        "/tenant:101/secrets",
        {
          method: "POST",
          body: { name: "LOCAL_VERIFICATION", value: "local-only-secret" },
        },
        201,
      );
      const secretMetadata = await json(
        "/tenant:101/secrets/" + secret.secret.id,
      );
      assert.equal("value" in secretMetadata.secret, false);
      assert.equal(
        JSON.stringify(await json("/tenant:101/secrets")).includes(
          "local-only-secret",
        ),
        false,
      );
      const database = await json(
        "/tenant:101/databases",
        { method: "POST", body: { name: "local_proof" } },
        201,
      );
      await json("/tenant:101/databases/" + database.id + "/query", {
        method: "POST",
        body: { sql: "CREATE TABLE proof (value TEXT)" },
      });
      await json("/tenant:101/databases/" + database.id + "/query", {
        method: "POST",
        body: { sql: "INSERT INTO proof VALUES (?)", params: ["saved data"] },
      });

      const file = new FormData();
      const bytes = new Uint8Array([0, 255, 1, 128, 42]);
      file.append(
        "file",
        new File([bytes], "proof.bin", { type: "application/octet-stream" }),
      );
      const uploaded = await json("/tenant:101/objects", {
        method: "POST",
        body: file,
      });
      const reference = uploaded.reference;
      assert.ok(reference?.id, JSON.stringify(uploaded));
      const objectPath =
        "/tenant:101/objects?id=" +
        reference.id +
        "&mimeType=application%2Foctet-stream";
      assert.deepEqual(
        new Uint8Array(await (await request(objectPath)).arrayBuffer()),
        bytes,
      );
      assert.equal(
        (
          await request(objectPath.replace("tenant:101", "tenant:202"), {
            tenant: "tenant:202",
          })
        ).status,
        403,
      );
      const blobToText = nodeTypes.find((type) => type.type === "blob-to-text");
      const foreignBlob = await json(
        "/tenant:202/workflows",
        {
          tenant: "tenant:202",
          method: "POST",
          body: {
            name: "Foreign object denial",
            trigger: "manual",
            runtime: "worker",
            nodes: [node(blobToText, "read", { blob: reference })],
            edges: [],
          },
        },
        201,
      );
      const deniedBlob = await json(
        "/tenant:202/workflows/" + foreignBlob.id + "/execute/dev",
        { tenant: "tenant:202", method: "POST", body: {} },
        201,
      );
      assert.equal(deniedBlob.status, "error");
      const deniedHistory = await json(
        "/tenant:202/executions/" + deniedBlob.id,
        { tenant: "tenant:202" },
      );
      assert.match(deniedHistory.execution.error, /access denied/);

      const imageUpload = new FormData();
      imageUpload.append(
        "file",
        new File(
          [
            await readFile(
              new URL("../api/test/fixtures/lenna.png", import.meta.url),
            ),
          ],
          "image.png",
          { type: "image/png" },
        ),
      );
      const imageReference = (
        await json("/tenant:101/objects", { method: "POST", body: imageUpload })
      ).reference;
      const resize = nodeTypes.find((type) => type.type === "photon-resize");
      const imageWorkflow = await json(
        "/tenant:101/workflows",
        {
          method: "POST",
          body: {
            name: "Local image processing",
            trigger: "manual",
            runtime: "worker",
            nodes: [
              node(resize, "resize", {
                image: imageReference,
                width: 16,
                height: 16,
              }),
            ],
            edges: [],
          },
        },
        201,
      );
      const imageResult = await json(
        "/tenant:101/workflows/" + imageWorkflow.id + "/execute/dev",
        { method: "POST", body: {} },
        201,
      );
      assert.equal(
        imageResult.status,
        "completed",
        JSON.stringify(imageResult),
      );
      const resized = imageResult.nodeExecutions[0].outputs.image;
      const resizedResponse = await request(
        "/tenant:101/objects?id=" +
          resized.id +
          "&mimeType=" +
          encodeURIComponent(resized.mimeType),
      );
      assert.equal(resizedResponse.status, 200);
      const resizedBytes = new Uint8Array(await resizedResponse.arrayBuffer());
      assert.deepEqual(
        Array.from(resizedBytes.slice(0, 8)),
        [137, 80, 78, 71, 13, 10, 26, 10],
      );
      const dimensions = new DataView(
        resizedBytes.buffer,
        resizedBytes.byteOffset,
        resizedBytes.byteLength,
      );
      assert.equal(dimensions.getUint32(16), 16);
      assert.equal(dimensions.getUint32(20), 16);

      const httpType = nodeTypes.find((type) => type.type === "http-request");
      const http = await json(
        "/tenant:101/workflows",
        {
          method: "POST",
          body: {
            name: "Local HTTP trigger",
            trigger: "http_request",
            runtime: "worker",
            nodes: [
              node(httpType, "request"),
              node(addition, "sum", { a: 20, b: 22 }),
            ],
            edges: [],
          },
        },
        201,
      );
      const triggerPath = "/http/" + http.id;
      assert.equal(
        (await request(triggerPath, { authenticated: false })).status,
        401,
      );
      const createdKey = await json(
        "/tenant:101/api-keys",
        { method: "POST", body: { name: "Local trigger" } },
        201,
      );
      const apiKey = createdKey.apiKey.apiKey;
      assert.match(apiKey, /^dk_[a-f0-9]{64}$/);
      const triggered = await json(
        triggerPath,
        {
          authenticated: false,
          headers: {
            authorization: "Bearer " + apiKey,
            cookie: "private=local",
          },
        },
        201,
      );
      assert.equal(triggered.status, "completed");
      const inbound = triggered.nodeExecutions.find(
        (execution) => execution.nodeId === "request",
      ).outputs.headers;
      assert.equal(Object.hasOwn(inbound, "authorization"), false);
      assert.equal(Object.hasOwn(inbound, "cookie"), false);
      assert.equal(Object.hasOwn(inbound, "x-savia-flows-context"), false);
      await json("/tenant:101/api-keys/" + createdKey.apiKey.id, {
        method: "DELETE",
      });
      assert.equal(
        (
          await request(triggerPath, {
            authenticated: false,
            headers: { authorization: "Bearer " + apiKey },
          })
        ).status,
        401,
      );

      const schema = {
        id: "local-form",
        name: "Local form",
        fields: [{ name: "approved", type: "boolean", required: true }],
      };
      const formType = nodeTypes.find((type) => type.type === "form-request");
      const formWorkflow = await json(
        "/tenant:101/workflows",
        {
          method: "POST",
          body: {
            name: "Public local form",
            trigger: "form_request",
            runtime: "worker",
            nodes: [
              node(formType, "form", { title: "Local form", schema }),
              node(addition, "sum", { a: 20, b: 22 }),
            ],
            edges: [],
          },
        },
        201,
      );
      const publicFormPath = "/form-triggers/" + formWorkflow.id;
      assert.equal(
        (await json(publicFormPath, { authenticated: false })).title,
        "Local form",
      );
      const formResult = await json(
        publicFormPath,
        { authenticated: false, method: "POST", body: { approved: true } },
        201,
      );
      assert.equal(formResult.status, "completed");

      const createForm = nodeTypes.find((type) => type.type === "create-form");
      const waitForForm = nodeTypes.find(
        (type) => type.type === "wait-for-form",
      );
      const humanWorkflow = await json(
        "/tenant:101/workflows",
        {
          method: "POST",
          body: {
            name: "Human input local workflow",
            trigger: "manual",
            runtime: "workflow",
            nodes: [
              node(createForm, "create", { title: "Local approval", schema }),
              node(waitForForm, "wait"),
            ],
            edges: [
              {
                source: "create",
                sourceOutput: "token",
                target: "wait",
                targetInput: "token",
              },
            ],
          },
        },
        201,
      );
      const humanExecution = await json(
        "/tenant:101/workflows/" + humanWorkflow.id + "/execute/dev",
        { method: "POST", body: {} },
        201,
      );
      let humanState;
      let formUrl;
      const formDeadline = Date.now() + 15_000;
      while (Date.now() < formDeadline) {
        const response = await request(
          "/tenant:101/executions/" + humanExecution.id,
        );
        if (response.ok) {
          humanState = (await response.json()).execution;
          formUrl = humanState.nodeExecutions.find(
            (execution) => execution.nodeId === "create",
          )?.outputs?.url;
          if (formUrl || humanState.status === "failed") break;
        } else await response.text();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(formUrl, JSON.stringify(humanState));
      const signedToken = new URL(formUrl).pathname.split("/").at(-1);
      const humanFormPath = "/forms/" + signedToken;
      assert.equal(
        (await json(humanFormPath, { authenticated: false })).title,
        "Local approval",
      );
      await json(humanFormPath, {
        authenticated: false,
        method: "POST",
        body: { approved: true },
      });
      const resumeDeadline = Date.now() + 15_000;
      while (Date.now() < resumeDeadline) {
        humanState = (await json("/tenant:101/executions/" + humanExecution.id))
          .execution;
        if (["completed", "failed"].includes(humanState.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(humanState.status, "completed", JSON.stringify(humanState));
      assert.deepEqual(
        humanState.nodeExecutions.find(
          (execution) => execution.nodeId === "wait",
        ).outputs.response,
        { approved: true },
      );
      assert.equal(
        (
          await request(humanFormPath, {
            authenticated: false,
            method: "POST",
            body: { approved: true },
          })
        ).status,
        409,
      );

      const javascript = nodeTypes.find((type) => type.type === "javascript");
      const codeWorkflow = await json(
        "/tenant:101/workflows",
        {
          method: "POST",
          body: {
            name: "Local JavaScript",
            trigger: "manual",
            runtime: "worker",
            nodes: [
              node(javascript, "code", {
                script: "return args[0] + args[1]",
                args: [20, 22],
              }),
            ],
            edges: [],
          },
        },
        201,
      );
      const codeResult = await json(
        "/tenant:101/workflows/" + codeWorkflow.id + "/execute/dev",
        { method: "POST", body: {} },
        201,
      );
      assert.equal(codeResult.status, "completed", JSON.stringify(codeResult));
      assert.equal(codeResult.nodeExecutions[0].outputs.result, 42);

      const queue = await json(
        "/tenant:101/queues",
        { method: "POST", body: { name: "Local queue" } },
        201,
      );
      const queueType = nodeTypes.find((type) => type.type === "queue-message");
      const queuedWorkflow = await json(
        "/tenant:101/workflows",
        {
          method: "POST",
          body: {
            name: "Local queue trigger",
            trigger: "queue_message",
            runtime: "worker",
            nodes: [node(queueType, "message", { queueId: queue.id })],
            edges: [],
          },
        },
        201,
      );
      const queueKey = await json(
        "/tenant:101/api-keys",
        { method: "POST", body: { name: "Local queue trigger" } },
        201,
      );
      await json(
        "/queues/" + queue.id + "/publish",
        {
          authenticated: false,
          method: "POST",
          headers: { authorization: "Bearer " + queueKey.apiKey.apiKey },
          body: { payload: { message: "local" } },
        },
        201,
      );
      let queueHistory;
      const queueDeadline = Date.now() + 10_000;
      while (Date.now() < queueDeadline) {
        queueHistory = await json(
          "/tenant:101/executions?workflowId=" + queuedWorkflow.id,
        );
        if (queueHistory.executions.length) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(queueHistory.executions[0]?.status, "completed");
      const queueResult = (
        await json("/tenant:101/executions/" + queueHistory.executions[0].id)
      ).execution;
      assert.deepEqual(queueResult.nodeExecutions[0].outputs.payload, {
        message: "local",
      });

      const scheduledType = nodeTypes.find(
        (type) => type.type === "receive-scheduled-trigger",
      );
      const scheduledWorkflow = await json(
        "/tenant:101/workflows",
        {
          method: "POST",
          body: {
            name: "Local schedule",
            trigger: "scheduled",
            runtime: "worker",
            nodes: [
              node(scheduledType, "clock", { scheduleExpression: "* * * * *" }),
            ],
            edges: [],
          },
        },
        201,
      );
      const scheduler = await new SignJWT({
        name: "Local scheduler",
        organization: null,
        platformAdmin: true,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject("local-scheduler")
        .setIssuer("savia")
        .setAudience("savia-flows")
        .setIssuedAt()
        .setExpirationTime("60s")
        .sign(new TextEncoder().encode(keys.bridgeSecret));
      const tick = await runtime.dispatchFetch(
        "http://savia-flows.local/_local/scheduled",
        { method: "POST", headers: { "x-savia-flows-context": scheduler } },
      );
      assert.equal(tick.status, 200);
      await tick.text();
      const scheduledHistory = await json(
        "/tenant:101/executions?workflowId=" + scheduledWorkflow.id,
      );
      assert.equal(scheduledHistory.executions[0]?.status, "completed");

      const socketResponse = await request("/tenant:101/ws/" + workflow.id, {
        headers: { upgrade: "websocket" },
      });
      assert.equal(socketResponse.status, 101);
      const socket = socketResponse.webSocket;
      assert.ok(socket);
      const initialized = new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Editor socket did not initialize")),
          5000,
        );
        socket.addEventListener("message", (event) => {
          const message = JSON.parse(event.data);
          if (message.type === "init") {
            clearTimeout(timeout);
            resolve(message);
          }
        });
        socket.addEventListener("error", () => {
          clearTimeout(timeout);
          reject(new Error("Editor socket failed"));
        });
      });
      socket.accept();
      const socketState = await initialized;
      assert.ok(socketState);
      socket.close();

      await runtime.dispose();
      runtime = await startLocalFlows({
        port: 0,
        persist: join(directory, "state"),
        registryPath: join(directory, "registry"),
        secrets: keys,
      });
      assert.deepEqual((await json(workflowPath)).nodes, nodes);
      assert.equal(
        (await json("/tenant:101/executions/" + executed.id)).execution.status,
        "completed",
      );
      assert.equal(
        (await json("/tenant:101/executions/" + submitted.id)).execution.status,
        "completed",
      );
      assert.deepEqual(
        new Uint8Array(await (await request(objectPath)).arrayBuffer()),
        bytes,
      );
      const query = await json(
        "/tenant:101/databases/" + database.id + "/query",
        { method: "POST", body: { sql: "SELECT value FROM proof" } },
      );
      assert.equal(query.results[0].value, "saved data");
      await json(workflowPath, { method: "DELETE" });
      assert.equal((await request(workflowPath)).status, 404);
    } finally {
      await runtime?.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
