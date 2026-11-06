import { SignJWT, jwtVerify } from "jose";

export async function bodyDigest(body: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  return [...new Uint8Array(hash)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyCollectionCall(
  token: string,
  body: string,
  secret: string,
) {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    issuer: "savia-flows",
    audience: "savia-flows-collections-host",
    algorithms: ["HS256"],
    maxTokenAge: "10s",
  });
  if (
    !payload.sub ||
    payload.sub.length > 200 ||
    typeof payload.tenant !== "string" ||
    !/^tenant:(0|[1-9]\d*)$/.test(payload.tenant) ||
    !Number.isSafeInteger(Number(payload.tenant.slice(7))) ||
    !Number.isInteger(payload.iat) ||
    !Number.isInteger(payload.exp) ||
    payload.exp! - payload.iat! > 10 ||
    payload.bodyDigest !== (await bodyDigest(body))
  )
    throw new Error("Invalid native collection authority");
  return payload;
}

export async function signCollectionEvent(
  body: string,
  tenant: string,
  eventId: string,
  secret: string,
) {
  return new SignJWT({ tenant, eventId, bodyDigest: await bodyDigest(body) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("savia")
    .setAudience("savia-flows-collection-events")
    .setIssuedAt()
    .setExpirationTime("30s")
    .sign(new TextEncoder().encode(secret));
}
