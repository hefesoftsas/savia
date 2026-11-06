import { fileURLToPath } from "node:url";

const STATUS_ENDPOINT =
  "https://savia-backup-coordinator.jose-douglas-dev.workers.dev/api/_internal/backup-gate/status";
const DIAGNOSTIC_OWNER = "production-backup-gate-diagnostic";
const MAX_RESPONSE_BYTES = 128 * 1024;

function safeError(error) {
  return { status: "error", error };
}

function validTimestamp(value) {
  return (
    Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime())
  );
}

async function readBoundedJson(response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES)
    throw new Error("response_too_large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("missing_response_body");
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("response_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function inspectProductionBackupGate({
  env = process.env,
  fetchImpl = fetch,
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  let result;
  const secret = env.SAVIA_BACKUP_CONTROL_SECRET;
  if (typeof secret !== "string" || secret.length < 32) {
    result = safeError("missing_secret");
  } else {
    try {
      // Status can clear an already-expired lease in the coordinator. This
      // client itself only asks for status and never writes or removes permits.
      const response = await fetchImpl(STATUS_ENDPOINT, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          owner: DIAGNOSTIC_OWNER,
          includePermits: true,
        }),
      });
      if (!response.ok) {
        result = {
          status: "error",
          error: `http_${Number.isInteger(response.status) ? response.status : "unknown"}`,
        };
      } else {
        let body;
        try {
          body = await readBoundedJson(response);
        } catch {
          result = safeError("invalid_response");
        }
        if (result === undefined) {
          if (
            !body ||
            typeof body !== "object" ||
            !Number.isSafeInteger(body.active) ||
            body.active < 0 ||
            !Array.isArray(body.permits) ||
            body.permits.length !== body.active ||
            body.permits.some(
              (permit) => !permit || !validTimestamp(permit.createdAt),
            )
          ) {
            result = safeError("invalid_response");
          } else {
            result = {
              status: "ok",
              activePermits: body.active,
              createdAt: body.permits
                .map(({ createdAt }) => new Date(createdAt).toISOString())
                .sort(),
            };
          }
        }
      }
    } catch {
      result = safeError("request_failed");
    }
  }
  writeOutput(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  inspectProductionBackupGate()
    .then((result) => {
      if (result.status !== "ok") process.exitCode = 1;
    })
    .catch(() => {
      process.stdout.write(
        `${JSON.stringify(safeError("request_failed"), null, 2)}\n`,
      );
      process.exitCode = 1;
    });
}
