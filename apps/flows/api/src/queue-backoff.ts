const BASE_RETRY_DELAY_SECONDS = 60;
const MAX_RETRY_DELAY_SECONDS = 60 * 60;

/** Exponential queue retry delay for a Cloudflare message delivery attempt. */
export function queueRetryDelaySeconds(attempts: number): number {
  const attempt = Number.isFinite(attempts)
    ? Math.max(1, Math.floor(attempts))
    : 1;
  return Math.min(
    BASE_RETRY_DELAY_SECONDS * 2 ** (attempt - 1),
    MAX_RETRY_DELAY_SECONDS,
  );
}

/** Stable per-queue-message/workflow execution ID accepted by Flows runtimes. */
export async function queueExecutionId(
  messageId: string,
  workflowId: string,
): Promise<string> {
  const source = new TextEncoder().encode(
    `savia-queue-execution\0${messageId}\0${workflowId}`,
  );
  const digest = await crypto.subtle.digest("SHA-1", source);
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `savia-${hash}`;
}
