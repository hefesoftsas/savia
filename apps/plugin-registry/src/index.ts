import { Hono, type Context } from "hono";
import { parsePluginStoreZip } from "@savia/studio-server/plugin-store";
import { PLUGIN_STORE_MAX_ZIP_BYTES } from "@savia/studio-shared/plugin-store";

type Permission = "read" | "publish";
type RegistryCredential = {
  tokenSha256: string;
  namespace: string;
  permissions: Permission[];
};
type Env = {
  PLUGIN_REGISTRY: R2Bucket;
  REGISTRY_CREDENTIALS: string;
};
type AppEnv = {
  Bindings: Env;
  Variables: { namespace: string; publisherTokenSha256: string };
};
type Release = {
  id: string;
  version: string;
  label: string;
  sha256: string;
  sizeBytes: number;
  createdAt: string;
};

const app = new Hono<AppEnv>();
const idPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const namespacePattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
const noStore = "private, no-store, max-age=0";

function jsonError(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: {
        "cache-control": noStore,
        "x-content-type-options": "nosniff",
      },
    },
  );
}

function secureEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++)
    difference |=
      (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return difference === 0;
}

function parseCredentials(value: string): RegistryCredential[] | null {
  try {
    const entries: unknown = JSON.parse(value);
    if (!Array.isArray(entries)) return null;
    const credentials: RegistryCredential[] = [];
    const hashes = new Set<string>();
    for (const entry of entries) {
      if (
        !entry ||
        typeof entry !== "object" ||
        typeof entry.tokenSha256 !== "string" ||
        !/^[a-f0-9]{64}$/i.test(entry.tokenSha256) ||
        typeof entry.namespace !== "string" ||
        !namespacePattern.test(entry.namespace) ||
        !Array.isArray(entry.permissions) ||
        entry.permissions.length === 0 ||
        entry.permissions.some(
          (permission: unknown) =>
            permission !== "read" && permission !== "publish",
        )
      )
        return null;
      const tokenSha256 = entry.tokenSha256.toLowerCase();
      if (hashes.has(tokenSha256)) return null;
      hashes.add(tokenSha256);
      credentials.push({
        tokenSha256,
        namespace: entry.namespace,
        permissions: [...new Set(entry.permissions)] as Permission[],
      });
    }
    return credentials;
  } catch {
    return null;
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as ArrayBuffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function semanticSha256(
  parsed: Awaited<ReturnType<typeof parsePluginStoreZip>>,
): Promise<string> {
  const semantic = new TextEncoder().encode(
    stableJson({
      manifest: parsed.manifest,
      entryJs: parsed.entryJs,
      store: parsed.store,
    }),
  );
  return sha256Hex(semantic);
}

async function authenticate(
  c: Context<AppEnv>,
  next: () => Promise<void>,
): Promise<Response | void> {
  const header = c.req.header("authorization") ?? "";
  const match = /^Bearer ([^\s]{1,4096})$/.exec(header);
  if (!match)
    return jsonError(401, "UNAUTHORIZED", "A valid bearer token is required.");
  const credentials = parseCredentials(c.env.REGISTRY_CREDENTIALS);
  if (!credentials)
    return jsonError(
      503,
      "REGISTRY_UNAVAILABLE",
      "The registry is not configured.",
    );
  const tokenHash = await sha256Hex(new TextEncoder().encode(match[1]));
  const credential = credentials.find((entry) =>
    secureEqual(entry.tokenSha256, tokenHash),
  );
  if (!credential)
    return jsonError(401, "UNAUTHORIZED", "A valid bearer token is required.");
  const permission: Permission = c.req.method === "PUT" ? "publish" : "read";
  if (!credential.permissions.includes(permission))
    return jsonError(
      403,
      "FORBIDDEN",
      "This credential cannot perform that operation.",
    );
  c.set("namespace", credential.namespace);
  c.set("publisherTokenSha256", credential.tokenSha256);
  await next();
}

app.use("/v1/*", async (c, next) => {
  const result = await authenticate(c, next);
  if (result instanceof Response) return result;
});
app.use("/v1/*", async (_c, next) => {
  await next();
});

function releaseFromMetadata(object: R2Object): Release | null {
  const metadata = object.customMetadata;
  if (
    !metadata ||
    !metadata.id ||
    !metadata.version ||
    !metadata.label ||
    !metadata.sha256 ||
    !metadata.createdAt ||
    !/^\d+$/.test(metadata.sizeBytes ?? "") ||
    !idPattern.test(metadata.id) ||
    metadata.id.length > 100 ||
    !versionPattern.test(metadata.version) ||
    metadata.version.length > 30 ||
    metadata.label.length > 100 ||
    !/^[a-f0-9]{64}$/.test(metadata.sha256) ||
    !Number.isSafeInteger(Number(metadata.sizeBytes)) ||
    Number(metadata.sizeBytes) < 1 ||
    Number(metadata.sizeBytes) > PLUGIN_STORE_MAX_ZIP_BYTES ||
    !Number.isFinite(Date.parse(metadata.createdAt))
  )
    return null;
  return {
    id: metadata.id,
    version: metadata.version,
    label: metadata.label,
    sha256: metadata.sha256,
    sizeBytes: Number(metadata.sizeBytes),
    createdAt: metadata.createdAt,
  };
}

function encodeCursor(namespace: string, cursor: string): string {
  return btoa(`${namespace}\0${cursor}`)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeCursor(namespace: string, cursor: string): string | null {
  if (cursor.length > 2048) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try {
    const base64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    const prefix = `${namespace}\0`;
    return decoded.startsWith(prefix) && decoded.length > prefix.length
      ? decoded.slice(prefix.length)
      : null;
  } catch {
    return null;
  }
}

app.get("/v1/plugins", async (c) => {
  const namespace = c.get("namespace");
  const rawCursor = c.req.query("cursor");
  let cursor: string | undefined;
  if (rawCursor) {
    const decoded = decodeCursor(namespace, rawCursor);
    if (!decoded)
      return jsonError(
        400,
        "INVALID_CURSOR",
        "The registry cursor is invalid.",
      );
    cursor = decoded;
  }
  let page: R2Objects;
  try {
    page = await c.env.PLUGIN_REGISTRY.list({
      prefix: `${namespace}/`,
      ...(cursor ? { cursor } : {}),
      limit: 100,
      include: ["customMetadata"],
    });
  } catch {
    return jsonError(
      503,
      "REGISTRY_UNAVAILABLE",
      "The registry is temporarily unavailable.",
    );
  }
  const data = page.objects
    .map(releaseFromMetadata)
    .filter((release): release is Release => release !== null);
  return Response.json(
    {
      data,
      cursor:
        page.truncated && page.cursor
          ? encodeCursor(namespace, page.cursor)
          : null,
    },
    {
      headers: {
        "cache-control": noStore,
        "x-content-type-options": "nosniff",
      },
    },
  );
});

async function readZipBody(request: Request): Promise<Uint8Array | Response> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/zip")
    return jsonError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Type must be application/zip.",
    );
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength))
      return jsonError(
        400,
        "INVALID_CONTENT_LENGTH",
        "Content-Length is invalid.",
      );
    if (Number(declaredLength) > PLUGIN_STORE_MAX_ZIP_BYTES)
      return jsonError(413, "ZIP_TOO_LARGE", "The ZIP exceeds the 6 MB limit.");
  }
  if (!request.body)
    return jsonError(
      400,
      "INVALID_ZIP",
      "The request body must contain a ZIP file.",
    );
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PLUGIN_STORE_MAX_ZIP_BYTES) {
        await reader.cancel();
        return jsonError(
          413,
          "ZIP_TOO_LARGE",
          "The ZIP exceeds the 6 MB limit.",
        );
      }
      chunks.push(value);
    }
  } catch {
    return jsonError(400, "INVALID_ZIP", "The request body could not be read.");
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

app.put("/v1/plugins/:id/:version", async (c) => {
  const id = c.req.param("id");
  const version = c.req.param("version");
  if (
    !idPattern.test(id) ||
    id.length > 100 ||
    !versionPattern.test(version) ||
    version.length > 30
  )
    return jsonError(
      400,
      "INVALID_RELEASE",
      "The plugin ID or version is invalid.",
    );
  const body = await readZipBody(c.req.raw);
  if (body instanceof Response) return body;
  let parsed: Awaited<ReturnType<typeof parsePluginStoreZip>>;
  try {
    parsed = await parsePluginStoreZip(body);
  } catch {
    return jsonError(
      400,
      "INVALID_ZIP",
      "The ZIP is not a valid plugin package.",
    );
  }
  if (parsed.manifest.id !== id || parsed.manifest.version !== version)
    return jsonError(
      400,
      "MANIFEST_MISMATCH",
      "The path must match the plugin manifest ID and version.",
    );

  const namespace = c.get("namespace");
  const key = `${namespace}/${id}/${version}.zip`;
  const sha256 = parsed.sha256;
  const semanticHash = await semanticSha256(parsed);
  const createdAt = new Date().toISOString();
  const metadata = {
    id,
    version,
    label: parsed.manifest.label.slice(0, 100),
    sha256,
    semanticSha256: semanticHash,
    sizeBytes: String(parsed.sizeBytes),
    createdAt,
    publisherTokenSha256: c.get("publisherTokenSha256"),
  };
  try {
    const stored = await c.env.PLUGIN_REGISTRY.put(key, body, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/zip" },
      customMetadata: metadata,
    });
    if (stored) {
      const release: Release = {
        id,
        version,
        label: metadata.label,
        sha256,
        sizeBytes: parsed.sizeBytes,
        createdAt,
      };
      return Response.json(
        { data: release, deduped: false },
        {
          status: 201,
          headers: {
            "cache-control": noStore,
            "x-content-type-options": "nosniff",
          },
        },
      );
    }
  } catch {
    // A conditional-create race is resolved below from the winning object.
  }

  try {
    const existing = await c.env.PLUGIN_REGISTRY.head(key);
    const existingRelease = existing && releaseFromMetadata(existing);
    if (!existing || !existingRelease)
      return jsonError(
        503,
        "REGISTRY_UNAVAILABLE",
        "The registry is temporarily unavailable.",
      );
    if (existing.customMetadata?.semanticSha256 !== semanticHash)
      return jsonError(
        409,
        "IMMUTABLE_VERSION",
        "This plugin version already contains different content.",
      );
    return Response.json(
      { data: existingRelease, deduped: true },
      {
        status: 200,
        headers: {
          "cache-control": noStore,
          "x-content-type-options": "nosniff",
        },
      },
    );
  } catch {
    return jsonError(
      503,
      "REGISTRY_UNAVAILABLE",
      "The registry is temporarily unavailable.",
    );
  }
});

