import {
  isNativeFlowsCall,
  type NativeFlowsCall,
} from "@savia/studio-shared/native-flows";
import type { SaviaCollectionIdentity } from "@savia/studio-shared/savia-flows";
import { SignJWT } from "jose";
import { SaviaCollectionHostError } from "./collection-client";

interface NativeFlowsEnv {
  SAVIA_HOST?: { fetch(request: Request): Promise<Response> };
  SAVIA_FLOWS_BRIDGE_SECRET?: string;
}

export async function requestNativeFlows(
  env: NativeFlowsEnv,
  call: NativeFlowsCall,
  identity: SaviaCollectionIdentity,
): Promise<Response> {
  if (!isNativeFlowsCall(call))
    throw new Error("Invalid native flow operation");
  const secret = env.SAVIA_FLOWS_BRIDGE_SECRET;
  if (
    !env.SAVIA_HOST ||
    !secret ||
    new TextEncoder().encode(secret).length < 32
  )
    throw new Error("Savia native flows are unavailable");
  if (!identity.principalId || !/^tenant:(0|[1-9]\d*)$/.test(identity.tenant))
    throw new Error("Savia native flow identity is incomplete");
  const body = JSON.stringify(call);
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  const bodyDigest = [...new Uint8Array(hash)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const issuedAt = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ tenant: identity.tenant, bodyDigest })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("savia-flows")
    .setAudience("savia-flows-native-host")
    .setSubject(identity.principalId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 10)
    .sign(new TextEncoder().encode(secret));
  return env.SAVIA_HOST.fetch(
    new Request("https://savia.local/api/public/savia-flows/native", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body,
    }),
  );
}

export async function callNativeFlows<T>(
  env: NativeFlowsEnv,
  call: NativeFlowsCall,
  identity: SaviaCollectionIdentity,
): Promise<T> {
  const response = await requestNativeFlows(env, call, identity);
  const value = (await response.json()) as { data?: unknown; error?: unknown };
  if (!response.ok) {
    const message =
      typeof value.error === "string"
        ? value.error
        : `Savia native flow failed (${response.status})`;
    throw new SaviaCollectionHostError(response.status, message);
  }
  return value.data as T;
}
