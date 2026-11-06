import assert from "node:assert/strict";
import { test } from "node:test";
import { createBrowserSmoke } from "./browser-smoke.mjs";

test(
  "the actual Savia gateway and Flows service binding preserve editor access and reject the next command after host revocation",
  { timeout: 30_000 },
  async () => {
    const fixture = await createBrowserSmoke({ port: 0 });
    const { runtime } = fixture;
    const origin = "http://savia-flows-browser.fixture";
    let socket;
    async function json(path, init, status = 200) {
      const response = await runtime.dispatchFetch(origin + path, init);
      const value = await response.json();
      assert.equal(
        response.status,
        status,
        `${path}: unexpected response status`,
      );
      return value;
    }
    try {
      const shell = await runtime.dispatchFetch(
        origin + "/flows-ui/tenant:101/workflows",
      );
      assert.equal(shell.status, 200);
      assert.match(await shell.text(), /Savia Flows/);
      const user = await json("/v1/savia-flows/auth/user?tenant=tenant:101");
      assert.equal(user.user.provider, "savia");
      const workflow = await json(
        "/v1/savia-flows/tenant:101/workflows?tenant=tenant:101",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Host graph",
            trigger: "manual",
            runtime: "worker",
            nodes: [],
            edges: [],
          }),
        },
        201,
      );
      const ticket = await json(
        "/v1/savia-flows/ws-ticket?tenant=tenant:101",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: "/tenant:101/ws/" + workflow.id }),
        },
        201,
      );
      const url = new URL(ticket.url);
      url.protocol = "http:";
      const response = await runtime.dispatchFetch(url, {
        headers: { upgrade: "websocket" },
      });
      assert.equal(response.status, 101);
      socket = response.webSocket;
      assert.ok(socket);
      const initialized = new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Host editor did not initialize")),
          5000,
        );
        socket.addEventListener("message", (event) => {
          const message = JSON.parse(event.data);
          if (message.type === "init") {
            clearTimeout(timeout);
            resolve(message.state);
          }
        });
      });
      socket.accept();
      const state = await initialized;
      socket.send(
        JSON.stringify({
          type: "update",
          state: { ...state, name: "Saved over socket", timestamp: Date.now() },
        }),
      );
      const path =
        "/v1/savia-flows/tenant:101/workflows/" +
        workflow.id +
        "?tenant=tenant:101";
      let saved;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        saved = await json(path);
        if (saved.name === "Saved over socket") break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(saved.name, "Saved over socket");
      await fixture.revokeEditor();
      const closed = new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Revoked editor socket remained open")),
          5000,
        );
        socket.addEventListener("close", (event) => {
          clearTimeout(timeout);
          resolve(event.code);
        });
      });
      socket.send(
        JSON.stringify({
          type: "update",
          state: { ...state, name: "Rejected edit", timestamp: Date.now() },
        }),
      );
      assert.equal(await closed, 1008);
      assert.equal((await json(path)).name, "Saved over socket");
      assert.equal(
        (
          await runtime.dispatchFetch(
            origin + "/api/public/savia-flows/forms/invalid",
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await runtime.dispatchFetch(
            origin + "/api/public/savia-flows/workflows/private",
          )
        ).status,
        404,
      );
    } finally {
      socket?.close();
      await fixture.dispose();
    }
  },
);