app.get("/v1/plugins/:id/:version", async (c) => {
  const id = c.req.param("id");
  const version = c.req.param("version");
  if (
    !idPattern.test(id) ||
    id.length > 100 ||
    !versionPattern.test(version) ||
    version.length > 30
  )
    return jsonError(
      400,
      "INVALID_RELEASE",
      "The plugin ID or version is invalid.",
    );
  const key = `${c.get("namespace")}/${id}/${version}.zip`;
  try {
    const object = await c.env.PLUGIN_REGISTRY.get(key);
    if (!object)
      return jsonError(
        404,
        "RELEASE_NOT_FOUND",
        "The plugin release was not found.",
      );
    const release = releaseFromMetadata(object);
    if (!release || release.id !== id || release.version !== version)
      return jsonError(
        503,
        "REGISTRY_UNAVAILABLE",
        "The registry release metadata is invalid.",
      );
    return new Response(object.body, {
      headers: {
        "cache-control": noStore,
        "content-type": "application/zip",
        "content-length": String(release.sizeBytes),
        "x-plugin-sha256": release.sha256,
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return jsonError(
      503,
      "REGISTRY_UNAVAILABLE",
      "The registry is temporarily unavailable.",
    );
  }
});

app.notFound(() =>
  jsonError(404, "NOT_FOUND", "The requested registry resource was not found."),
);
app.onError(() =>
  jsonError(
    500,
    "INTERNAL_ERROR",
    "The registry request could not be completed.",
  ),
);

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return Promise.resolve(app.fetch(request, env));
  },
};
