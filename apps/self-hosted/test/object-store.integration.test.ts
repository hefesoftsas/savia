import { presignR2Object } from "../../api/src/lib/r2-presign";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "vitest";
import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
} from "@aws-sdk/client-s3";
import { createObjectStore } from "../src/object-store.ts";

const endpoint = process.env.SAVIA_TEST_S3_ENDPOINT;

test.skipIf(!endpoint)(
  "live S3 preserves bytes, metadata, ranges and concurrent conditional writes",
  async (t) => {
    const config = {
      endpoint: endpoint!,
      bucket: "savia-contract-" + randomUUID(),
      region: "us-east-1",
      accessKeyId: process.env.SAVIA_TEST_S3_ACCESS_KEY ?? "savia-test",
      secretAccessKey:
        process.env.SAVIA_TEST_S3_SECRET_KEY ?? "savia-contract-test-only",
      forcePathStyle: true,
    };
    const client = new S3Client({
      ...config,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
    let store = createObjectStore(config);
    t.onTestFinished(async () => {
      try {
        const page = await store.list();
        await store.delete(page.objects.map((item) => item.key));
        await client.send(new DeleteBucketCommand({ Bucket: config.bucket }));
      } finally {
        store.close();
        client.destroy();
      }
    });
    const saved = await store.put("folder/hello.txt", "0123456789", {
      httpMetadata: { contentType: "text/plain" },
      customMetadata: { User: "José" },
    });
    assert.ok(saved);
    const signedUrl = await presignR2Object(config, {
      method: "GET",
      objectKey: "folder/hello.txt",
    });
    const signedDownload = await fetch(signedUrl);
    assert.equal(signedDownload.status, 200);
    assert.equal(await signedDownload.text(), "0123456789");
    store.close();
    store = createObjectStore(config);
    const read = await store.get("folder/hello.txt", { range: { suffix: 3 } });
    assert.ok(read);
    assert.equal(await read.text(), "789");
    assert.equal(read.size, 10);
    assert.deepEqual(read.range, { offset: 7, length: 3 });
    assert.deepEqual(read.customMetadata, { User: "José" });
    assert.equal(read.version, saved.version);
    assert.equal(
      await store.put("folder/hello.txt", "wrong", {
        onlyIf: { etagMatches: "wrong" },
      }),
      null,
    );
    assert.equal(
      await (await store.get("folder/hello.txt"))?.text(),
      "0123456789",
    );
    const updated = await store.put("folder/hello.txt", "updated", {
      onlyIf: { etagMatches: saved.etag },
    });
    assert.ok(updated);
    const notModified = await store.get("folder/hello.txt", {
      onlyIf: { etagDoesNotMatch: updated.etag },
    });
    assert.ok(notModified && !("body" in notModified));
    const writes = await Promise.all([
      store.put("new", "one", { onlyIf: { etagDoesNotMatch: "*" } }),
      store.put("new", "two", { onlyIf: { etagDoesNotMatch: "*" } }),
    ]);
    assert.equal(writes.filter(Boolean).length, 1);
    const first = await store.list({ limit: 1 });
    assert.equal(first.truncated, true);
    assert.equal(first.objects.length, 1);
    assert.ok(first.truncated);
    const second = await store.list({ limit: 1, cursor: first.cursor });
    assert.equal(second.objects.length, 1);
    assert.notEqual(first.objects[0].key, second.objects[0].key);
  },
);
