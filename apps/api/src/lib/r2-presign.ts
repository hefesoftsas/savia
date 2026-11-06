import { AwsClient } from "aws4fetch";

export type R2SigningCredentials = {
  accountId?: string;
  endpoint?: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export type R2PresignRequest = {
  method: "GET" | "PUT";
  objectKey: string;
  contentType?: string;
};

const expirationSeconds = 300;

function encodedPathSegment(value: string): string {
  return encodeURIComponent(value);
}

export async function presignR2Object(
  credentials: R2SigningCredentials,
  request: R2PresignRequest,
): Promise<string> {
  const objectPath = request.objectKey
    .split("/")
    .map(encodedPathSegment)
    .join("/");
  if (!credentials.endpoint && !credentials.accountId)
    throw new Error("An S3 endpoint or Cloudflare account ID is required");
  const endpoint =
    credentials.endpoint ??
    `https://${credentials.accountId}.r2.cloudflarestorage.com`;
  const url = new URL(
    `${endpoint.replace(/\/$/, "")}/${encodedPathSegment(credentials.bucket)}/${objectPath}`,
  );
  url.searchParams.set("X-Amz-Expires", String(expirationSeconds));

  const headers = new Headers();
  if (request.contentType) headers.set("content-type", request.contentType);

  const signer = new AwsClient({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    service: "s3",
    region: credentials.region ?? "auto",
  });
  const signed = await signer.sign(
    new Request(url, { method: request.method, headers }),
    { aws: { signQuery: true, allHeaders: true } },
  );

  return signed.url;
}
