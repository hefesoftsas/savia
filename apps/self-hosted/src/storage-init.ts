import { mkdir, writeFile, chown, chmod } from "node:fs/promises";
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketCorsCommand,
} from "@aws-sdk/client-s3";
import { loadConfiguration } from "./config";
const config = loadConfiguration();
if (process.argv.includes("--credentials")) {
  await mkdir("/storage-config", { recursive: true });
  await writeFile(
    "/storage-config/s3.json",
    JSON.stringify({
      identities: [
        {
          name: "savia",
          credentials: [
            {
              accessKey: config.s3.accessKeyId,
              secretKey: config.s3.secretAccessKey,
            },
          ],
          actions: ["Admin", "Read", "Write", "List", "Tagging"],
        },
      ],
    }),
    { mode: 0o600 },
  );
  // The pinned SeaweedFS entrypoint drops privileges to uid/gid 1000.
  await chown("/storage-config/s3.json", 1000, 1000);
  await chmod("/storage-config/s3.json", 0o600);
} else {
  const client = new S3Client({ ...config.s3, credentials: config.s3 });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        await client.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
        ready = true;
        break;
      } catch (error) {
        if (
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode === 404
        ) {
          await client.send(
            new CreateBucketCommand({ Bucket: config.s3.bucket }),
          );
          ready = true;
          break;
        }
        if (attempt === 59) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    if (!ready) throw new Error("Object storage did not become ready");
    await client.send(
      new PutBucketCorsCommand({
        Bucket: config.s3.bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: [
                config.publicOrigin,
                `${new URL(config.publicOrigin).protocol}//*.${new URL(config.publicOrigin).host}`,
              ],
              AllowedMethods: ["GET", "HEAD", "PUT"],
              AllowedHeaders: ["content-type", "range"],
              ExposeHeaders: ["ETag", "Content-Length", "Content-Range"],
              MaxAgeSeconds: 300,
            },
          ],
        },
      }),
    );
  } finally {
    client.destroy();
  }
}
