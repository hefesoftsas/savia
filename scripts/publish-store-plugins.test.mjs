import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  apiPrefix,
  listPorts,
  parseArguments,
  publishPorts,
} from "./publish-store-plugins.mjs";

describe("publish-store-plugins", () => {
  it("construye el prefijo por tenant o dominio", () => {
    assert.equal(
      apiPrefix("https://api.test/", { tenant: "agency:101" }),
      "https://api.test/v1/dynamic-crm/agency%3A101/api",
    );
    assert.equal(
      apiPrefix("https://api.test", { domain: "platform" }),
      "https://api.test/v1/data-domains/platform/api",
    );
    assert.throws(() => apiPrefix("https://api.test", {}), /tenant/);
  });

  it("exige auth salvo dry-run y valida ports", () => {
    assert.throws(
      () =>
        parseArguments([
          "--api-url",
          "https://api.test",
          "--tenant",
          "agency:101",
        ]),
      /cookie/i,
    );
    const dry = parseArguments([
      "--api-url",
      "https://api.test",
      "--tenant",
      "agency:101",
      "--dry-run",
      "--ports",
      "http-echo",
    ]);
    assert.deepEqual(dry.ports, ["http-echo"]);
    assert.throws(
      () =>
        parseArguments([
          "--api-url",
          "https://api.test",
          "--tenant",
          "agency:101",
          "--dry-run",
          "--ports",
          "inexistente",
        ]) && listPorts(["inexistente"]),
      /desconocido/,
    );
    assert.ok(listPorts(null).includes("http-echo"));
  });

  it("empaqueta sin red en dry-run", async () => {
    const logs = [];
    const results = await publishPorts(
      {
        apiUrl: "https://api.test",
        tenant: "agency:101",
        cookie: null,
        ports: ["http-echo"],
        install: false,
        dryRun: true,
      },
      { log: (line) => logs.push(line) },
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].id, "custom.http-echo");
    assert.equal(results[0].uploaded, "dry-run");
    assert.ok(logs[0].startsWith("OK http-echo"));
  });

  it("resuelve la URL del ambiente preview desde la rama", () => {
    const options = parseArguments([
      "--preview-branch",
      "chibchombiano26/plugin-store-epic",
      "--tenant",
      "agency:101",
      "--dry-run",
    ]);
    assert.equal(
      options.apiUrl,
      "https://savia-agencies-preview-chibchombiano26-plugin-s.workers.dev",
    );
  });

  it("sube e instala contra un stub HTTP", async () => {
    const { createServer } = await import("node:http");
    const seen = [];
    const server = createServer(async (request, response) => {
      let body = Buffer.alloc(0);
      for await (const chunk of request) body = Buffer.concat([body, chunk]);
      seen.push(`${request.method} ${request.url} ${body.length}b`);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: {} }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      const results = await publishPorts(
        {
          apiUrl: `http://127.0.0.1:${address.port}`,
          tenant: "agency:101",
          cookie: "session=abc",
          ports: ["http-echo"],
          install: true,
          dryRun: false,
        },
        { log: () => {} },
      );
      assert.equal(results[0].uploaded, true);
      assert.equal(results[0].installed, true);
      assert.equal(results[0].error, null);
      assert.ok(
        seen.some((line) =>
          line.startsWith(
            "POST /v1/dynamic-crm/agency%3A101/api/plugin-store/upload",
          ),
        ),
      );
      assert.ok(
        seen.some((line) =>
          line.startsWith(
            "POST /v1/dynamic-crm/agency%3A101/api/extensions/custom.http-echo/install",
          ),
        ),
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
