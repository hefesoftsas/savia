export type PluginEntryGrant = {
  tenantId: string;
  pluginId: string;
  version: string;
  expiresAt: number;
};

const grantBytes = (grant: PluginEntryGrant) =>
  new TextEncoder().encode(
    JSON.stringify([
      "savia-plugin-entry-v1",
      grant.tenantId,
      grant.pluginId,
      grant.version,
      grant.expiresAt,
    ]),
  );

async function hmacKey(secret: string, usage: "sign" | "verify") {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

export async function signPluginEntryGrant(
  secret: string,
  grant: PluginEntryGrant,
): Promise<string> {
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      await hmacKey(secret, "sign"),
      grantBytes(grant),
    ),
  );
  return btoa(String.fromCharCode(...signature))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export async function verifyPluginEntryGrant(
  secret: string,
  grant: PluginEntryGrant,
  signature: string,
  now = Date.now(),
): Promise<boolean> {
  if (
    !secret ||
    !Number.isSafeInteger(grant.expiresAt) ||
    grant.expiresAt <= now ||
    grant.expiresAt > now + 5 * 60_000 ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature)
  )
    return false;
  try {
    const binary = atob(
      signature.replaceAll("-", "+").replaceAll("_", "/") + "=",
    );
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret, "verify"),
      bytes,
      grantBytes(grant),
    );
  } catch {
    return false;
  }
}
