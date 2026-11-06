import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import WebSocket from "ws";
import { Hono } from "hono";
import { createNodeRealtimeHub } from "../src/realtime";

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});
const upgrade = (ticket: string) =>
  new Request(`http://localhost/v1/realtime/subscribe?ticket=${ticket}`, {
    headers: { Upgrade: "websocket" },
  });
describe("Node realtime tickets", () => {
  it("binds grants to room, consumes tickets once and expires them", async () => {
    let now = 1_000;
    const hub = createNodeRealtimeHub({ now: () => now });
    cleanup.push(() => hub.close());
    const { ticket } = await hub.issue("tenant:1", {
      principalId: "p",
      topics: ["records"],
    });
    expect((await hub.forward("tenant:2", upgrade(ticket))).status).toBe(401);
    expect((await hub.forward("tenant:1", upgrade(ticket))).status).toBe(204);
    expect((await hub.forward("tenant:1", upgrade(ticket))).status).toBe(401);
    const expired = await hub.issue("tenant:1", {
      principalId: "p",
      topics: ["records"],
    });
    now += 15_000;
    expect(
      (await hub.forward("tenant:1", upgrade(expired.ticket))).status,
    ).toBe(401);
  });
  it("validates grants and limits unconsumed tickets", async () => {
    const hub = createNodeRealtimeHub();
    cleanup.push(() => hub.close());
    await expect(
      hub.issue("bad", { principalId: "p", topics: ["records"] }),
    ).rejects.toThrow();
    await expect(
      hub.issue("tenant:1", { principalId: "p", topics: ["bad"] }),
    ).rejects.toThrow();
    for (let n = 0; n < 8; n++)
      await hub.issue("tenant:1", { principalId: "p", topics: ["records"] });
    await expect(
      hub.issue("tenant:1", { principalId: "p", topics: ["records"] }),
    ).rejects.toMatchObject({ status: 429 });
  });
  it("rejects upgrade responses without an internal authorization capability", () => {
    const hub = createNodeRealtimeHub();
    cleanup.push(() => hub.close());
    expect(
      hub.handleUpgrade(
        {} as never,
        {} as never,
        Buffer.alloc(0),
        new Response(null, { status: 204 }),
      ),
    ).toBe(false);
  });
  it("uses the existing connected/ping protocol and filters topic and room", async () => {
    const hub = createNodeRealtimeHub();
    cleanup.push(() => hub.close());
    const app = new Hono();
    app.use("*", async (c, next) => {
      await next();
      c.header("X-Test-Middleware", "cloned");
    });
    app.get("/*", async (c) => hub.forward("tenant:1", c.req.raw));
    const server = createServer();
    cleanup.push(() => server.close());
    server.on("upgrade", async (req, socket, head) => {
      const response = await app.fetch(
        new Request(`http://localhost${req.url}`, {
          headers: { Upgrade: "websocket" },
        }),
      );
      if (!hub.handleUpgrade(req, socket, head, response)) socket.destroy();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    const { ticket } = await hub.issue("tenant:1", {
      principalId: "p",
      topics: ["records"],
    });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?ticket=${ticket}`);
    cleanup.push(() => ws.terminate());
    const messages: string[] = [];
    ws.on("message", (data) => messages.push(data.toString()));
    await once(ws, "open");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(JSON.parse(messages[0])).toMatchObject({
      v: 1,
      topic: "records",
      type: "connected",
    });
    ws.send("ping");
    await once(ws, "message");
    expect(messages.at(-1)).toBe("pong");
    hub.publish("tenant:2", { topic: "records", type: "updated", id: 2 });
    hub.publish("tenant:1", { topic: "users", type: "updated", id: 3 });
    hub.publish("tenant:1", { topic: "records", type: "updated", id: 4 });
    await once(ws, "message");
    expect(messages).toHaveLength(3);
    expect(JSON.parse(messages.at(-1)!)).toMatchObject({ v: 1, id: 4 });
    ws.send('{"type":"publish"}');
    const [code] = await once(ws, "close");
    expect(code).toBe(1008);
  });
});
