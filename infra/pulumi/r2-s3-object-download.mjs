import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdtemp, open, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { assertAccountId, assertSafeR2Key } from "./naming.mjs";
import { RecoveryConsistencyError } from "./recovery-consistency.mjs";

const execFileAsync = promisify(execFile);
const TOKEN_VERIFY_TIMEOUT_MS = 30_000;
const TOKEN_ID = /^[a-f0-9]{32}$/i;

function assertBucket(bucket) {
  if (
    typeof bucket !== "string" ||
    bucket.trim() === "" ||
    bucket !== bucket.trim() ||
    bucket.includes("/")
  ) {
    throw new Error("bucket must be a non-empty R2 bucket name");
  }
  return bucket;
}

function assertToken(token) {
  if (
    typeof token !== "string" ||
    token.trim() === "" ||
    /[\r\n]/.test(token)
  ) {
    throw new Error("A valid Cloudflare API token is required");
  }
  return token;
}

function quoteEtag(etag) {
  if (typeof etag !== "string" || etag.length === 0 || /[\r\n]/.test(etag)) {
    throw new Error("A valid R2 inventory ETag is required");
  }
  const unquoted =
    etag.startsWith('"') && etag.endsWith('"') ? etag.slice(1, -1) : etag;
  if (unquoted.length === 0 || unquoted.includes('"')) {
    throw new Error("A valid R2 inventory ETag is required");
  }
  return `"${unquoted}"`;
}

async function verifyResponse(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      "Cloudflare token verification returned an invalid response",
    );
  }
  return payload;
}

/** Resolve Cloudflare's documented R2 S3 credentials from an existing API token. */
export async function resolveR2S3Credentials({
  accountId,
  token,
  fetchImpl = fetch,
} = {}) {
  const validatedAccountId = assertAccountId(accountId);
  const validatedToken = assertToken(token);
  if (typeof fetchImpl !== "function")
    throw new Error("fetchImpl must be a function");

  const headers = { authorization: `Bearer ${validatedToken}` };
  const verify = async (url) => {
    let response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(TOKEN_VERIFY_TIMEOUT_MS),
      });
    } catch {
      throw new Error("Cloudflare token verification failed");
    }
    return response;
  };

  const accountUrl = `https://api.cloudflare.com/client/v4/accounts/${validatedAccountId}/tokens/verify`;
  let response = await verify(accountUrl);
  if (response.status === 401 || response.status === 403) {
    response = await verify(
      "https://api.cloudflare.com/client/v4/user/tokens/verify",
    );
  }
  if (!response.ok) {
    throw new Error(
      `Cloudflare token verification failed (HTTP ${response.status})`,
    );
  }
  const payload = await verifyResponse(response);
  const result = payload?.success === true ? payload.result : undefined;
  if (
    result?.status !== "active" ||
    typeof result.id !== "string" ||
    !TOKEN_ID.test(result.id)
  ) {
    throw new Error(
      "Cloudflare token verification did not return an active token identity",
    );
  }
  return {
    accessKeyId: result.id,
    secretAccessKey: createHash("sha256")
      .update(validatedToken, "utf8")
      .digest("hex"),
  };
}

function isPreconditionFailure(error) {
  return (
    error?.statusCode === 412 ||
    error?.code === "PreconditionFailed" ||
    /(?:^|\D)412(?:\D|$)|PreconditionFailed/i.test(
      `${error?.stderr ?? ""} ${error?.message ?? ""}`,
    )
  );
}

function sourceChildEnv(parentEnv, credentials) {
  const env = {
    AWS_ACCESS_KEY_ID: credentials.accessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    AWS_DEFAULT_REGION: "auto",
    AWS_EC2_METADATA_DISABLED: "true",
    AWS_CONFIG_FILE: "/dev/null",
    AWS_SHARED_CREDENTIALS_FILE: "/dev/null",
    AWS_CLI_AUTO_PROMPT: "off",
    AWS_PAGER: "",
  };
  if (typeof parentEnv.PATH === "string" && parentEnv.PATH !== "")
    env.PATH = parentEnv.PATH;
  if (typeof parentEnv.SYSTEMROOT === "string")
    env.SYSTEMROOT = parentEnv.SYSTEMROOT;
  return env;
}

