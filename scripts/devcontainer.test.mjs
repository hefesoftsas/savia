import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { checkDevelopmentEnvironment } from "../.devcontainer/verify.mjs";

async function environment(t, overrides = {}) {
  const responses = {
    admin: [200, "text/html", "<!doctype html><html><body>Admin</body></html>"],
    api: [200, "application/json", '{"status":"ok","database":"ok"}'],
    auth: [200, "application/json", '{"user":null}'],
    request: [403, "text/plain", "Acceso privado."],
    mailpit: [200, "text/plain", "OK"],
    ...overrides,
  };
  const server = createServer((req, res) => {
    const [status, contentType, body] = responses[req.url.slice(1)];
    res.writeHead(status, { "content-type": contentType }).end(body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return Object.fromEntries(
    Object.keys(responses).map((name) => [
      name,
      `http://127.0.0.1:${server.address().port}/${name}`,
    ]),
  );
}

test("accepts a ready development stack with its Request Worker private", async (t) => {
  assert.deepEqual(await checkDevelopmentEnvironment(await environment(t)), []);
});

test("rejects an HTTP 200 API whose database is unavailable", async (t) => {
  const urls = await environment(t, {
    api: [200, "application/json", '{"status":"ok","database":"error"}'],
  });
  assert.deepEqual(await checkDevelopmentEnvironment(urls), ["api"]);
});

test("reports unavailable services and an accidentally public Request Worker", async (t) => {
  const urls = await environment(t, {
    admin: [200, "application/json", "{}"],
    auth: [503, "text/plain", "Not ready"],
    request: [200, "application/json", "{}"],
    mailpit: [503, "text/plain", "Not ready"],
  });
  assert.deepEqual(await checkDevelopmentEnvironment(urls), [
    "admin",
    "auth",
    "request",
    "mailpit",
  ]);
});
