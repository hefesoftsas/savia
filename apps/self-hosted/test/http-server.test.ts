import { afterEach, expect, it } from "vitest";
import { request as nodeRequest } from "node:http";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { brotliCompressSync, gzipSync, brotliDecompressSync } from "node:zlib";
import WebSocket from "ws";
import { startHttpServer } from "../src/http-server";
import { createNodeRealtimeHub } from "../src/realtime";
import officeManifest from "../../admin/office-runtime.json";
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function fixture(
  fetchApi: (request: Request) => Promise<Response> = async (r) =>
    Response.json({ url: r.url, headers: Object.fromEntries(r.headers) }),
  trustedProxyAddresses?: string[],
) {
  const directory = await mkdtemp(join(tmpdir(), "savia-http-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "assets"));
  await mkdir(join(directory, "office"));
  await writeFile(join(directory, "index.html"), "<main>app</main>");
  await writeFile(join(directory, "office/index.html"), "<main>office</main>");
  await writeFile(
    join(directory, "assets/app-abcdef12.js"),
    "export const ok=true;",
  );
  await writeFile(join(directory, "sw.js"), "/* worker */");
  const realtime = createNodeRealtimeHub();
  const gateway = await startHttpServer({
    host: "127.0.0.1",
    port: 0,
    publicOrigin: "http://savia.test",
    canonicalHost: "savia.test",
    adminDirectory: directory,
    fetchApi,
    realtime,
    trustedProxyAddresses,
  });
  cleanup.push(async () => {
    realtime.close();
    await gateway.close();
  });
  const port = (gateway.address() as { port: number }).port;
  const get = (
    path: string,
    headers: Record<string, string> = {},
    method = "GET",
    body?: string,
  ) =>
    new Promise<{
      status: number;
      headers: Record<string, unknown>;
      body: string;
      raw: Buffer;
    }>((resolve, reject) => {
      const req = nodeRequest(
        {
          host: "127.0.0.1",
          port,
          path,
          method,
          headers: { host: "savia.test", ...headers },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () =>
            resolve({
              status: res.statusCode!,
              headers: res.headers,
              body: Buffer.concat(chunks).toString(),
              raw: Buffer.concat(chunks),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(body);
    });
  return { directory, port, get, realtime };
}
it("routes API requests with socket IP and host-derived tenant context only", async () => {
  const { get } = await fixture();
  const res = await get("/v1/items", {
    host: "acme.savia.test",
    "cf-connecting-ip": "evil",
    "x-forwarded-for": "evil",
    "x-forwarded-host": "other.test",
    forwarded: "for=evil",
    "x-savia-tenant-slug": "other",
    "x-savia-tenant-branding": "fake",
  });
  expect(res.status).toBe(200);
  const data = JSON.parse(res.body);
  expect(data.url).toBe("http://acme.savia.test/v1/items");
  expect(data.headers["x-savia-tenant-slug"]).toBe("acme");
  expect(data.headers["cf-connecting-ip"]).toMatch(/127\.0\.0\.1/);
  expect(data.headers["x-forwarded-for"]).toBeUndefined();
  expect(data.headers["forwarded"]).toBeUndefined();
  expect(data.headers["x-savia-tenant-branding"]).toBeUndefined();
  const canonical = JSON.parse(
    (await get("/v1/items", { "x-savia-tenant-slug": "spoof" })).body,
  );
  expect(canonical.headers["x-savia-tenant-slug"]).toBeUndefined();
});
it("rejects unexpected hosts while keeping health probes available", async () => {
  const { get } = await fixture();
  expect((await get("/", { host: "evil.test" })).status).toBe(421);
  expect((await get("/v1/items", { host: "a.b.savia.test" })).status).toBe(421);
  expect((await get("/health", { host: "127.0.0.1" })).status).toBe(200);
});
it("serves SPA and Office documents, preserves public isolation, and never substitutes HTML for missing chunks", async () => {
  const { get } = await fixture();
  expect((await get("/workspace/view")).body).toContain("app");
  const asset = await get("/assets/app-abcdef12.js");
  expect(asset.headers["content-type"]).toContain("javascript");
  expect(asset.headers["cache-control"]).toContain("immutable");
  expect((await get("/assets/gone.js")).status).toBe(404);
  expect((await get("/sw.js")).headers["cache-control"]).toContain("no-store");
  const office = await get("/office/edit");
  expect(office.body).toContain("office");
  expect(office.headers["cross-origin-embedder-policy"]).toBe("require-corp");
  const pub = await get("/public/forms/abcdefghijklmnopqrst");
  expect(pub.headers["cache-control"]).toBe("no-store");
  expect(pub.headers["referrer-policy"]).toBe("no-referrer");
  expect((await get("/", {}, "HEAD")).body).toBe("");
  expect((await get("/", {}, "POST")).status).toBe(405);
});
it("blocks traversal, dotfiles, malformed escapes and symlinks escaping the static root", async () => {
  const { get, directory } = await fixture();
  await writeFile(join(directory, ".env"), "secret");
  await symlink("/etc/passwd", join(directory, "leak.txt"));
  for (const path of [
    "/../package.json",
    "/%2e%2e/package.json",
    "/%2e%2e%2fpackage.json",
    "/.env",
    "/bad%ZZ",
    "/leak.txt",
  ])
    expect((await get(path)).status, path).toBeGreaterThanOrEqual(400);
});
it("streams API bodies and preserves multiple cookies without exposing internal upgrade capabilities", async () => {
  const { get } = await fixture(
    async (req) =>
      new Response(await req.text(), {
        headers: [
          ["Set-Cookie", "a=1; Path=/"],
          ["Set-Cookie", "b=2; Path=/"],
          ["X-Savia-Internal-Realtime-Upgrade", "secret"],
        ],
      }),
  );
  const response = await get("/v1/echo", {}, "POST", "hello");
  expect(response.body).toBe("hello");
  expect(response.headers["set-cookie"]).toEqual([
    "a=1; Path=/",
    "b=2; Path=/",
  ]);
  expect(response.headers["x-savia-internal-realtime-upgrade"]).toBeUndefined();
});
it("passes websocket upgrades through API authorization and consumes the authorized response", async () => {
  let hub: ReturnType<typeof createNodeRealtimeHub>;
  const fixtureResult = await fixture(async (req) =>
    req.headers.get("authorization") === "Bearer allowed"
      ? hub.forward("tenant:1", req)
      : new Response("Denied", { status: 401 }),
  );
  hub = fixtureResult.realtime;
  const { port } = fixtureResult;
  const denied = new WebSocket(
    `ws://127.0.0.1:${port}/v1/realtime/subscribe?ticket=bad`,
    { headers: { Host: "savia.test" } },
  );
  const rejected = await new Promise<number>((resolve, reject) => {
    denied.on("unexpected-response", (_req, res) => {
      resolve(res.statusCode!);
      res.resume();
      denied.terminate();
    });
    denied.on("error", () => {});
    setTimeout(() => reject(new Error("No denial")), 1000).unref();
  });
  expect(rejected).toBe(401);
  const { ticket } = await hub.issue("tenant:1", {
    principalId: "p",
    topics: ["records"],
  });
  const ws = new WebSocket(
    `ws://127.0.0.1:${port}/v1/realtime/subscribe?ticket=${ticket}`,
    { headers: { Host: "savia.test", Authorization: "Bearer allowed" } },
  );
  const message = once(ws, "message");
  await once(ws, "open");
  expect(JSON.parse((await message)[0].toString()).type).toBe("connected");
  ws.terminate();
});

it("negotiates precompressed assets, honors q=0, and varies its response", async () => {
  const { get, directory } = await fixture();
  const source = Buffer.from("export const ok=true;");
  await writeFile(
    join(directory, "assets/app-abcdef12.js.br"),
    brotliCompressSync(source),
  );
  await writeFile(
    join(directory, "assets/app-abcdef12.js.gz"),
    gzipSync(source),
  );
  const br = await get("/assets/app-abcdef12.js", {
    "accept-encoding": "gzip, br",
  });
  expect(br.headers["content-encoding"]).toBe("br");
  expect(br.headers["vary"]).toBe("Accept-Encoding");
  expect(brotliDecompressSync(br.raw)).toEqual(source);
  expect(
    (await get("/assets/app-abcdef12.js", { "accept-encoding": "br;q=0,gzip" }))
      .headers["content-encoding"],
  ).toBe("gzip");
  expect(
    (
      await get("/assets/app-abcdef12.js", {
        "accept-encoding": "br;q=0,gzip;q=0",
      })
    ).headers["content-encoding"],
  ).toBeUndefined();
});

it("trusts only a valid final client IP from an explicitly allowed proxy socket", async () => {
  const { get } = await fixture(undefined, ["127.0.0.1"]);
  const trusted = JSON.parse(
    (await get("/v1/items", { "x-forwarded-for": "spoofed, 203.0.113.9" }))
      .body,
  );
  expect(trusted.headers["cf-connecting-ip"]).toBe("203.0.113.9");
  expect(trusted.headers["x-forwarded-for"]).toBeUndefined();
  const invalid = JSON.parse(
    (await get("/v1/items", { "x-forwarded-for": "203.0.113.9, invalid:99" }))
      .body,
  );
  expect(invalid.headers["cf-connecting-ip"]).toBe("127.0.0.1");
});

it("serves only installed Office runtime manifest files with GET and HEAD", async () => {
  const { get, directory } = await fixture();
  const target = join(directory, "office/runtime", officeManifest.build);
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "soffice.js"), "office runtime");
  const path = `/office/runtime/${officeManifest.build}/soffice.js`;
  const result = await get(path);
  expect(result.body).toBe("office runtime");
  expect(result.headers["content-type"]).toBe("text/javascript");
  expect(result.headers["cross-origin-resource-policy"]).toBe("same-origin");
  const head = await get(path, {}, "HEAD");
  expect(head.body).toBe("");
  expect(head.headers["content-length"]).toBe("14");
  expect(
    (await get(`/office/runtime/${officeManifest.build}/unlisted.js`)).status,
  ).toBe(404);
});