/** Create an isolated, lazy S3 downloader; token verification is shared per capture. */
export function createR2S3Downloader({
  accountId,
  token,
  fetchImpl = fetch,
  execFileImpl = execFileAsync,
  parentEnv = process.env,
  tempRoot = tmpdir(),
} = {}) {
  const validatedAccountId = assertAccountId(accountId);
  const validatedToken = assertToken(token);
  if (typeof execFileImpl !== "function")
    throw new Error("execFileImpl must be a function");
  let credentialsPromise;
  const credentials = () => {
    credentialsPromise ??= resolveR2S3Credentials({
      accountId: validatedAccountId,
      token: validatedToken,
      fetchImpl,
    });
    return credentialsPromise;
  };

  return async function downloadR2S3Object({
    bucket,
    key,
    destFile,
    expectedSize,
    expectedEtag,
  } = {}) {
    const safeBucket = assertBucket(bucket);
    const safeKey = assertSafeR2Key(key);
    const match = quoteEtag(expectedEtag);
    if (typeof destFile !== "string" || destFile.trim() === "") {
      throw new Error("destFile must be a non-empty path");
    }
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) {
      throw new Error("expectedSize must be a non-negative safe integer");
    }

    const tempDir = await mkdtemp(join(tempRoot, "savia-r2-object-"));
    await chmod(tempDir, 0o700);
    const tempFile = join(tempDir, "object");
    const keyFile = join(tempDir, "key");
    let finalCreated = false;
    let finalHandle;
    try {
      const sourceCredentials = await credentials();
      await writeFile(keyFile, safeKey, { flag: "wx", mode: 0o600 });
      const args = [
        "s3api",
        "get-object",
        "--bucket",
        safeBucket,
        "--key",
        `file://${keyFile}`,
        "--if-match",
        match,
        tempFile,
        "--endpoint-url",
        `https://${validatedAccountId}.r2.cloudflarestorage.com`,
        "--cli-connect-timeout",
        "30",
        "--cli-read-timeout",
        "300",
        "--output",
        "json",
      ];
      let result;
      try {
        result = await execFileImpl("aws", args, {
          env: sourceChildEnv(parentEnv, sourceCredentials),
          maxBuffer: 1024 * 1024,
        });
      } catch (error) {
        if (isPreconditionFailure(error)) {
          throw new RecoveryConsistencyError(
            "R2 object changed during backup; retry against a stable recovery boundary",
          );
        }
        throw new Error("R2 source object download failed");
      }

      let response;
      try {
        response = JSON.parse(result?.stdout ?? "");
      } catch {
        throw new Error("R2 source object download returned invalid metadata");
      }
      const returnedEtag =
        typeof response.ETag === "string" ? response.ETag : "";
      if (returnedEtag !== match) {
        throw new RecoveryConsistencyError(
          "R2 object ETag changed during backup",
        );
      }
      if (response.ContentLength !== expectedSize) {
        throw new RecoveryConsistencyError(
          "R2 object size changed during backup",
        );
      }
      const tempInfo = await stat(tempFile);
      if (!tempInfo.isFile() || tempInfo.size !== expectedSize) {
        throw new RecoveryConsistencyError(
          "R2 object bytes changed during backup",
        );
      }
      await chmod(tempFile, 0o600);

      finalHandle = await open(destFile, "wx", 0o600);
      finalCreated = true;
      for await (const chunk of createReadStream(tempFile)) {
        let offset = 0;
        while (offset < chunk.length) {
          const { bytesWritten } = await finalHandle.write(chunk, offset);
          if (bytesWritten === 0) throw new Error("R2 object copy stalled");
          offset += bytesWritten;
        }
      }
      await finalHandle.close();
      finalHandle = undefined;
      const finalInfo = await stat(destFile);
      if (!finalInfo.isFile() || finalInfo.size !== expectedSize) {
        throw new RecoveryConsistencyError(
          "R2 object bytes changed during backup",
        );
      }
      await chmod(destFile, 0o600);
      return { bytesWritten: finalInfo.size, etag: returnedEtag };
    } catch (error) {
      if (finalHandle) await finalHandle.close().catch(() => {});
      if (finalCreated) await rm(destFile, { force: true }).catch(() => {});
      if (error instanceof RecoveryConsistencyError) throw error;
      if (
        /^R2 source object|^Cloudflare token verification|^A valid|^bucket |^expectedSize|^destFile/.test(
          error?.message ?? "",
        )
      ) {
        throw error;
      }
      throw new Error("R2 source object download failed");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  };
}
