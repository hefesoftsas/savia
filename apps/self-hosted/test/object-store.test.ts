import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { once } from "node:events";
import { test } from "vitest";
import { createObjectStore } from "../src/object-store.ts";

async function storage(
  t: { onTestFinished(fn: () => Promise<void> | void): void },
  handle: (req: IncomingMessage, res: ServerResponse) => void,
) {
  const server = createServer(handle);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const store = createObjectStore({
    endpoint: `http://127.0.0.1:${address.port}`,
    bucket: "files",
    region: "us-east-1",
    accessKeyId: "test",
    secretAccessKey: "test",
    forcePathStyle: true,
  });
  t.onTestFinished(async () => {
    store.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return store;
}
const xmlError = (res: ServerResponse, status: number, code: string) => {
  res.writeHead(status, { "Content-Type": "application/xml" });
  res.end(`<Error><Code>${code}</Code><Message>${code}</Message></Error>`);
};

test("round-trips binary body and HTTP/custom metadata through signed S3 requests", async (t) => {
  let body = Buffer.alloc(0);
  let headers: IncomingMessage["headers"] = {};
  const store = await storage(t, async (req, res) => {
    assert.match(req.headers.authorization ?? "", /^AWS4-HMAC-SHA256/);
    assert.equal(req.url?.split("?")[0], "/files/folder/caf%C3%A9.txt");
    if (req.method === "PUT") {
      headers = req.headers;
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = Buffer.concat(chunks);
      res.writeHead(200, { ETag: '"abc"' });
      res.end();
    } else {
      const metadata = Object.fromEntries(
        Object.entries(headers).filter(([name]) =>
          name.startsWith("x-amz-meta-"),
        ),
      );
      res.writeHead(200, {
        ...metadata,
        ETag: '"abc"',
        "Last-Modified": "Sat, 19 Sep 2026 12:00:00 GMT",
        "Content-Length": body.length,
        "Content-Type": headers["content-type"] ?? "application/octet-stream",
        "Cache-Control": headers["cache-control"] ?? "",
        "Content-Disposition": headers["content-disposition"] ?? "",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    }
  });
  const saved = await store.put(
    "folder/café.txt",
    new Uint8Array([0, 1, 255]),
    {
      httpMetadata: {
        contentType: "text/plain",
        cacheControl: "private",
        contentDisposition: "attachment",
      },
      customMetadata: { UserName: "José", role: "owner" },
    },
  );
  assert.equal(saved?.etag, "abc");
  assert.equal(saved?.httpEtag, '"abc"');
  const read = await store.get("folder/café.txt");
  assert.ok(read && "body" in read);
  assert.equal(read.size, 3);
  assert.equal(read.version, saved?.version);
  assert.deepEqual(read.customMetadata, { UserName: "José", role: "owner" });
  assert.equal(read.httpMetadata?.contentType, "text/plain");
  const responseHeaders = new Headers();
  read.writeHttpMetadata(responseHeaders);
  assert.equal(responseHeaders.get("cache-control"), "private");
  assert.equal(read.bodyUsed, false);
  assert.deepEqual([...new Uint8Array(await read.arrayBuffer())], [0, 1, 255]);
  assert.equal(read.bodyUsed, true);
  await assert.rejects(read.text());
  const head = await store.head("folder/café.txt");
  assert.ok(head && !("body" in head));
  assert.equal(head.size, 3);
});

test("reads ranged bodies with total size and exact returned range", async (t) => {
  const store = await storage(t, (req, res) => {
    assert.equal(req.headers.range, "bytes=2-4");
    res.writeHead(206, {
      ETag: '"range"',
      "Content-Length": 3,
      "Content-Range": "bytes 2-4/10",
    });
    res.end("234");
  });
  const result = await store.get("file", { range: { offset: 2, length: 3 } });
  assert.ok(result && "body" in result);
  assert.equal(result.size, 10);
  assert.deepEqual(result.range, { offset: 2, length: 3 });
  assert.equal(await result.text(), "234");
});

test("conditional writes fail atomically and conditional reads return only metadata", async (t) => {
  let puts = 0;
  const store = await storage(t, (req, res) => {
    if (req.method === "PUT") {
      puts++;
      assert.equal(req.headers["if-none-match"], "*");
      xmlError(res, 412, "PreconditionFailed");
    } else if (req.method === "GET") {
      assert.equal(req.headers["if-match"], '"old"');
      xmlError(res, 412, "PreconditionFailed");
    } else {
      res.writeHead(200, { ETag: '"current"', "Content-Length": 7 });
      res.end();
    }
  });
  assert.equal(
    await store.put("file", "new", { onlyIf: { etagDoesNotMatch: "*" } }),
    null,
  );
  assert.equal(puts, 1);
  const current = await store.get("file", { onlyIf: { etagMatches: "old" } });
  assert.ok(current && !("body" in current));
  assert.equal(current.etag, "current");
});

test("missing objects become null but authorization/service errors propagate", async (t) => {
  const store = await storage(t, (req, res) => {
    if (req.url?.includes("denied")) xmlError(res, 403, "AccessDenied");
    else xmlError(res, 404, "NoSuchKey");
  });
  assert.equal(await store.get("missing"), null);
  assert.equal(await store.head("missing"), null);
  await assert.rejects(store.get("denied"), /AccessDenied/);
});

test("list preserves S3 cursor and prefixes, and delete surfaces per-key failures", async (t) => {
  const store = await storage(t, async (req, res) => {
    if (req.method === "GET") {
      const url = new URL(req.url!, "http://test");
      assert.equal(url.searchParams.get("continuation-token"), "previous");
      assert.equal(url.searchParams.get("prefix"), "folder/");
      assert.equal(url.searchParams.get("max-keys"), "2");
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(
        '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>true</IsTruncated><NextContinuationToken>next</NextContinuationToken><Contents><Key>folder/a</Key><Size>3</Size><ETag>"one"</ETag><LastModified>2026-09-19T12:00:00Z</LastModified></Contents><CommonPrefixes><Prefix>folder/nested/</Prefix></CommonPrefixes></ListBucketResult>',
      );
    } else {
      for await (const _chunk of req) {
        /* drain signed payload */
      }
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(
        '<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Error><Key>protected</Key><Code>AccessDenied</Code><Message>Denied</Message></Error></DeleteResult>',
      );
    }
  });
  const page = await store.list({
    prefix: "folder/",
    limit: 2,
    cursor: "previous",
    delimiter: "/",
  });
  assert.equal(page.truncated, true);
  assert.equal(page.cursor, "next");
  assert.deepEqual(page.delimitedPrefixes, ["folder/nested/"]);
  assert.equal(page.objects[0].key, "folder/a");
  assert.equal(page.objects[0].size, 3);
  await assert.rejects(store.delete(["protected"]), /protected.*AccessDenied/);
});

test("blob reads retain content type and consume the shared stream", async (t) => {
  const store = await storage(t, (_req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/plain",
      "Content-Length": 3,
      ETag: '"abc"',
    });
    res.end("abc");
  });
  const result = await store.get("file");
  assert.ok(result);
  const blob = await result.blob();
  assert.equal(blob.type, "text/plain");
  assert.equal(await blob.text(), "abc");
  assert.equal(result.bodyUsed, true);
});
