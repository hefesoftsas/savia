import { SignJWT } from "jose";
import type { Bindings } from "./context";

export async function authorizeEditorCommand(
  env: Bindings,
  identity: {
    userId: string;
    organizationId: string;
    workflowId: string;
  },
): Promise<boolean> {
  const secret = env.SAVIA_FLOWS_BRIDGE_SECRET;
  if (
    !env.SAVIA_HOST ||
    !secret ||
    new TextEncoder().encode(secret).byteLength < 32
  )
    return false;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const token = await new SignJWT({
      tenant: identity.organizationId,
      workflowId: identity.workflowId,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(identity.userId)
      .setIssuer("savia-flows")
      .setAudience("savia-flows-host")
      .setIssuedAt()
      .setExpirationTime("10s")
      .sign(new TextEncoder().encode(secret));
    const response = await Promise.race([
      env.SAVIA_HOST.fetch(
        "https://savia-host.internal/api/public/savia-flows/authorize-editor",
        {
          method: "POST",
          headers: { authorization: "Bearer " + token },
          signal: controller.signal,
        },
      ),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("Editor authorization timed out"));
        }, 5000);
      }),
    ]);
    if (!response.ok) {
      await response.body?.cancel();
      return false;
    }
    const data = await response.json<{ authorized?: unknown }>();
    return data.authorized === true;
  } catch {
    return false;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
