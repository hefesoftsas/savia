import type {
  SaviaCollectionCall,
  SaviaCollectionIdentity,
} from "@savia/studio-shared/savia-flows";
import { SignJWT } from "jose";

interface SaviaCollectionEnv {
  SAVIA_HOST?: { fetch(request: Request): Promise<Response> };
  SAVIA_FLOWS_BRIDGE_SECRET?: string;
}

export class SaviaCollectionHostError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SaviaCollectionHostError";
  }
}

/** Calls the private Savia host using a short-lived, body-bound identity token. */
export async function callSaviaCollections<T = Record<string, unknown>>(
  env: SaviaCollectionEnv,
  call: SaviaCollectionCall,
  identity: SaviaCollectionIdentity,
): Promise<T> {
  const host = env.SAVIA_HOST;
  const secret = env.SAVIA_FLOWS_BRIDGE_SECRET;
  if (!host || !secret || new TextEncoder().encode(secret).byteLength < 32) {
    throw new Error("Savia collections are unavailable");
  }
  if (!identity.principalId || !identity.tenant) {
    throw new Error("Savia collection identity is incomplete");
  }
  if (
    ["create", "update", "delete"].includes(call.action) &&
    (!identity.workflowId || !identity.executionId || !identity.nodeId)
  ) {
    throw new Error(
      "Savia collection writes require workflow execution identity",
    );
  }

  const body = JSON.stringify(call);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  const bodyDigest = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const issuedAt = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({
    tenant: identity.tenant,
    ...(identity.workflowId && { workflowId: identity.workflowId }),
    ...(identity.executionId && { executionId: identity.executionId }),
    ...(identity.nodeId && { nodeId: identity.nodeId }),
    bodyDigest,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("savia-flows")
    .setAudience("savia-flows-collections-host")
    .setSubject(identity.principalId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 10)
    .sign(new TextEncoder().encode(secret));

  const response = await host.fetch(
    new Request("https://savia.local/api/public/savia-flows/collections", {
      method: "POST",
      headers: {
        authorization: `Bearer ${jwt}`,
        "content-type": "application/json",
      },
      body,
    }),
  );
  const text = await response.text();
  let result: unknown;
  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Savia collection host returned invalid JSON (${response.status})`,
    );
  }
  if (!response.ok) {
    const errorValue =
      result && typeof result === "object" && "error" in result
        ? (result as { error: unknown }).error
        : undefined;
    const message =
      errorValue && typeof errorValue === "object" && "message" in errorValue
        ? String((errorValue as { message: unknown }).message)
        : errorValue !== undefined
          ? String(errorValue)
          : `Savia collection host failed (${response.status})`;
    throw new SaviaCollectionHostError(response.status, message);
  }
  return result as T;
}
