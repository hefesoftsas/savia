import manifest from "../office-runtime.json";
export const officeDocumentHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;
export type OfficeAssetBucket = {
  get(key: string): Promise<{
    body: ReadableStream;
    size: number;
    httpMetadata?: { contentEncoding?: string };
  } | null>;
};
export function officeRuntimeAsset(path: string) {
  const prefix = "/office/runtime/" + manifest.build + "/";
  if (!path.startsWith(prefix)) return null;
  const name = path.slice(prefix.length);
  if (!Object.hasOwn(manifest.files, name)) return null;
  return {
    name,
    ...manifest.files[name as keyof typeof manifest.files],
    key: "office-runtime/" + manifest.build + "/" + name,
  };
}
export async function officeAssetResponse(
  request: Request,
  bucket?: OfficeAssetBucket,
) {
  const asset = officeRuntimeAsset(new URL(request.url).pathname);
  if (!asset) return new Response("Office resource not found", { status: 404 });
  if (!["GET", "HEAD"].includes(request.method))
    return new Response(null, { status: 405 });
  if (!bucket)
    return new Response("Office runtime is not configured", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  const file = await bucket.get(asset.key);
  if (!file)
    return new Response("Office runtime is not installed", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  const headers = new Headers({
    "Content-Type": asset.type,
    "Content-Length": String(file.size),
    "Cache-Control": "public, max-age=31536000, immutable",
    ETag: '"' + asset.sha256 + '"',
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  });
  if (file.httpMetadata?.contentEncoding)
    headers.set("Content-Encoding", file.httpMetadata.contentEncoding);
  const init: ResponseInit & { encodeBody: "manual" } = {
    headers,
    encodeBody: "manual",
  };
  return new Response(request.method === "HEAD" ? null : file.body, init);
}
